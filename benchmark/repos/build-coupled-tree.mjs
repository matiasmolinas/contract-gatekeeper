#!/usr/bin/env node
// benchmark/repos/build-coupled-tree.mjs
//
// Deriva el árbol "acoplado" (`coupled/`) del árbol clásico (`classic/`) de
// forma mecánica: MISMO código y MISMOS tests, pero sin la estructura que hace
// barato un cambio. Todo el código de dominio queda en un único archivo
// (`src/app.js`) y todos los tests en otro (`test/app.test.js`).
//
// Es un acoplamiento "suave" y declarado: archivos grandes y un único lugar
// donde todas las historias escriben. NO introduce estado global mutable ni
// efectos ocultos entre módulos, que es lo que más duele en un monolito real;
// eso no se puede fabricar mecánicamente sin inventar código.
//
// Uso: node benchmark/repos/build-coupled-tree.mjs [--check]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLASSIC = path.join(HERE, 'classic')
const CHECK = process.argv.includes('--check')
const OUT = CHECK ? fs.mkdtempSync(path.join(os.tmpdir(), 'coupled-tree-')) : path.join(HERE, 'coupled')

// Orden de dependencias: cada módulo va después de los que usa.
const MODULES = [
  'src/core/types', 'src/core/complex', 'src/core/linalg', 'src/core/mna', 'src/core/measure',
  'src/core/montecarlo', 'src/core/e96', 'src/core/ia', 'src/core/spec', 'src/core/verify',
  'src/core/report', 'src/core/pipeline', 'src/contract/schemas', 'src/contract/validate',
  'src/support/support-core',
]
const TESTS = [
  'complex', 'linalg', 'mna', 'measure', 'montecarlo', 'e96', 'ia', 'spec', 'verify', 'report',
  'pipeline', 'contract', 'support', 'cli',
]

const read = rel => fs.readFileSync(path.join(CLASSIC, rel), 'utf8')
const write = (rel, content) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}
const short = mod => path.basename(mod)
export const banner = mod => `/* ===== ${short(mod)} ===== */`

// --- nombres locales (no exportados) que chocan al juntar los módulos ---------
const DECL = /^(export\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm
const declared = new Map() // nombre -> [{ mod, exported }]
for (const mod of MODULES) {
  for (const match of read(`${mod}.js`).matchAll(DECL)) {
    if (!declared.has(match[2])) declared.set(match[2], [])
    declared.get(match[2]).push({ mod, exported: Boolean(match[1]) })
  }
}
const renames = new Map() // mod -> [nombre]
for (const [name, places] of declared) {
  if (places.length < 2) continue
  for (const { mod, exported } of places) {
    if (exported) continue // el exportado conserva su nombre
    if (!renames.has(mod)) renames.set(mod, [])
    renames.get(mod).push(name)
  }
}

// --- src/app.js -----------------------------------------------------------------
const aliases = new Set()
const sections = MODULES.map(mod => {
  let source = read(`${mod}.js`)
    // Los imports entre módulos sobran (todo está en el mismo archivo); un alias
    // (`import { add as complexAdd }`) se conserva como constante, una sola vez.
    .replace(/^import\s+\{([^}]*)\}\s+from\s+'\.[^']*'\s*;?[ \t]*\n/gm, (_s, clause) =>
      clause
        .split(',')
        .map(part => part.trim().match(/^([\w$]+)\s+as\s+([\w$]+)$/))
        .filter(alias => alias && !aliases.has(alias[2]) && aliases.add(alias[2]))
        .map(alias => `const ${alias[2]} = ${alias[1]}\n`)
        .join('')
    )
    .replace(/^export \{\}\s*\n/gm, '')
  if (/^import\s[^\n]*from\s+'\./m.test(source)) throw new Error(`${mod}: queda un import relativo sin quitar`)
  for (const name of renames.get(mod) ?? []) {
    // identificador completo, que no sea una propiedad (`.name`) ni una clave (`name:`)
    source = source.replace(new RegExp(`(?<![.\\w$])${name}(?![\\w$]|\\s*:)`, 'g'), `${name}_${short(mod).replace(/\W/g, '_')}`)
  }
  return `${banner(mod)}\n\n${source.trim()}\n`
})
write('src/app.js', `${sections.join('\n')}`)

// --- src/cli.js -----------------------------------------------------------------
let cli = read('src/cli.js')
const cliBefore = cli
cli = cli.replace(/'\.\/(?:core|contract)\/[\w-]+\.js'/g, `'./app.js'`)
if (cli === cliBefore || /'\.\/(core|contract)\//.test(cli)) throw new Error('src/cli.js: no se reescribieron los imports')
write('src/cli.js', cli)

// --- test/app.test.js -----------------------------------------------------------
// Cada archivo de test pasa a ser un bloque; sus imports estáticos se vuelven
// imports dinámicos dentro del bloque para que los nombres no choquen.
const toDestructure = clause =>
  clause.split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+as\s+/, ': ')).join(', ')
const testBlocks = TESTS.map(name => {
  const body = read(`test/${name}.test.js`)
    .replace(/^import\s+(\w+)\s+from\s+'([^']+)'\s*;?[ \t]*$/gm, (_s, binding, spec) => `const { default: ${binding} } = await import('${spec}')`)
    .replace(/^import\s+\{([^}]*)\}\s+from\s+'([^']+)'\s*;?[ \t]*$/gm, (_s, clause, spec) => `const { ${toDestructure(clause)} } = await import('${spec}')`)
    .replace(/'\.\.\/src\/(?:core|contract|support)\/[\w-]+\.js'/g, `'../src/app.js'`)
    .replace(/canImport\('src\/core\/[\w-]+\.js'\)/g, `canImport('src/app.js')`)
  if (/^import\s/m.test(body)) throw new Error(`test/${name}.test.js: queda un import estático`)
  if (/src\/(core|contract|support)\//.test(body.replace(/^\s*\*.*$|skip: .*$/gm, ''))) {
    throw new Error(`test/${name}.test.js: queda una ruta al árbol clásico`)
  }
  return `${banner(name)}\n{\n${body.trim()}\n}\n`
})
write('test/app.test.js', testBlocks.join('\n'))

fs.cpSync(path.join(CLASSIC, 'examples'), path.join(OUT, 'examples'), { recursive: true })
write(
  'package.json',
  `${JSON.stringify({ name: 'circuit-pilot-coupled', private: true, type: 'module', scripts: { test: 'node --test test/' } }, null, 2)}\n`
)

// --- documento de orientación: la misma información que en los otros árboles -----
const classicDoc = read('ARCHITECTURE.md')
const moduleList = classicDoc.slice(classicDoc.indexOf('## Modules') + '## Modules'.length).trim()
const describe = new Map()
for (const line of moduleList.split('\n')) {
  const [files, summary] = line.replace(/^- /, '').split(' — ')
  for (const file of files.split(', ')) describe.set(file.replace(/`/g, '').replace(/\.js$/, ''), summary)
}
const seen = new Set()
const sectionLines = MODULES.filter(mod => mod !== 'src/core/types').map(mod => {
  const summary = describe.get(mod) ?? ''
  const first = !seen.has(summary)
  seen.add(summary)
  return `- \`${short(mod)}\`${first && summary ? ` — ${summary}` : ' — (same area as the section above)'}`
})
write(
  'ARCHITECTURE.md',
  `# Architecture

The application is a single source file plus a command-line shell.

- \`src/app.js\` — all the domain code: circuit solver, synthesis, spec parsing, verification, reporting, pipeline, data schemas and customer support.
- \`src/cli.js\` — command-line shell.
- \`test/app.test.js\` — all the tests. \`examples/\` — sample specs and netlists.

Inside \`src/app.js\` and \`test/app.test.js\` the code is laid out in sections, each starting with a \`/* ===== name ===== */\` comment. Run the tests with \`npm test\`.

## Sections of src/app.js, in order

${sectionLines.join('\n')}
`
)

// --- modo --check ---------------------------------------------------------------
if (CHECK) {
  const list = root => {
    const out = []
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else out.push(path.relative(root, full))
      }
    }
    if (fs.existsSync(root)) walk(root)
    return out.sort()
  }
  const committed = path.join(HERE, 'coupled')
  const differing = [...new Set([...list(OUT), ...list(committed)])].filter(
    rel =>
      !fs.existsSync(path.join(OUT, rel)) ||
      !fs.existsSync(path.join(committed, rel)) ||
      !fs.readFileSync(path.join(OUT, rel)).equals(fs.readFileSync(path.join(committed, rel)))
  )
  fs.rmSync(OUT, { recursive: true, force: true })
  if (differing.length) {
    console.error(`coupled/ no coincide con lo generado desde classic/:\n  ${differing.join('\n  ')}`)
    process.exit(1)
  }
  console.log('coupled/ coincide con lo generado desde classic/.')
} else {
  const renamed = [...renames].map(([mod, names]) => `${short(mod)}: ${names.join(', ')}`).join(' · ')
  console.log(`Árbol acoplado generado en ${path.relative(process.cwd(), OUT)}. Locales renombrados → ${renamed}`)
}
