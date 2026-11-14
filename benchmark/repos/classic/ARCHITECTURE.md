# Architecture

The application is a layered library under `src/`, plus a command-line shell.

- `src/core/` — circuit domain: solver, synthesis, spec parsing, verification, reporting, pipeline.
- `src/contract/` — JSON schemas of the data that crosses module boundaries, and their validator.
- `src/support/` — customer-support domain.
- `src/cli.js` — command-line shell. `test/` — all the tests. `examples/` — sample specs and netlists.

Modules import each other directly with relative imports. Run the tests with `npm test`.

## Modules

- `src/core/complex.js`, `src/core/linalg.js`, `src/core/mna.js`, `src/core/measure.js`, `src/core/montecarlo.js` — Complex arithmetic, linear solvers, the MNA circuit solver (DC and AC), gain/CMRR/bandwidth measurements and Monte Carlo runs.
- `src/core/e96.js` — Standard resistor value series: nearest commercial value, values in a range, ohm formatting.
- `src/core/ia.js` — Synthesis of instrumentation amplifiers: topology and resistor selection, netlist construction, evaluation of a proposal by simulation.
- `src/core/spec.js` — Parsing of a requirement (structured spec or free text) into a normalized circuit spec, with defaults and open questions.
- `src/core/verify.js` — Verification of a design: checks the measured metrics against the spec and reports pass/fail per check.
- `src/core/report.js` — Rendering of the design report: Markdown, schematic SVG, Bode plot SVG and number formatting.
- `src/contract/schemas.js`, `src/contract/validate.js` — JSON schemas of the data that crosses module boundaries (spec, netlist, proposal, verification) and their validator.
- `src/core/pipeline.js` — End-to-end design pipeline: requirement, synthesis, simulation, verification, report.
- `src/support/support-core.js` — Customer-support core: ticket classification, knowledge-wiki search, reply drafting and wiki article generation.
