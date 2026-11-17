# contract-gatekeeper

A deterministic pre-PR and CI check for repositories where many coding agents work in parallel.

It looks at a change set (`git diff` between a base branch and `HEAD`) and answers one question in milliseconds: **did this change stay inside one module and keep its contract, or did it cross a boundary?**

- Stayed inside one capsule, contract unchanged, self-test passes → `FAST_TRACK`. No global E2E run, and the reviewer does not need to read the implementation.
- Touched shared code, several capsules, or the contract itself → `ESCALATE_TO_E2E`, with the exact list of user flows a browser check should walk.
- Broke isolation, failed its self-test, or collided with another agent → `REJECTED`.

The rules are plain file-path and manifest comparisons. There is no model in the loop and nothing to negotiate with.

Zero runtime dependencies. Works with any TypeScript/JavaScript repository (Next.js, NestJS, plugin runtimes such as Cordis); it only needs to know where your modules live.

## Quick start

```bash
git clone https://github.com/matiasmolinas/contract-gatekeeper
cd contract-gatekeeper
npm install
npm test

# A change contained in one capsule
npx tsx src/cli.ts check --files examples/plugins/support-studio/index.ts

# A change to shared code
npx tsx src/cli.ts check --files src/shared/styles.css
```

## How a repository adopts it

1. Run `contract-gatekeeper init` to create `gatekeeper.config.json` at the repository root, then adjust it:

```json
{
  "pluginsDir": "src/modules",
  "entryFileName": "index.ts",
  "allowedExternalPackages": ["@nestjs/common", "zod"],
  "keyFlows": {
    "checkout": {
      "capabilities": ["billing.invoice.create", "cart.total.compute"],
      "entryUrl": "/checkout",
      "done": "Order confirmation screen is visible"
    },
    "support-triage": ["support.ticket.triage"]
  }
}
```

A key flow is either a list of capabilities or an object that also says where the flow starts (`entryUrl`) and what done looks like (`done`). Both are optional and both are plain text: the gatekeeper does not interpret them, it hands them to whatever runs the browser check, so the config is not tied to one tool.

2. Make every folder under `pluginsDir` a capsule whose entry file exports a manifest and a self-test:

```ts
import type { GatekeeperPluginModule } from 'contract-gatekeeper/types';

export const plugin: GatekeeperPluginModule = {
  manifest: {
    id: 'plugin-support-studio',
    capability: 'support.ticket.triage',
    version: '1.0.0',
    mode: 'deterministic-js',
    dependsOn: [],
    permissions: ['http:route:/support-studio/*'],
    inputSchema: { text: 'string', channel: 'string' },
    outputSchema: { category: 'string', urgency: 'string' },
    budget: { maxLatencyMs: 50, maxTokensPerCall: 0 }
  },
  async selfTest() {
    // Fast, isolated assertions against this capsule only
    return { passed: true, assertionsRun: 3, durationMs: 1, details: [] };
  }
};
```

The export can be `default`, a named `plugin`, or top-level `manifest` and `selfTest` exports.

3. Run `contract-gatekeeper check` before opening a PR and in CI.

Until the package is on npm, install it from GitHub: `npm i -D github:matiasmolinas/contract-gatekeeper`.

## What it checks

| Phase | Check | Result when it trips |
| --- | --- | --- |
| 1 | Collect changed files (`--base`/`--head`, or `--files`) | `NO_FILES_CHANGED` |
| 2 | Any file outside `<pluginsDir>/<capsule>/` | `SHARED_BOUNDARY_TOUCHED` → escalate |
| 2 | Files in more than one capsule | `MULTIPLE_CAPSULES_TOUCHED` → escalate |
| 3 | Capsule locked by a different agent (`--agent`) | `CAPABILITY_LOCKED_BY_ANOTHER_AGENT` → reject |
| 4 | Import that leaves the capsule, or a package not in `allowedExternalPackages` | `ILLEGAL_CROSS_CAPSULE_IMPORT` → reject |
| 5 | `capability`, `inputSchema`, `outputSchema` or `dependsOn` changed; capsule added or removed; base manifest cannot be loaded | `CONTRACT_SCHEMA_MUTATED` → escalate |
| 5 | New entry in `permissions` | `PERMISSIONS_ESCALATED` → escalate |
| 5 | `budget` raised | `BUDGET_REGRESSED` → escalate |
| 6 | `selfTest()` fails, throws, exceeds `budget.maxLatencyMs`, or the capsule has no loadable plugin | `SELFTEST_FAILED` → reject |
| – | Optional: more net test lines than `testBudget` allows, without a justification | `TEST_BUDGET_EXCEEDED` → review load at least `MEDIUM`, verdict unchanged |

When shared code is touched, every capsule is re-verified. Affected capabilities are propagated through `dependsOn`, then matched against `keyFlows` to produce `affectedKeyFlows`.

`STRICT_CAPSULE_INTERNAL_CHANGE` is reported only when the change stayed inside one capsule and neither the contract nor the import boundary was crossed.

Type-only imports (`import type { A } from …`) are ignored by the import scan, since they are always erased at compile time. The inline form `import { type A } from …` is not: under `verbatimModuleSyntax` or Node's native type stripping it survives as `import {} from …` and loads the module, so it is checked like any other import.

For phase 5, the capsule as it was at the base ref is written to a temporary sibling folder (`<pluginsDir>/.gatekeeper-base-*`), imported, and removed. Add `.gatekeeper-base-*` to `.gitignore`.

## Test selection

Every verdict carries `selectedTests`: the test files worth running for the change, each with the reason it was picked.

| Reason | When |
| --- | --- |
| `changed-test` | The test file itself changed. |
| `owner` | A test with the same base name as a changed file (`lib/e96.js` → `e96.test.js`) in the same folder, in a `test`/`tests`/`__tests__` folder beside it, or at the capsule root; or a test that `extraInputs` names as the owner of a non-code file. |
| `import-consumer` | A test in the capsule that imports the changed file, directly or through other files of the capsule. A package subpath import such as `#runtime` counts as an import of the capsule's entry file, since a registry can load it without a visible import. |
| `fallback-all` | Every test of the capsule, because something could not be determined. |

The fallback rule is simple: **what is unknown widens the selection, it never narrows it.** All of the capsule's tests are selected when a changed file is not code (JSON, fixtures, styles) and no `extraInputs` rule names its tests, when any file in the capsule has a dynamic `import()` or `require()` whose target is not a literal, when a file cannot be read, or when a changed source file is not reached by any test. A change outside every capsule selects every test in the repository. `selectionNotes` says why a fallback happened.

Two optional config fields tune it; configs without them behave as before:

```json
{
  "testFilePatterns": ["**/*.test.ts", "**/*.spec.ts"],
  "extraInputs": {
    "support-studio": { "fixtures/**": ["test/support.test.ts"] }
  }
}
```

`testFilePatterns` are globs relative to the repository root (the default is shown). `extraInputs` maps, per capsule, a glob of non-code files to the tests that read them, both relative to the capsule folder.

## CLI

```text
contract-gatekeeper init
contract-gatekeeper check [--base <ref>] [--head <ref>] [--working-tree] [--files a,b] [--agent <id>] [--json]
contract-gatekeeper shadow --verdict <verdict.json> --suite-exit <code> [--failed-tests a,b | --failed-tests-file <file>] --out <shadow.jsonl>
contract-gatekeeper shadow-summary <shadow.jsonl> [--json]
contract-gatekeeper replay <cases.json> [--json]
contract-gatekeeper lock <capsule> <agentId>
contract-gatekeeper unlock <capsule> <agentId>
contract-gatekeeper check-contention <capsule> [agentId]
```

`--working-tree` adds uncommitted changes to the diff, for checking before a commit exists. `check` exits with `1` on `REJECTED` and `0` otherwise. `--json` prints the full verdict:

```json
{
  "verdict": "ESCALATE_TO_E2E",
  "reasons": ["PERMISSIONS_ESCALATED"],
  "humanReviewLoad": "HIGH",
  "touchedCapsules": ["support-studio"],
  "outOfCapsuleFiles": [],
  "contractMutated": true,
  "affectedKeyFlows": ["customer-support-triage-dock", "full-workspace-composer"],
  "affectedKeyFlowDetails": [
    {
      "name": "customer-support-triage-dock",
      "capabilities": ["support.ticket.triage"],
      "entryUrl": "/support-studio",
      "done": "The triage card shows a category, an urgency and a drafted reply"
    },
    { "name": "full-workspace-composer", "capabilities": ["electronics.amplifier.solve", "support.ticket.triage"] }
  ],
  "importViolations": [],
  "selectedTests": [],
  "selectionNotes": [],
  "testBudget": null,
  "warnings": []
}
```

## CI

`.github/workflows/gatekeeper.yml` runs the check on every pull request and exposes `verdict` and `key_flows` as job outputs. A second job runs only when the verdict is `ESCALATE_TO_E2E`; that is where a real-browser runner or Playwright suite plugs in, scoped to the affected flows. It also receives `key_flow_details`: each affected flow with its `entryUrl` and `done` when the config declares them. The gate job also exposes `selected_tests`, the JSON list of selected tests, for a runner that wants to run only those.

## Test budget

Agents tend to add tests faster than anyone reads them. An optional budget makes large test growth visible to the reviewer:

```json
{ "testBudget": { "maxNetTestLinesPerChange": 120 } }
```

When a change adds more net test lines than that (lines added minus lines removed, in files matching `testFilePatterns`, not counting blank or comment-only lines), the verdict gets the reason `TEST_BUDGET_EXCEEDED`, a warning, and a `humanReviewLoad` of at least `MEDIUM`. It does not turn `FAST_TRACK` into `ESCALATE_TO_E2E` or `REJECTED` by itself. A line `gatekeeper-test-budget: <reason>` in any commit message of the range justifies the growth; the reason is reported in `testBudget.justification`. With `--files` or `--working-tree`, uncommitted and untracked test files count too. If the diff cannot be measured, a warning says so and the review load is raised anyway. Without `testBudget` in the config, nothing changes and `testBudget` is `null` in the verdict.

## Shadow mode

Before trusting a narrowing verdict, measure it. Shadow mode runs the full suite anyway and records whether the verdict, or the test selection, would have missed a failure:

```bash
contract-gatekeeper check --base main --json > verdict.json
npm test; SUITE_EXIT=$?
contract-gatekeeper shadow --verdict verdict.json --suite-exit $SUITE_EXIT \
  [--failed-tests a.test.ts,b.test.ts | --failed-tests-file failed.txt] --out shadow.jsonl
contract-gatekeeper shadow-summary shadow.jsonl [--json]
```

`shadow` appends one JSON line (abridged here; it also carries `recordedAt`, `baseRef` and `headRef`):

```json
{
  "verdict": "FAST_TRACK",
  "reasons": ["STRICT_CAPSULE_INTERNAL_CHANGE"],
  "touchedCapsules": ["support-studio"],
  "selectedTests": ["plugins/support-studio/test/support.test.ts"],
  "selectionWidened": false,
  "fullSuiteExitCode": 1,
  "fullSuiteFailed": true,
  "failedTests": ["plugins/report-render/test/report.test.ts"],
  "failedOutsideSelection": ["plugins/report-render/test/report.test.ts"],
  "verdictMiss": true,
  "selectionMiss": true,
  "miss": true
}
```

A **miss** is a red full suite where the verdict was `FAST_TRACK` (`verdictMiss`), or where a failing test was outside `selectedTests` (`selectionMiss`). Without a list of failed tests, `selectionMiss` is `null`: unknown, never counted as safe. `shadow-summary` reports the runs, `FAST_TRACK`s, misses, the miss rate among `FAST_TRACK`s, and the share of runs that could have been narrowed (a `FAST_TRACK` or a selection without `fallback-all`, with no miss and nothing unknown). It exits with `1` if the file has unreadable lines.

In CI it is opt-in: set the repository variable `GATEKEEPER_SHADOW` to `1`. The `shadow` job then runs the full suite on every `FAST_TRACK` (the command is `npm test`, or the repository variable `GATEKEEPER_SHADOW_SUITE`) and uploads `gatekeeper-shadow.jsonl` as an artifact. The job is `continue-on-error` and nothing depends on it, so it never changes the required verdict or blocks a PR. Download the artifacts and concatenate them to summarize many PRs.

## Replay against past changes

`replay` checks the gatekeeper against changes whose outcome you already know, typically past regressions:

```json
{
  "cases": [
    { "name": "Shared schema change", "base": "a1b2c3d", "head": "e4f5a6b", "mustEscalate": true },
    { "name": "Fix inside billing", "base": "main~12", "head": "main~11", "mustSelect": ["src/modules/billing/test/invoice.test.ts"] }
  ]
}
```

```bash
contract-gatekeeper replay cases.json [--json]
```

For each case it computes the verdict and the test selection between `base` and `head`, and fails if a case that must escalate gets `FAST_TRACK` or a required test is not selected. A ref that does not resolve, or a case that cannot be evaluated, also fails. Nothing is checked out: the tree at `head` is written to a temporary `.gatekeeper-replay-*` folder with `git archive` and evaluated there (add that pattern to `.gitignore`), while the diff and the base manifests are read from the repository with git. The `gatekeeper.config.json` of `head` is used when it exists. Like `check`, it runs the `selfTest()` of the capsules at `head`. It exits with `1` if any case fails.

`npm run test:replay` (run in CI) builds a throwaway repository from the benchmark's plugin tree, puts each benchmark story's reference solution on its own branch, and replays `test/replay/story-cases.json`: the four stories that cross a capsule boundary or change a contract must escalate, and every story must select its capsule's tests.

## Limits to know about

- `check` imports each affected capsule and runs its `selfTest()`. Run it only on code you would be willing to execute, as with any test runner.
- The contract diff loads the working tree as `HEAD`. Check out the branch you are verifying (`replay` is the exception: it materializes `head` itself).
- TypeScript entry files are loaded as-is: run through `tsx`, or use Node 22.18+ with erasable-only TypeScript syntax.
- Locks live in a local `.gatekeeper-locks.json`. Agents in separate clones or worktrees do not share them, and `check` only enforces locks when `--agent` is passed.
- Test selection follows imports inside the touched capsule. Tests of other capsules that reach it through the registry are not selected for a `FAST_TRACK`: that is the bet the contract makes, and shadow mode is how to check it.
- A shared-file change re-verifies every capsule. Narrowing that to the capsules that actually import the file is not implemented yet.
- The import scan is pattern-based, not a full parser. It reads string and template-literal specifiers (for `` import(`../x/${name}.js`) `` it judges the static directory prefix), but it cannot see `import(someVariable)`.

## Benchmark

`benchmark/` holds an A/B experiment that runs the same user stories with real coding agents on a layered codebase and on its capsule version. See [benchmark/README.md](benchmark/README.md) for the method and `benchmark/results/` for the data.

Besides tokens and cost, the analysis reports each story's **cycle time**: wall time from the moment an agent picks the story up to the moment it is merged, lock waits and retries included, with the median and p90 per arm next to the median and p90 cost per story. CI cost only matters if it does not slow agents down, so the two are read together. `npx tsx benchmark/analyze.ts <results folder>…` computes them from existing result files; no model is called.

## Acknowledgements

Special thanks to Ismael Faro. This tool grew out of a prototype built directly on his architectural recommendations and proposals: treating the development lifecycle itself as a program, and isolating capabilities behind strict, self-verifying contracts.

The idea was also inspired in part by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its "everything is a plugin" architecture, where that prototype was built and tested. Contract Gatekeeper itself has no dependency on it and runs in any TypeScript/JavaScript repository.

Shadow mode, the replay of past changes, test selection within a capsule and the test-growth budget follow ideas from Vincent Koc's write-up of how OpenClaw cut its CI compute, [Making CI faster and 95% cheaper](https://vincent.build/openclaw-ci-cost-reduction/): select from the change, let anything unknown widen the run, and check a narrowing rule in shadow before trusting it.

## License

Apache License 2.0. See [LICENSE](LICENSE).
