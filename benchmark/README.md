# A/B swarm benchmark

Does a capsule architecture gated by `contract-gatekeeper` make it cheaper for several coding agents to change the same codebase in parallel? This benchmark runs the same twelve user stories, with the same model and the same prompt, on two versions of one real codebase, and records what happens.

This file was written before the first full run. Results live in `results/`, one folder per run, and are reported as they came out.

## What is compared

The table shows the two original arms; the third is described in the next section.

| | `classic` | `plugins` |
| --- | --- | --- |
| Code | `repos/classic/` | `repos/plugins/` |
| Layout | Layered library under `src/`, one `test/` folder | Nine capsules under `plugins/`, each with a manifest, a `selfTest()` and its own tests |
| How modules call each other | Relative imports | A capability registry (`#runtime`) |
| Gate before merge | Full test suite | `contract-gatekeeper check --base main` |
| Gate after merge, when `main` moved | Full test suite again | Nothing for `FAST_TRACK`; full suite for `ESCALATE_TO_E2E` |
| Same-module contention | None: agents collide at merge time | The planner takes the capsule lock, so stories on one capsule run one after another |

`repos/classic/` is the circuit-design pilot this project grew out of (an MNA circuit solver, instrumentation-amplifier synthesis, verification, reporting, and a customer-support module), about 7,000 lines with 142 tests. It was not written for this benchmark and it is already modular, so it is a strong baseline rather than a strawman.

`repos/plugins/` is **generated** from `repos/classic/` by `repos/build-plugins-tree.mjs`: the same code and the same tests, regrouped into capsules along the real import graph. The script adds only what the architecture requires (manifests, self-tests, the registry). Read the script to see exactly how the two arms differ; `--check` verifies the committed tree matches it.

## Third arm: `coupled` (added after the first run)

The first full run compared `classic` and `plugins` only (`results/2026-11-14T21-30-15/`). The two came out close on tokens, and the likeliest reason is that `classic` is already modular: one module per concern, no shared state, tests per module. That run stays published as it is.

To separate what modularity buys from what contracts add on top, a third arm was added afterwards, and this section was written before running it:

- `repos/coupled/` is **generated** from `repos/classic/` by `repos/build-coupled-tree.mjs`: the same code in one source file (`src/app.js`, about 4,300 lines) and the same tests in one test file. Module-local helpers whose names collide are renamed with a suffix; nothing else changes. It uses the same gate as `classic` (full suite before and after merge).
- It is a mild form of coupling: big files and a single place every story writes to. It has no shared mutable state and no hidden side effects between modules, which is what hurts most in a real monolith and cannot be produced mechanically without inventing code.

Expectations, stated in advance:

1. `coupled` uses more tokens and more turns than `classic`, because an agent has to page through a large file to find and re-read code.
2. `coupled` has more real merge conflicts than `classic`, because every story edits the same two files.
3. `classic` and `plugins` stay close to each other on tokens, as in the first run.
4. All three arms deliver correct results (hidden acceptance tests) at about the same rate.

If these do not hold, the results are reported as they came out.

## What an agent does

Each story is implemented by an agent in its own `git worktree`, branched from the current `main`. The agent has a small tool loop: list files, read a file, write a file, replace text, run the checks, finish. It decides what to read, so the context it consumes is the context it asked for. Both arms get the same system prompt and each tree has an `ARCHITECTURE.md` generated from the same module descriptions.

Up to four agents run at once. When an agent finishes, its branch goes through the arm's gate and then a serialized `git merge` into `main`. A merge conflict, a failed gate or a failed post-merge check sends the story back for another attempt on the updated `main`, up to three attempts. The tokens of every attempt count.

## How a story is judged

Each story has a hidden acceptance test the agent never sees. It runs when the story merges and again on the final `main`, after all twelve have landed. `test/stories.test.ts` proves that every acceptance test fails on the base tree and passes with a reference solution, in both arms.

The stories, their prompts and their tests are in `stories.ts` and were fixed before any agent ran: five on the support module (so same-module contention is real), two on the resistor series, and one each on reporting, verification, spec parsing, the pipeline and the command-line shell. Two add exports, one changes a shared schema, one touches code outside every capsule.

## What is measured

Everything comes from something that happened:

- **Tokens and cost**: the `usage` object the API returns on every call, summed. Cached prompt tokens are reported separately. A call without `usage` is counted as missing, never estimated.
- **Merge conflicts**: the exit code of `git merge`.
- **Correctness**: hidden acceptance tests and the full suite on the final `main`.
- **Verification work**: wall-clock time of the gate commands and the number of full-suite runs.
- **Contention**: time stories spent waiting for a capsule lock.

## What is not measured

- **End-to-end browser tests.** Neither tree has any. For `ESCALATE_TO_E2E` the full test suite stands in as the escalated check, and the benchmark reports how often it ran, not how long a browser suite would take.
- **Human review time.** The gatekeeper's `humanReviewLoad` is recorded, but no human reviewed anything.
- **Large codebases.** 7,000 lines fit comfortably in a model's context. Effects that depend on a repository being too big to read are out of reach here.

## Threats to validity

- The author of the tool built the capsule tree and wrote the stories. The tree is generated by a script and the stories are published with their tests so both can be challenged.
- One model, one agent loop, one codebase. Results may not transfer.
- Model output varies between runs even at temperature 0. Each configuration runs several times and the summary gives the median and the range.
- Wall-clock times include API latency, which varies with load. Arms alternate order between runs.
- The two arms do different amounts of verification by design. Fewer suite runs is only a win if correctness holds, which is why acceptance results are reported next to it.

## Reproducing

```bash
npm install
npm run test:benchmark                       # harness, with a scripted model
npx tsx benchmark/test/stories.test.ts       # every story: fails on base, passes with reference
node benchmark/repos/build-plugins-tree.mjs --check
node benchmark/repos/build-coupled-tree.mjs --check

export OPENROUTER_API_KEY=...                # or DEEPSEEK_API_KEY
npx tsx benchmark/run.ts --runs 3                                  # classic vs plugins
npx tsx benchmark/run.ts --runs 3 --arms coupled,classic,plugins   # three arms
```

By default the run uses `deepseek/deepseek-v4-flash-0731` through OpenRouter, a dated snapshot, so a re-run addresses the same model. `BENCH_MODEL` overrides it. The model the API reports is stored with every call.
