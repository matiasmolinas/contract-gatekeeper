# Architecture

The application is a set of isolated capsules under `plugins/`, plus a thin shell.

- `plugins/<capsule>/index.js` — the capsule's contract (`manifest`), its registration and its `selfTest()`.
- `plugins/<capsule>/lib/` — the implementation. `plugins/<capsule>/test/` — its tests.
- `runtime/registry.js` — the capability registry, imported as `#runtime`.
- `src/cli.js` — command-line shell. `test/` — tests of the shell. `examples/` — sample specs and netlists.

Rules:

- Code inside a capsule never imports files outside its own folder. To call another capsule it uses the registry: `lazy('<capability>', '<name>')` in library code, `await load('<capability>')` in tests. The capability must be listed in the capsule's `dependsOn`.
- `manifest.inputSchema` lists every name the capsule exports. Adding or removing an export means updating it.
- Run the tests with `npm test`.

## Capsules

### circuit-solver

- capability: `circuit.simulate`
- Complex arithmetic, linear solvers, the MNA circuit solver (DC and AC), gain/CMRR/bandwidth measurements and Monte Carlo runs.
- depends on: nothing
- exports: `abs`, `add`, `arg`, `bandwidthHz`, `complex`, `DEFAULT_AC_FREQUENCIES`, `div`, `fmt`, `isZero`, `measureCmrr`, `measureDifferentialGain`, `mul`, `mulberry32`, `neg`, `NetlistError`, `opAmpGain`, `PIVOT_EPS`, `runMonteCarlo`, `scale`, `SingularMatrixError`, `solveAc`, `solveComplex`, `solveDc`, `solveReal`, `sub`, `validateNetlist`, `ZERO_EPS`

### resistor-series

- capability: `resistor.series`
- Standard resistor value series: nearest commercial value, values in a range, ohm formatting.
- depends on: nothing
- exports: `E96`, `e96Values`, `formatOhm`, `nearestE96`

### ia-synth

- capability: `circuit.ia.synthesize`
- Synthesis of instrumentation amplifiers: topology and resistor selection, netlist construction, evaluation of a proposal by simulation.
- depends on: `circuit.simulate`, `resistor.series`
- exports: `buildIaNetlist`, `designIa`, `evaluateProposal`

### spec-parser

- capability: `circuit.spec.parse`
- Parsing of a requirement (structured spec or free text) into a normalized circuit spec, with defaults and open questions.
- depends on: nothing
- exports: `defaultSpec`, `parseRequirement`

### design-verify

- capability: `circuit.design.verify`
- Verification of a design: checks the measured metrics against the spec and reports pass/fail per check.
- depends on: nothing
- exports: `verifyDesign`

### report-render

- capability: `circuit.report.render`
- Rendering of the design report: Markdown, schematic SVG, Bode plot SVG and number formatting.
- depends on: nothing
- exports: `escapeXml`, `fmtHz`, `fmtNum`, `fmtOhm`, `pickOutNode`, `renderBodeSvg`, `renderMarkdown`, `renderSchematicSvg`

### contract-schemas

- capability: `contract.validate`
- JSON schemas of the data that crosses module boundaries (spec, netlist, proposal, verification) and their validator.
- depends on: nothing
- exports: `assertValid`, `CIRCUIT_SPEC_SCHEMA`, `DESIGN_PROPOSAL_SCHEMA`, `formatErrors`, `MANIFEST_SCHEMA`, `NETLIST_SCHEMA`, `OMIT`, `SIM_RESULT_SCHEMA`, `validate`, `VERIFICATION_SCHEMA`

### design-pipeline

- capability: `circuit.design.pipeline`
- End-to-end design pipeline: requirement, synthesis, simulation, verification, report.
- depends on: `circuit.spec.parse`, `circuit.ia.synthesize`, `circuit.design.verify`, `circuit.report.render`
- exports: `designPipeline`

### support-studio

- capability: `support.ticket.triage`
- Customer-support core: ticket classification, knowledge-wiki search, reply drafting and wiki article generation.
- depends on: nothing
- exports: `buildWikiIndex`, `CATEGORIES`, `classifyTicket`, `draftReply`, `generateWikiArticle`, `KNOWLEDGE_BASE`, `searchWiki`, `SENTIMENTS`, `URGENCIES`
