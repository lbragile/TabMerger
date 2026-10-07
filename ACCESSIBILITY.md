# Accessibility

TabMerger helps people keep their browser tabs under control, and that only works if everyone
can use it: people who use a keyboard instead of a mouse, a screen reader, a magnifier, high
contrast, or reduced motion, and people who just find the interface hard to read. We also want
people who use these tools to be able to contribute.

This document says what we are working toward, what we expect from contributions, how to report
a barrier, and, most importantly, what is known to work and not work today. It covers the browser
extension (Chrome, Edge and Firefox) and the website (marketing pages, sign-in, the dashboard
and the account page, plus the testers' guide on the preview site). TabMerger is source-available, not open source; see
[`LICENSE.md`](LICENSE.md) and [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) for what
that means for contributions.

## Priorities

We use [WCAG 2.2](https://www.w3.org/TR/WCAG22) Level AA as a target that guides our work. It is
not a claim that TabMerger has been audited or conforms to it. Parts of it have been checked
(see Supported environments), and parts have not.

What we work toward, in this order:

- **Keyboard support.** Everything you can do with a mouse should be possible from the keyboard,
  with a visible focus indicator and no keyboard traps. This includes moving tabs, windows and
  groups, which has a keyboard-only mode.
- **Screen reader support.** Controls have names, roles and states, dialogs behave like dialogs,
  and changes that matter (a move finishing, the selection count, sync status) are announced.
- **Readable content.** Enough contrast in both light and dark themes, meaningful link text,
  text alternatives for images, and no information carried by color alone.
- **Motion.** Animation should respect the "reduce motion" setting of your system.
- **Language.** The extension and the website are in English only, and both declare that.

## Contributor expectations

If your change touches the interface or the documentation, please check the following before you
open a pull request, and say in the pull request what you checked.

- **Automated check.** The extension has an automated scan (axe-core, run through Playwright) in
  its end-to-end tests. Run it with `pnpm --filter @tabmerger/extension test:e2e`. It covers only
  the popup's default and selection-mode states, so it does not replace the checks below.
- **Keyboard-only pass.** Use only the keyboard: every control is reachable, the tab order
  follows the visual order, the focus indicator is always visible (light and dark theme), dialogs
  keep focus inside while open and return it when closed, and nothing traps you.
- **Screen reader spot check.** With any screen reader, confirm that controls announce a name,
  a role and their state, and that results of actions are announced. Icon-only buttons need an
  `aria-label` or hidden text.
- **Contrast.** Check text and icons against their real background, including the group colors
  people can choose, not only the default theme.
- **Drag and drop.** Do not change the drag handle labels, the `listitem` role on tab rows or the
  focus handling without reading the drag-and-drop notes in
  [`docs/drag-and-drop-spec.md`](docs/drag-and-drop-spec.md). Several of them are relied on by
  both the keyboard and the pointer behavior.
- **Documentation and content.** Use a logical heading order, descriptive link text (never "click
  here"), alt text on images that carry meaning (empty alt on decorative ones), captions or a
  transcript for video, and do not rely on color alone. Content should still be readable when
  zoomed to 400 percent.
- **Continuous integration.** CI runs the extension's end-to-end tests, which include the axe
  scan above, and lints both packages. The web lint setup uses the Next.js standard configuration,
  which carries a few basic accessibility rules; the extension lint has none. There is no
  dedicated accessibility check that blocks a merge, so review depends on the steps above.

## Reporting accessibility issues

If something in TabMerger is hard or impossible to use, please tell us.

- Open an issue using the
  [accessibility template](https://github.com/lbragile/TabMerger/issues/new?template=accessibility.md)
  on GitHub.
- If you cannot or prefer not to use GitHub, use the website's
  [contact page](https://tabmerger.vercel.app/contact).

Helpful details, none of them required: what you were trying to do, where (the extension popup,
or the page address), what happened, the steps to reproduce it, your operating system, browser
and extension version, and the assistive technology you use with its version. A screenshot or a
recording helps but is optional. You never need to tell us about a disability.

### Severity

When you report an issue you can give your best guess; we will set the final level.

- **Critical:** you cannot complete a core task and there is no way around it. Example: the
  popup cannot be operated from the keyboard at all, or a dialog traps focus and you cannot get
  out.
- **Serious:** the task is possible but very hard, or only with a long workaround. Example: a
  button has no accessible name, so a screen reader user cannot tell what it does.
- **Moderate:** the task is possible with some extra effort. Example: focus lands in an
  unexpected place after a keyboard move, so you have to find your way back.
- **Minor:** an annoyance that does not stop you. Example: a decorative icon is announced, or an
  accent color is faint but the same information is also given in text.

### How we respond

We aim to acknowledge a report within 7 days. We then confirm the barrier, set a severity, and
reply on the issue with what we plan to do or the workaround we know of.

### Resolution expectations

Targets, counted from when the issue is opened:

- Critical: a fix or a workaround within 30 days.
- Serious: within 60 days.
- Moderate and Minor: within 90 days, best effort.

These are targets from a single maintainer, not guarantees. If we cannot meet one, the issue
will say why and give a revised date.

## Ownership and maintenance

The maintainer, [@lbragile](https://github.com/lbragile), owns accessibility. That means triaging
reports, setting severity, reviewing the accessibility part of pull requests, and keeping this
document accurate. It is reviewed at each stable release and whenever a report shows it is wrong.

## Supported environments

TabMerger runs in Chrome, Edge and Firefox on desktop. There is no mobile app and no Safari
extension.

What has actually been evaluated:

- **Keyboard:** the popup's keyboard behavior (tab stops, arrow keys within rows, the keyboard
  move mode) was designed and checked by reading the code and through automated tests. It has
  been exercised in Chromium-based test runs. Firefox and Edge were not checked specifically for
  keyboard behavior.
- **Automated scan:** the axe-core scan described above, on two popup states, in Chromium.
- **Screen readers:** the repository shows no full pass with NVDA, JAWS, VoiceOver or Narrator.
  The announcements are present in the code, but we have not confirmed what these tools say.
  Treat screen reader support as untested, and please tell us what you find.
- **Website:** no assistive technology testing is recorded. Images and form labels were checked
  by reading the code.

## Known limitations

These are the barriers we know about, with workarounds where there is one.

- **Screen reader output after a keyboard move is unconfirmed.** After you move an item with the
  keyboard, focus moves right after the announcement of the result. Some screen readers cut
  speech short when focus changes, so you may not hear where the item landed. Workaround: after
  a move, read the item's position with your screen reader's normal reading commands.
- **Focus after emptying a window.** If a keyboard move leaves a window with no tabs, focus
  lands on a neighboring window instead of the emptied one.
- **Rows contain a hidden menu button.** Group, window and tab rows are buttons that also hold a
  hidden button for their context menu. The automated scan skips this check because of it, and
  some assistive technology may handle these rows oddly. We have not found a workaround; if
  you run into this, please report what you see.
- **Weak contrast on some group colors.** Group colors are chosen by you. Small accents drawn
  in the group color (the star, the starred border, the incognito marker, the "renamed" label)
  can be faint: the "Slate dark" preset is nearly invisible in the dark theme, and the yellow,
  green, cyan, teal and orange presets fall below 3:1 against the light theme background. These
  accents are not the only way to tell the state (the star button and its label say it too),
  but they are hard to see. Workaround: pick a different group color.
- **Group name chips in search results.** Search results show the group name as small white text
  on the group's color. We have not measured it, but it will be hard to read on light presets
  such as yellow. The group name is also shown elsewhere in the sidebar.
- **Very small text.** Some secondary text in the popup, such as section headings and hints in
  the search overlay, is 10 pixels high. Its contrast against the background has not been
  measured in full.
- **Demo video has no captions or transcript.** The demo on the landing page has no captions,
  audio description or text transcript. It starts muted, plays automatically and loops, and does
  not check the reduce motion setting; it does have player controls to pause it. The
  [Features page](https://tabmerger.vercel.app/features) describes the same features in text.
- **Motion on the website.** Only the reviews carousel on the website stops moving when your
  system asks for reduced motion. Other website animations have not been checked. The extension
  does respect that setting.
- **No skip link on the website.** Keyboard users must tab through the navigation on every page.
- **Contrast of the default accent color.** In the extension's light theme, the main teal
  accent is about 3:1 against white. That is enough for large text and icons but short of the
  level we want for small text that uses it.
- **Limited automated testing.** The scan covers few states, and the dialogs, the dashboard and
  the website have no automated accessibility checks.

## Feedback

If you have an idea for improving this statement or how we handle accessibility, open an issue on
[GitHub](https://github.com/lbragile/TabMerger/issues) or use the website's
[contact page](https://tabmerger.vercel.app/contact). If something here is wrong or out of date,
please say so; we would rather correct it than leave it.
