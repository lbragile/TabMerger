import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * WXT auto-imports (unimport) every export of `src/components`, `src/composables`, `src/hooks`
 * and `src/utils` into every module that uses the name without importing it. To leave a module's
 * own declarations alone it matches them with regexes, and its class pattern is `class Name {`:
 * a `class Name extends Base {` is not seen as a declaration. So when an auto-import folder
 * exports a name that another module declares as `class … extends …`, the dev server injects
 * `import { Name } from '<auto-import dir>'` into that module on top of its own class —
 * "Identifier 'Name' has already been declared", and the whole popup renders blank. It happened
 * with `export { AiRequestError } from '@/lib/aiErrors'` in hooks/useAI.ts.
 *
 * Unit tests and `tsc` never see this (they don't run unimport), so these checks guard it:
 * 1. an auto-import folder never re-exports from a module outside the auto-import folders;
 * 2. no name an auto-import folder exports is declared as a class anywhere outside them.
 */

const SRC = resolve(__dirname, '../../..')
const AUTO_IMPORT_DIRS = ['components', 'composables', 'hooks', 'utils'].map((d) => join(SRC, d)).filter(existsSync)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : []
  })
}

const isAutoImportFile = (path: string) => AUTO_IMPORT_DIRS.some((dir) => path.startsWith(dir))
const allFiles = sourceFiles(SRC)
const autoImportFiles = allFiles.filter(isAutoImportFile)
const otherFiles = allFiles.filter((path) => !isAutoImportFile(path))

/** Value names a module exports (types are erased and never auto-imported). */
function exportedNames(code: string): string[] {
  const names = [...code.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const spec = part.trim()
      if (!spec || spec.startsWith('type ')) continue
      names.push(spec.split(/\s+as\s+/).pop()!.trim())
    }
  }
  return names
}

/** Classes a module declares (exported or not, at any depth). */
function declaredClasses(code: string): string[] {
  return [...code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
}

describe('WXT auto-import collisions', () => {
  it('auto-import folders never re-export from a module outside them', () => {
    const offenders = autoImportFiles.flatMap((path) => {
      const code = readFileSync(path, 'utf8')
      return [...code.matchAll(/^export\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gm)]
        .map((m) => m[1])
        .filter((from) => !from.startsWith('./') && !AUTO_IMPORT_DIRS.some((dir) => from.startsWith(`@/${relative(SRC, dir).replace(/\\/g, '/')}/`)))
        .map((from) => `${relative(SRC, path)} re-exports from ${from}`)
    })
    expect(offenders).toEqual([])
  })

  it('no name exported from an auto-import folder is declared as a class elsewhere in src', () => {
    const exported = new Map<string, string>()
    for (const path of autoImportFiles) {
      for (const name of exportedNames(readFileSync(path, 'utf8'))) exported.set(name, relative(SRC, path))
    }
    const offenders = otherFiles.flatMap((path) =>
      declaredClasses(readFileSync(path, 'utf8'))
        .filter((name) => exported.has(name))
        .map((name) => `${name}: declared in ${relative(SRC, path)}, exported from ${exported.get(name)}`)
    )
    expect(offenders).toEqual([])
  })
})
