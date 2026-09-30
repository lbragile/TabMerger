/**
 * Keys for the /beta test-step checkboxes. Plain module (not 'use client') so the server page
 * and the client checklist components share it.
 *
 * A key is the area id plus a hash of the step's TEXT, not its position: inserting a step keeps
 * every other checkmark, and rewording a step (i.e. asking testers to do something new) clears
 * just that one.
 */
export function betaStepKey(areaId: string, step: string): string {
  // djb2: tiny, stable, and more than enough to tell a few hundred steps apart.
  let hash = 5381
  for (let i = 0; i < step.length; i++) hash = ((hash << 5) + hash + step.charCodeAt(i)) | 0
  return `${areaId}:${(hash >>> 0).toString(36)}`
}

/** Key for one "Good looks like" outcome's checkbox; prefixed so it can never equal a step's key. */
export function betaGoodKey(areaId: string, outcome: string): string {
  return betaStepKey(areaId, `good:${outcome}`)
}

/** Every checkbox key in a test area: each item's steps, then its "Good looks like" outcomes. */
export function betaAreaKeys(areaId: string, items: { steps: string[]; good: string[] }[]): string[] {
  return items.flatMap((item) => [
    ...item.steps.map((step) => betaStepKey(areaId, step)),
    ...item.good.map((outcome) => betaGoodKey(areaId, outcome)),
  ])
}
