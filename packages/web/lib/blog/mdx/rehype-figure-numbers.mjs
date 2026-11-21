/**
 * Rehype plugin for the blog's MDX: numbers the post's figures 1, 2, 3… in document order, so no
 * post hand-types a figure number. Each `<AnnotatedFigure>` / `<ThemedScreenshot>` gets a
 * `figure={n}` prop.
 *
 * The per-browser variants of a section (`<BrowserPanel>` children of one `<BrowserPanels>`) are
 * alternatives, only one of which shows: each panel is numbered from the same starting number,
 * and the count after the group moves on by the longest panel's figures, so numbering doesn't
 * jump when another browser is selected.
 *
 * Plain JavaScript without dependencies, given to @next/mdx by path in next.config.ts (Turbopack
 * only takes plugins by name or path, with JSON-serialisable options).
 */

/** Components that render a numbered figure. */
export const FIGURE_COMPONENTS = ['AnnotatedFigure', 'ThemedScreenshot']

const isJsx = (node) => node && (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement')

function setFigureNumber(node, n) {
  node.attributes = (node.attributes ?? []).filter((a) => !(a.type === 'mdxJsxAttribute' && a.name === 'figure'))
  node.attributes.push({ type: 'mdxJsxAttribute', name: 'figure', value: String(n) })
}

/** Numbers the figures under `node` from `next`; answers the next free number. */
function numberFigures(node, next) {
  if (isJsx(node) && FIGURE_COMPONENTS.includes(node.name)) {
    setFigureNumber(node, next)
    return next + 1
  }
  if (isJsx(node) && node.name === 'BrowserPanels') {
    let end = next
    for (const child of node.children ?? []) end = Math.max(end, numberFigures(child, next))
    return end
  }
  for (const child of node.children ?? []) next = numberFigures(child, next)
  return next
}

export default function rehypeFigureNumbers() {
  return (tree) => {
    numberFigures(tree, 1)
  }
}
