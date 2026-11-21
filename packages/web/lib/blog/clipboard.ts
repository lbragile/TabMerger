/** Copies `text` to the clipboard; answers whether it worked (refused, insecure page, no API). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
