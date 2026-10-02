import { createHook, getWritable } from "workflow";
import { DurableAgent } from "@workflow/ai/agent";
import { z } from "zod";
import { isEncryptedBlob } from "@tabmerger/shared";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Durable AI agent that proposes a reorganization of a user's tab groups,
 * pauses for human approval, then applies the approved changes to Supabase.
 *
 * Schema note: this codebase stores tabs nested inside a `windows` jsonb column
 * on each `groups` row (there is no separate tabs table).
 *
 * "Now Open" (the permanent group) is device-local: the extension never syncs it,
 * so it is never a `groups` row. Rows are therefore never permanent, whatever
 * their `position`: legacy rows written before the extension pushed `position`
 * all hold the column default 0, so position 0 says nothing about Now Open. The
 * only way the workflow sees Now Open is in the client-supplied payload
 * ({@link ClientGroup}); {@link applyChanges} pins those ids and refuses any
 * action on an id that is not a stored row.
 *
 * `position` follows the extension's rule: a group's index in the client's list,
 * where Now Open is index 0 and never stored, so synced groups are >= 1.
 */

// --- Action model -----------------------------------------------------------

export type ReorganizeAction =
  | { type: "merge"; sourceGroupId: string; targetGroupId: string }
  | { type: "rename"; groupId: string; newName: string }
  | { type: "delete"; groupId: string }
  | { type: "reorder"; groupIds: string[] };

const organizeActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("merge"),
    sourceGroupId: z.string(),
    targetGroupId: z.string(),
  }),
  z.object({
    type: z.literal("rename"),
    groupId: z.string(),
    newName: z.string().max(30),
  }),
  z.object({ type: z.literal("delete"), groupId: z.string() }),
  z.object({ type: z.literal("reorder"), groupIds: z.array(z.string()) }),
]);

const analyzeGroupsInputSchema = z.object({
  actions: z.array(organizeActionSchema),
  rationale: z.string().describe("One short sentence explaining the plan."),
});

// Serializable shape returned by fetchUserData / consumed by applyChanges.
interface SerializableGroup {
  id: string;
  name: string;
  color: string;
  position: number;
  permanent: boolean;
  windows: unknown; // ExtWindow[] as stored jsonb — opaque here, passed through
}

/**
 * Plaintext group content supplied by the client in the POST body, mirroring
 * the payload `/api/ai/suggest-sessions` already accepts. Required for E2E-
 * encrypted users: `groups.windows` is ciphertext the server can never decrypt,
 * so the only source of plaintext for the prompt is the client's decrypted
 * in-memory state.
 */
export interface ClientGroup {
  id: string;
  name: string;
  tabs: unknown[];
  /**
   * Optional; defaults to `index === 0`, because the extension's list always starts
   * with Now Open (current builds also send the flag explicitly).
   */
  permanent?: boolean;
}

// --- Steps ------------------------------------------------------------------

export async function fetchUserData(
  userId: string,
  clientGroups: ClientGroup[] | null
): Promise<SerializableGroup[]> {
  "use step";

  if (clientGroups) {
    // Array order is the client's own group order (`groupsState.available`,
    // which includes the local-only Now Open group), so the index doubles as
    // `position` (the same rule the extension uses when pushing) and index 0
    // is Now Open unless the client says otherwise.
    return clientGroups.map((g, i) => ({
      id: g.id,
      name: g.name,
      color: "",
      position: i,
      permanent: g.permanent ?? i === 0,
      // The prompt only ever reads tab titles/URLs; one synthetic window is
      // enough and avoids shipping the full window tree over the wire.
      windows: [{ tabs: g.tabs }],
    }));
  }

  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, color, position, windows")
    .eq("user_id", userId)
    // Legacy rows all tie at position 0 (the column default), so add stable
    // tie-breakers: most recently edited first, then id.
    .order("position", { ascending: true })
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });

  if (error) throw new Error(`fetchUserData: ${error.message}`);

  return (data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    position: g.position,
    // Now Open is never synced, so no stored row is permanent, not even a
    // legacy row sitting at the default position 0.
    permanent: false,
    windows: g.windows ?? [],
  }));
}

/**
 * Applies approved actions to the user's stored `groups` rows.
 *
 * @param pinnedIds ids of permanent groups the workflow saw (the client's Now
 *   Open group). They are never stored, so every action naming one is skipped,
 *   and `reorder` keeps them at index 0 without spending a position on them.
 */
export async function applyChanges(
  userId: string,
  actions: ReorganizeAction[],
  pinnedIds: string[] = []
): Promise<{ applied: number; skipped: ReorganizeAction[] }> {
  "use step";
  const supabase = await createServiceRoleClient();

  // Re-fetch current state so the guard and merges act on live data.
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, color, position, windows")
    .eq("user_id", userId);
  if (error) throw new Error(`applyChanges/fetch: ${error.message}`);

  // Stored rows are never permanent (see the module comment).
  const groups = new Map(
    (data ?? []).map((g) => [
      g.id,
      { ...g, permanent: false } as SerializableGroup,
    ])
  );
  const pinned = new Set(pinnedIds);
  /**
   * True when the server may act on `id`: a stored row that is not pinned.
   * Unknown ids (Now Open, groups not yet synced, ids the model invented, rows
   * removed earlier in this batch) are reported as skipped instead of being
   * counted as applied for a write that matched nothing.
   */
  const isActionable = (id: string) => !pinned.has(id) && groups.has(id);

  /**
   * True when the group's stored content is client-side ciphertext.
   *
   * The server holds no decryption key by design, so it can neither read the
   * group's real name (the `name` column is written as '' for encrypted rows,
   * with the real name inside the blob) nor concatenate two `windows` trees.
   * Any content-bearing write here would therefore silently destroy or
   * shadow the user's data. Such actions are refused and reported via
   * `skipped` so the client can re-apply them locally, where the sync engine
   * re-encrypts and pushes them through the normal path.
   *
   * Position-only (`reorder`) and row-level (`delete`) actions touch no
   * plaintext and stay server-side for encrypted and plaintext users alike.
   */
  const isCiphertext = (id: string) => isEncryptedBlob(groups.get(id)?.windows);

  const skipped: ReorganizeAction[] = [];
  let applied = 0;

  for (const action of actions) {
    // Guard: Now Open and any group without a stored row are out of reach.
    if (
      (action.type === "delete" || action.type === "rename") &&
      !isActionable(action.groupId)
    ) {
      skipped.push(action);
      continue;
    }
    if (
      action.type === "merge" &&
      (!isActionable(action.sourceGroupId) || !isActionable(action.targetGroupId))
    ) {
      skipped.push(action);
      continue;
    }

    // E2EE guard — see isCiphertext.
    if (action.type === "rename" && isCiphertext(action.groupId)) {
      skipped.push(action);
      continue;
    }
    if (
      action.type === "merge" &&
      (isCiphertext(action.sourceGroupId) || isCiphertext(action.targetGroupId))
    ) {
      skipped.push(action);
      continue;
    }

    switch (action.type) {
      case "rename": {
        const { error: e } = await supabase
          .from("groups")
          .update({ name: action.newName })
          .eq("id", action.groupId)
          .eq("user_id", userId);
        if (e) throw new Error(`applyChanges/rename: ${e.message}`);
        applied++;
        break;
      }
      case "delete": {
        const { error: e } = await supabase
          .from("groups")
          .delete()
          .eq("id", action.groupId)
          .eq("user_id", userId);
        if (e) throw new Error(`applyChanges/delete: ${e.message}`);
        groups.delete(action.groupId);
        applied++;
        break;
      }
      case "merge": {
        // Both exist: the isActionable guard above already checked them.
        const source = groups.get(action.sourceGroupId)!;
        const target = groups.get(action.targetGroupId)!;
        const srcWindows = Array.isArray(source.windows) ? source.windows : [];
        const tgtWindows = Array.isArray(target.windows) ? target.windows : [];
        const { error: e1 } = await supabase
          .from("groups")
          .update({ windows: [...tgtWindows, ...srcWindows] })
          .eq("id", target.id)
          .eq("user_id", userId);
        if (e1) throw new Error(`applyChanges/merge-update: ${e1.message}`);
        const { error: e2 } = await supabase
          .from("groups")
          .delete()
          .eq("id", source.id)
          .eq("user_id", userId);
        if (e2) throw new Error(`applyChanges/merge-delete: ${e2.message}`);
        target.windows = [...tgtWindows, ...srcWindows];
        groups.delete(source.id);
        applied++;
        break;
      }
      case "reorder": {
        // Same rule as the extension: position = index in the client's list,
        // with Now Open pinned at index 0 and never stored. So pinned ids take
        // no slot, every other id takes the next slot starting at 1, and only
        // stored rows are written (a local-only group still occupies its slot,
        // keeping later groups' positions equal to their client index).
        let pos = 0;
        for (const id of action.groupIds) {
          if (pinned.has(id)) continue;
          pos++;
          if (!groups.has(id)) continue;
          const { error: e } = await supabase
            .from("groups")
            .update({ position: pos })
            .eq("id", id)
            .eq("user_id", userId);
          if (e) throw new Error(`applyChanges/reorder: ${e.message}`);
        }
        applied++;
        break;
      }
    }
  }

  return { applied, skipped };
}

// --- Workflow ---------------------------------------------------------------

export interface ApprovalPayload {
  approved: boolean;
  // The approver may submit an edited action list; if present it overrides the
  // AI proposal. Validated again before apply.
  actions?: ReorganizeAction[];
}

export async function tabOrganizerWorkflow(
  userId: string,
  hookToken: string,
  clientGroups: ClientGroup[] | null = null
) {
  "use workflow";

  const groups = await fetchUserData(userId, clientGroups);

  const agent = new DurableAgent({
    model: "anthropic/claude-sonnet-4-6",
    instructions:
      "You are a tab-organization assistant. Analyze the user's browser tab " +
      "groups, find redundancies and near-duplicate groups, and propose a " +
      "clean reorganization. Prefer merging small or overlapping groups, " +
      "renaming vague groups to concise 2-4 word titles, and removing empty " +
      "groups. Never propose deleting or merging away a group marked " +
      '`"permanent": true` (the live "Now Open" group). When ready, call the ' +
      "analyzeGroups tool exactly once with the full list of actions. Do not " +
      "call any other tool and do not continue after calling it.",
    tools: {
      // No `execute`: the agent stops after calling this so we can capture the
      // structured proposal from `toolCalls` and stream it for approval.
      analyzeGroups: {
        description:
          "Submit the final reorganization plan as an array of actions.",
        inputSchema: analyzeGroupsInputSchema,
      },
    },
  });

  const writable = getWritable();

  const result = await agent.stream({
    writable,
    messages: [
      {
        role: "user",
        content:
          "Here are my current tab groups (JSON). Propose a reorganization.\n" +
          JSON.stringify(groups),
      },
    ],
  });

  // Extract the proposed actions from the (unexecuted) analyzeGroups call.
  const call = result.toolCalls.find((c) => c.toolName === "analyzeGroups");
  const proposal = call
    ? analyzeGroupsInputSchema.parse(call.input)
    : { actions: [] as ReorganizeAction[], rationale: "No changes proposed." };

  // Suspend until an external system resumes the hook with an approval verdict.
  using hook = createHook<ApprovalPayload>({ token: hookToken });
  const verdict = await hook;

  // Approver's edited actions win over the AI proposal when supplied.
  const finalActions = verdict.actions
    ? z.array(organizeActionSchema).parse(verdict.actions)
    : proposal.actions;

  if (!verdict.approved || finalActions.length === 0) {
    return { approved: false, applied: 0, actions: finalActions };
  }

  const outcome = await applyChanges(
    userId,
    finalActions,
    groups.filter((g) => g.permanent).map((g) => g.id)
  );
  return {
    approved: true,
    applied: outcome.applied,
    skipped: outcome.skipped,
    actions: finalActions,
  };
}
