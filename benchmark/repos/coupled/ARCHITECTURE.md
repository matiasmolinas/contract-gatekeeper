# Architecture

The application is a single source file plus a command-line shell.

- `src/app.js` — all the domain code: circuit solver, synthesis, spec parsing, verification, reporting, pipeline, data schemas and customer support.
- `src/cli.js` — command-line shell.
- `test/app.test.js` — all the tests. `examples/` — sample specs and netlists.

Inside `src/app.js` and `test/app.test.js` the code is laid out in sections, each starting with a `/* ===== name ===== */` comment. Run the tests with `npm test`.

## Sections of src/app.js, in order

- `complex` — Complex arithmetic, linear solvers, the MNA circuit solver (DC and AC), gain/CMRR/bandwidth measurements and Monte Carlo runs.
- `linalg` — (same area as the section above)
- `mna` — (same area as the section above)
- `measure` — (same area as the section above)
- `montecarlo` — (same area as the section above)
- `e96` — Standard resistor value series: nearest commercial value, values in a range, ohm formatting.
- `ia` — Synthesis of instrumentation amplifiers: topology and resistor selection, netlist construction, evaluation of a proposal by simulation.
- `spec` — Parsing of a requirement (structured spec or free text) into a normalized circuit spec, with defaults and open questions.
- `verify` — Verification of a design: checks the measured metrics against the spec and reports pass/fail per check.
- `report` — Rendering of the design report: Markdown, schematic SVG, Bode plot SVG and number formatting.
- `pipeline` — End-to-end design pipeline: requirement, synthesis, simulation, verification, report.
- `schemas` — JSON schemas of the data that crosses module boundaries (spec, netlist, proposal, verification) and their validator.
- `validate` — (same area as the section above)
- `support-core` — Customer-support core: ticket classification, knowledge-wiki search, reply drafting and wiki article generation.
