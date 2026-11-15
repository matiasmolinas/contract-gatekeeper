// benchmark/stories.ts
// Las 12 historias del experimento. Quedan fijadas ANTES de correr nada:
// - `prompt` es lo único que recibe el agente, idéntico en los dos brazos;
// - `test` es el test de aceptación oculto (el agente nunca lo ve);
// - `reference` es una solución de referencia que prueba que el test es
//   satisfacible y que falla sobre el árbol base (ver test/stories.test.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface StoryDef {
  id: string;
  title: string;
  /** Cápsula que el planificador le asigna (clave de lock en el brazo de plugins). null = shell compartido. */
  capsule: string | null;
  prompt: string;
  /** Símbolos del proyecto que usa el test, por módulo del árbol clásico. */
  uses: { module: string; names: string[] }[];
  /** Cuerpo del test de aceptación (node:test + assert/strict ya importados). */
  test: string;
  /** Solución de referencia: reemplazos exactos sobre archivos del árbol clásico. */
  reference: { file: string; edits: [string, string][] }[];
  /** Exports nuevos que la solución agrega (en plugins hay que declararlos en el manifest). */
  newExports?: Record<string, 'function' | 'constant'>;
}

const SPEC = `{"schema":"cir/CircuitSpec/v1","id":"ia-gain100","target":"instrumentation_amplifier","gain":{"nominal":100,"tolerancePct":5},"bandwidthHz":10000,"cmrrMinDb":80,"supply":{"positiveV":15,"negativeV":-15},"inputRangeV":{"minV":-0.01,"maxV":0.01},"sourceImpedanceOhm":350,"constraints":{"resistorSeries":"E96","monolithicAllowed":true,"opAmpModel":"generic-10mhz"}}`;
const METRICS = `{"gain":{"nominal":100,"measured":100.9896,"errorPct":0.98959805,"mcP95AbsPct":1.8155471},"bandwidthHz":98407.447,"cmrrDb":200,"cmrrMinDb":80}`;

const SUPPORT = 'src/support/support-core';

export const STORIES: StoryDef[] = [
  {
    id: 'S01',
    title: 'Wiki search ignores the article key',
    capsule: 'support-studio',
    prompt:
      'In the customer-support module, `searchWiki(text)` is meant to give extra weight to an article when the ticket text mentions that article\'s key (the knowledge-base keys are `api`, `login`, `billing`, `integration` and `bug`), but that bonus is never applied. Fix it: a text that contains an article\'s key must score 2 extra points for that article, even when none of its keywords match. A text that matches nothing must still return `{ found: false }`.',
    uses: [{ module: SUPPORT, names: ['searchWiki'] }],
    test: `test('S01 the article key counts', () => {
  assert.equal(searchWiki('I have a question about the api').key, 'api')
  assert.equal(searchWiki('there is a bug somewhere').key, 'bug')
  assert.equal(searchWiki('duplicate charge on my invoice').key, 'billing')
  assert.deepEqual(searchWiki('what a lovely day'), { found: false })
})`,
    reference: [
      {
        file: 'src/support/support-core.js',
        edits: [
          ['    const score = cats.reduce(', '    let score = cats.reduce('],
          ['    if (lower.includes(key)) score + 2', '    if (lower.includes(key)) score += 2']
        ]
      }
    ]
  },
  {
    id: 'S02',
    title: 'Wiki article generation crashes on a matching ticket',
    capsule: 'support-studio',
    prompt:
      'In the customer-support module, `generateWikiArticle(input)` throws when `input` is a string that matches a knowledge-base article. Fix it. For a string that matches an article it must return the Markdown article whose title is `<article title> (resolved)`, whose root cause is the article\'s title and whose resolution is the article\'s body. For a string with no match the current output (title `New issue resolved`) must be kept.',
    uses: [{ module: SUPPORT, names: ['generateWikiArticle'] }],
    test: `test('S02 string input that matches an article', () => {
  const md = generateWikiArticle('Webhook delivery is intermittent')
  assert.match(md, /^# Webhook delivery is intermittent \\(resolved\\)/)
  assert.match(md, /## Root cause\\n\\nWebhook delivery is intermittent/)
  assert.match(md, /retry backoff/)
})
test('S02 string input with no match is unchanged', () => {
  assert.match(generateWikiArticle('what a lovely day'), /^# New issue resolved/)
})`,
    reference: [
      {
        file: 'src/support/support-core.js',
        edits: [
          [
            '    const r = draftReply({ text: input })\n',
            '    const r = draftReply({ text: input })\n    const article = r.wiki.found ? KNOWLEDGE_BASE[r.wiki.key] : null\n'
          ],
          ['${r.wiki.article.title} (resolved)', '${article.title} (resolved)'],
          ['cause: r.wiki.found ? r.wiki.article.title', 'cause: r.wiki.found ? article.title'],
          ['resolution: r.wiki.found ? r.wiki.article.body', 'resolution: r.wiki.found ? article.body']
        ]
      }
    ]
  },
  {
    id: 'S03',
    title: 'Rate-limit tickets are under-prioritised',
    capsule: 'support-studio',
    prompt:
      'In the customer-support module, `classifyTicket(text)` under-prioritises rate-limit tickets. When the text mentions `429`, `rate limit` or `too many requests` (case-insensitive) the urgency must be at least `medium`; texts that already qualify as `high` stay `high`. Also make `too many requests` count as a keyword of the `api` category. Nothing else about the classification may change.',
    uses: [{ module: SUPPORT, names: ['classifyTicket'] }],
    test: `test('S03 rate-limit tickets are at least medium', () => {
  assert.deepEqual(
    [classifyTicket('We keep getting 429 from the endpoint').category, classifyTicket('We keep getting 429 from the endpoint').urgency],
    ['api', 'medium']
  )
  const tmr = classifyTicket('Too Many Requests all morning')
  assert.equal(tmr.category, 'api')
  assert.equal(tmr.urgency, 'medium')
  assert.equal(classifyTicket('urgent: rate limit hit').urgency, 'high')
  assert.deepEqual(classifyTicket('hello there'), { category: 'other', sentiment: 'neutral', urgency: 'low' })
})`,
    reference: [
      {
        file: 'src/support/support-core.js',
        edits: [
          ["'websocket', 'authentication error'],", "'websocket', 'authentication error', 'too many requests'],"],
          [
            "    : (lower.match(/\\b(same day|today|soon|frustrated|angry)\\b/) ? 'medium' : 'low')",
            "    : (lower.match(/\\b(same day|today|soon|frustrated|angry)\\b/) || /429|rate limit|too many requests/.test(lower) ? 'medium' : 'low')"
          ]
        ]
      }
    ]
  },
  {
    id: 'S04',
    title: 'Redact leaked secrets before they reach the wiki',
    capsule: 'support-studio',
    prompt:
      'In the customer-support module, add and export a function `redactSecrets(text)`. It replaces every API key of the form `sk-` followed by 8 or more letters or digits with `[REDACTED]`, and every bearer token (the run of non-space characters after `Bearer `) with `[REDACTED]`, keeping the word `Bearer`. `generateWikiArticle` must pass the symptom, the root cause and the resolution through it, so no secret is written into a wiki article.',
    uses: [{ module: SUPPORT, names: ['redactSecrets', 'generateWikiArticle'] }],
    test: `test('S04 redactSecrets masks keys and bearer tokens', () => {
  assert.equal(redactSecrets('key sk-abc12345XYZ here'), 'key [REDACTED] here')
  assert.equal(redactSecrets('Authorization: Bearer abc.def-123'), 'Authorization: Bearer [REDACTED]')
  assert.equal(redactSecrets('nothing secret, sk-short'), 'nothing secret, sk-short')
})
test('S04 wiki articles never contain secrets', () => {
  const md = generateWikiArticle({ title: 'Leak', symptom: 'my key sk-abc12345XYZ leaked', cause: 'pasted Bearer tok_999 in chat', resolution: 'rotate it' })
  assert.doesNotMatch(md, /sk-abc12345XYZ/)
  assert.doesNotMatch(md, /tok_999/)
  assert.match(md, /\\[REDACTED\\]/)
})`,
    reference: [
      {
        file: 'src/support/support-core.js',
        edits: [
          [
            '/** Render a single wiki article in Markdown. */',
            "/** Mask API keys and bearer tokens. */\nexport function redactSecrets(text = '') {\n  return String(text)\n    .replace(/sk-[A-Za-z0-9]{8,}/g, '[REDACTED]')\n    .replace(/Bearer\\s+\\S+/g, 'Bearer [REDACTED]')\n}\n\n/** Render a single wiki article in Markdown. */"
          ],
          ["    symptom || '_Not provided_',", "    redactSecrets(symptom || '_Not provided_'),"],
          ["    cause || '_Under investigation_',", "    redactSecrets(cause || '_Under investigation_'),"],
          ["    resolution || '_Pending_',", "    redactSecrets(resolution || '_Pending_'),"]
        ]
      }
    ],
    newExports: { redactSecrets: 'function' }
  },
  {
    id: 'S05',
    title: 'Spanish urgency terms in ticket classification',
    capsule: 'support-studio',
    prompt:
      'In the customer-support module, make `classifyTicket(text)` understand Spanish. The words `urgente`, `caído` (also written `caido`) and `bloqueado` must give urgency `high`, and the phrase `no funciona` must count as a keyword of the `bug` category. English behaviour must not change.',
    uses: [{ module: SUPPORT, names: ['classifyTicket'] }],
    test: `test('S05 Spanish urgency and bug keyword', () => {
  assert.equal(classifyTicket('El servicio está caído').urgency, 'high')
  assert.equal(classifyTicket('el sistema esta caido desde ayer').urgency, 'high')
  assert.equal(classifyTicket('estoy bloqueado, es urgente').urgency, 'high')
  assert.equal(classifyTicket('el botón no funciona').category, 'bug')
  assert.deepEqual(classifyTicket('hello there'), { category: 'other', sentiment: 'neutral', urgency: 'low' })
})`,
    reference: [
      {
        file: 'src/support/support-core.js',
        edits: [
          ["'fails', 'exception', 'white screen'],", "'fails', 'exception', 'white screen', 'no funciona'],"],
          ['(urgent|asap|immediately|critical|outage|down)', '(urgent|asap|immediately|critical|outage|down|urgente|caído|caido|bloqueado)']
        ]
      }
    ]
  },
  {
    id: 'S06',
    title: 'E24 resistor series',
    capsule: 'resistor-series',
    prompt:
      'In the resistor-series module (the one that provides `E96` and `nearestE96`), add the E24 series. Export `E24`, a frozen array with the 24 standard E24 mantissas (1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1), and `nearestE24(valueOhm)`, which behaves exactly like `nearestE96` (same return shape `{ valueOhm, errorPct }`, same validation and errors) but picks from the E24 series.',
    uses: [{ module: 'src/core/e96', names: ['E24', 'nearestE24'] }],
    test: `test('S06 E24 series', () => {
  assert.equal(E24.length, 24)
  assert.ok(Object.isFrozen(E24))
  assert.equal(nearestE24(1000).valueOhm, 1000)
  assert.equal(nearestE24(4990).valueOhm, 5100)
  assert.equal(nearestE24(123).valueOhm, 120)
  assert.ok(Math.abs(nearestE24(123).errorPct - ((120 - 123) / 123) * 100) < 1e-6)
  assert.throws(() => nearestE24(0), RangeError)
})`,
    reference: [
      {
        file: 'src/core/e96.js',
        edits: [
          [
            '/**\n * Formatea una resistencia en ohmios con prefijo legible.',
            "export const E24 = Object.freeze([\n  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,\n  3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,\n])\n\n/** Valor E24 comercial más cercano. */\nexport function nearestE24(valueOhm) {\n  const requested = requirePositive(valueOhm, 'nearestE24')\n  const exponent = Math.floor(Math.log10(requested))\n  let best = null\n  for (let decade = exponent - 1; decade <= exponent + 1; decade += 1) {\n    for (const mantissa of E24) {\n      const candidate = canonicalize(mantissa * 10 ** decade)\n      if (candidate <= 0) continue\n      const errorPct = ((candidate - requested) / requested) * 100\n      const distance = Math.abs(errorPct)\n      if (best === null || distance < best.distance) best = { valueOhm: candidate, errorPct, distance }\n    }\n  }\n  return { valueOhm: best.valueOhm, errorPct: best.errorPct }\n}\n\n/**\n * Formatea una resistencia en ohmios con prefijo legible."
          ]
        ]
      }
    ],
    newExports: { E24: 'constant', nearestE24: 'function' }
  },
  {
    id: 'S07',
    title: 'Format sub-ohm resistances in milliohms',
    capsule: 'resistor-series',
    prompt:
      'In the resistor-series module, `formatOhm(valueOhm)` prints sub-ohm values awkwardly (`0.05 Ω`). For a non-zero value whose absolute value is below 1 Ω it must use milliohms with the same number formatting as the other ranges: `formatOhm(0.05)` is `"50 mΩ"`. Zero stays `"0 Ω"` and every other range is unchanged.',
    uses: [{ module: 'src/core/e96', names: ['formatOhm'] }],
    test: `test('S07 milliohms', () => {
  assert.equal(formatOhm(0.05), '50 mΩ')
  assert.equal(formatOhm(0.0047), '4.7 mΩ')
  assert.equal(formatOhm(0), '0 Ω')
  assert.equal(formatOhm(202), '202 Ω')
  assert.equal(formatOhm(10000), '10 kΩ')
})`,
    reference: [
      {
        file: 'src/core/e96.js',
        edits: [
          [
            "  } else {\n    scaled = valueOhm\n    unit = 'Ω'\n  }",
            "  } else if (abs > 0 && abs < 1) {\n    scaled = valueOhm * 1e3\n    unit = 'mΩ'\n  } else {\n    scaled = valueOhm\n    unit = 'Ω'\n  }"
          ]
        ]
      }
    ]
  },
  {
    id: 'S08',
    title: 'Format gigahertz frequencies in reports',
    capsule: 'report-render',
    prompt:
      'In the report module, `fmtHz(hz)` prints gigahertz values as thousands of megahertz (`1000 MHz`). For absolute values of 1e9 Hz or more it must use `GHz`, with the same number formatting it uses for MHz: `fmtHz(2.4e9)` is `"2.4 GHz"`. Lower ranges are unchanged.',
    uses: [{ module: 'src/core/report', names: ['fmtHz'] }],
    test: `test('S08 gigahertz', () => {
  assert.equal(fmtHz(2.4e9), '2.4 GHz')
  assert.equal(fmtHz(1e9), '1 GHz')
  assert.equal(fmtHz(10e6), '10 MHz')
  assert.equal(fmtHz(1000), '1 kHz')
})`,
    reference: [
      {
        file: 'src/core/report.js',
        edits: [
          [
            '  if (abs >= 1e6) return `${fmtNum(hz / 1e6, 3)} MHz`',
            '  if (abs >= 1e9) return `${fmtNum(hz / 1e9, 3)} GHz`\n  if (abs >= 1e6) return `${fmtNum(hz / 1e6, 3)} MHz`'
          ]
        ]
      }
    ]
  },
  {
    id: 'S09',
    title: 'List the failed checks in the verification report',
    capsule: 'design-verify',
    prompt:
      'The report returned by `verifyDesign(spec, metrics)` must include a new field `failedChecks`: an array with the `id` of every check whose `pass` is not true, in the order of `checks` (an empty array when everything passes). The report must still be valid against `VERIFICATION_SCHEMA`.',
    uses: [
      { module: 'src/core/verify', names: ['verifyDesign'] },
      { module: 'src/contract/schemas', names: ['VERIFICATION_SCHEMA'] },
      { module: 'src/contract/validate', names: ['validate'] }
    ],
    test: `const SPEC = ${SPEC}
const METRICS = ${METRICS}
test('S09 failedChecks is empty when the design passes', () => {
  const report = verifyDesign(SPEC, METRICS)
  assert.deepEqual(report.failedChecks, [])
  assert.equal(validate(VERIFICATION_SCHEMA, report).valid, true)
})
test('S09 failedChecks lists the checks that fail', () => {
  const report = verifyDesign(SPEC, { ...METRICS, bandwidthHz: 1 })
  assert.equal(report.pass, false)
  assert.ok(report.failedChecks.includes('BANDWIDTH'))
  assert.deepEqual(report.failedChecks, report.checks.filter((c) => c.pass !== true).map((c) => c.id))
  assert.equal(validate(VERIFICATION_SCHEMA, report).valid, true)
})`,
    reference: [
      {
        file: 'src/core/verify.js',
        edits: [['    checks,\n    warnings,\n  }', '    checks,\n    failedChecks: checks.filter((item) => item.pass !== true).map((item) => item.id),\n    warnings,\n  }']]
      },
      {
        file: 'src/contract/schemas.js',
        edits: [
          [
            "    warnings: { type: 'array', items: { type: 'string' } },\n  },\n  additionalProperties: false,\n}\n\nexport const MANIFEST_SCHEMA",
            "    warnings: { type: 'array', items: { type: 'string' } },\n    failedChecks: { type: 'array', items: { type: 'string' } },\n  },\n  additionalProperties: false,\n}\n\nexport const MANIFEST_SCHEMA"
          ]
        ]
      }
    ]
  },
  {
    id: 'S10',
    title: 'Gain given in decibels in free-text requirements',
    capsule: 'spec-parser',
    prompt:
      'When `parseRequirement` receives free text, the gain may be given in decibels: a number followed by `dB` right after the gain keyword, as in `ganancia de 40 dB` or `gain 20 dB`. In that case the nominal gain of the spec must be the linear value in V/V, `10^(dB/20)` (40 dB is 100). A gain without `dB` keeps its current meaning, and a `dB` figure that belongs to something else (such as the CMRR) must not be read as the gain.',
    uses: [{ module: 'src/core/spec', names: ['parseRequirement'] }],
    test: `test('S10 gain in dB', () => {
  const a = parseRequirement('Necesito un amplificador de instrumentación con ganancia de 40 dB, ancho de banda 10 kHz y alimentación ±15 V')
  assert.ok(Math.abs(a.spec.gain.nominal - 100) < 1e-9)
  const b = parseRequirement('Instrumentation amplifier, gain 20 dB, bandwidth 10 kHz, supply ±15 V')
  assert.ok(Math.abs(b.spec.gain.nominal - 10) < 1e-9)
})
test('S10 linear gain and CMRR in dB are unchanged', () => {
  const c = parseRequirement('Amplificador con ganancia 100, CMRR 80 dB, ancho de banda 10 kHz, ±15 V')
  assert.equal(c.spec.gain.nominal, 100)
  assert.equal(c.spec.cmrrMinDb, 80)
})`,
    reference: [
      {
        file: 'src/core/spec.js',
        edits: [
          [
            '      const value = parseDecimal(match[1])\n      if (Number.isFinite(value) && value >= 1) return value',
            '      const raw = parseDecimal(match[1])\n      const end = match.index + match[0].length\n      const value = /^\\s*db\\b/i.test(text.slice(end, end + 5)) ? 10 ** (raw / 20) : raw\n      if (Number.isFinite(value) && value >= 1) return value'
          ]
        ]
      }
    ]
  },
  {
    id: 'S11',
    title: 'CLI command to list the example specs',
    capsule: null,
    prompt:
      'Add a `list-specs` command to the command-line shell (`node src/cli.js list-specs`). It prints the file names of the JSON files in `examples/specs`, sorted alphabetically, one per line and nothing else, and exits with code 0. It must work regardless of the current working directory.',
    uses: [],
    test: `import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
test('S11 list-specs prints the example specs', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const expected = readdirSync(root + 'examples/specs').filter((f) => f.endsWith('.json')).sort()
  const result = spawnSync(process.execPath, [root + 'src/cli.js', 'list-specs'], { cwd: os.tmpdir(), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.trim().split('\\n'), expected)
})`,
    reference: [
      {
        file: 'src/cli.js',
        edits: [
          ["    case 'selftest':\n      return cmdSelftest()", "    case 'selftest':\n      return cmdSelftest()\n    case 'list-specs':\n      return cmdListSpecs()"],
          [
            'function isMainModule() {',
            "async function cmdListSpecs() {\n  const dir = fileURLToPath(new URL('../examples/specs/', import.meta.url))\n  const files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort()\n  for (const file of files) out(file)\n  return 0\n}\n\nfunction isMainModule() {"
          ]
        ]
      }
    ]
  },
  {
    id: 'S12',
    title: 'Summary block in the design pipeline result',
    capsule: 'design-pipeline',
    prompt:
      'The object returned by `designPipeline(input, options)` must include a new field `summary` with exactly these keys: `pass` (the verification\'s `pass`), `gainMeasured` (`metrics.gain.measured`), `bandwidthHz` (`metrics.bandwidthHz`) and `failedChecks` (the `id` of every verification check whose `pass` is not true, in order; empty when everything passes).',
    uses: [{ module: 'src/core/pipeline', names: ['designPipeline'] }],
    test: `const SPEC = ${SPEC}
test('S12 summary of a passing design', () => {
  const result = designPipeline(SPEC)
  assert.deepEqual(Object.keys(result.summary).sort(), ['bandwidthHz', 'failedChecks', 'gainMeasured', 'pass'])
  assert.equal(result.summary.pass, true)
  assert.deepEqual(result.summary.failedChecks, [])
  assert.equal(result.summary.gainMeasured, result.metrics.gain.measured)
  assert.equal(result.summary.bandwidthHz, result.metrics.bandwidthHz)
})
test('S12 summary of a failing design', () => {
  const result = designPipeline({ ...SPEC, gain: { nominal: 100, tolerancePct: 0.01 } })
  assert.equal(result.summary.pass, false)
  assert.deepEqual(result.summary.failedChecks, result.verification.checks.filter((c) => c.pass !== true).map((c) => c.id))
  assert.ok(result.summary.failedChecks.length > 0)
})`,
    reference: [
      {
        file: 'src/core/pipeline.js',
        edits: [
          [
            '  return result\n}',
            '  result.summary = {\n    pass: verification.pass,\n    gainMeasured: metrics.gain.measured,\n    bandwidthHz: metrics.bandwidthHz,\n    failedChecks: verification.checks.filter((item) => item.pass !== true).map((item) => item.id),\n  }\n  return result\n}'
          ]
        ]
      }
    ]
  }
];

// ---------------------------------------------------------------------------

export type ArmName = 'coupled' | 'classic' | 'plugins' | 'plugins-nolock';

/** Árbol de código que usa cada brazo (`plugins-nolock` usa el mismo que `plugins`). */
export const treeOf = (arm: ArmName): 'coupled' | 'classic' | 'plugins' => (arm === 'plugins-nolock' ? 'plugins' : arm);

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** módulo del árbol clásico -> cápsula que lo contiene en el árbol de plugins */
export const MODULE_MAP: Record<string, { capability: string; dir: string }> = JSON.parse(
  fs.readFileSync(path.join(HERE, 'repos/module-map.json'), 'utf-8')
);

/** Ruta de un archivo del árbol clásico en el árbol de plugins. */
export function pluginPath(classicFile: string): string {
  const owner = MODULE_MAP[classicFile.replace(/\.js$/, '')];
  return owner ? `plugins/${owner.dir}/lib/${path.basename(classicFile)}` : classicFile;
}

/** Ruta de un archivo del árbol clásico en el árbol acoplado, y la sección que le corresponde ahí. */
export function coupledPath(classicFile: string): { file: string; section: string | null } {
  return classicFile === 'src/cli.js'
    ? { file: classicFile, section: null }
    : { file: 'src/app.js', section: path.basename(classicFile, '.js') };
}

/** Fuente del test de aceptación de una historia para un brazo (va en `test/`). */
export function acceptanceSource(story: StoryDef, armName: ArmName): string {
  const arm = treeOf(armName);
  const header = ["import test from 'node:test'", "import assert from 'node:assert/strict'"];
  if (arm === 'classic') {
    for (const use of story.uses) header.push(`import { ${use.names.join(', ')} } from '../${use.module}.js'`);
  } else if (arm === 'coupled') {
    const names = story.uses.flatMap(use => use.names);
    if (names.length > 0) header.push(`import { ${names.join(', ')} } from '../src/app.js'`);
  } else if (story.uses.length > 0) {
    header.push("import { load } from '#runtime'");
    for (const use of story.uses) {
      header.push(`const { ${use.names.join(', ')} } = await load('${MODULE_MAP[use.module].capability}')`);
    }
  }
  return `${header.join('\n')}\n\n${story.test}\n`;
}
