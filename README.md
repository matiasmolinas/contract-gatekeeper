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
    "checkout": ["billing.invoice.create", "cart.total.compute"],
    "support-triage": ["support.ticket.triage"]
  }
}
```

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

When shared code is touched, every capsule is re-verified. Affected capabilities are propagated through `dependsOn`, then matched against `keyFlows` to produce `affectedKeyFlows`.

`STRICT_CAPSULE_INTERNAL_CHANGE` is reported only when the change stayed inside one capsule and neither the contract nor the import boundary was crossed.

Type-only imports (`import type { A } from …`) are ignored by the import scan, since they are always erased at compile time. The inline form `import { type A } from …` is not: under `verbatimModuleSyntax` or Node's native type stripping it survives as `import {} from …` and loads the module, so it is checked like any other import.

For phase 5, the capsule as it was at the base ref is written to a temporary sibling folder (`<pluginsDir>/.gatekeeper-base-*`), imported, and removed. Add `.gatekeeper-base-*` to `.gitignore`.

## CLI

```text
contract-gatekeeper init
contract-gatekeeper check [--base <ref>] [--head <ref>] [--files a,b] [--agent <id>] [--json]
contract-gatekeeper lock <capsule> <agentId>
contract-gatekeeper unlock <capsule> <agentId>
contract-gatekeeper check-contention <capsule> [agentId]
```

`check` exits with `1` on `REJECTED` and `0` otherwise. `--json` prints the full verdict:

```json
{
  "verdict": "ESCALATE_TO_E2E",
  "reasons": ["PERMISSIONS_ESCALATED"],
  "humanReviewLoad": "HIGH",
  "touchedCapsules": ["support-studio"],
  "outOfCapsuleFiles": [],
  "contractMutated": true,
  "affectedKeyFlows": ["customer-support-triage-dock", "full-workspace-composer"],
  "importViolations": [],
  "warnings": []
}
```

## CI

`.github/workflows/gatekeeper.yml` runs the check on every pull request and exposes `verdict` and `key_flows` as job outputs. A second job runs only when the verdict is `ESCALATE_TO_E2E`; that is where a real-browser runner or Playwright suite plugs in, scoped to the affected flows.

## Limits to know about

- `check` imports each affected capsule and runs its `selfTest()`. Run it only on code you would be willing to execute, as with any test runner.
- The contract diff loads the working tree as `HEAD`. Check out the branch you are verifying.
- TypeScript entry files are loaded as-is: run through `tsx`, or use Node 22.18+ with erasable-only TypeScript syntax.
- Locks live in a local `.gatekeeper-locks.json`. Agents in separate clones or worktrees do not share them, and `check` only enforces locks when `--agent` is passed.
- A shared-file change re-verifies every capsule. Narrowing that to the capsules that actually import the file is not implemented yet.
- The import scan is pattern-based, not a full parser. It reads string and template-literal specifiers (for `` import(`../x/${name}.js`) `` it judges the static directory prefix), but it cannot see `import(someVariable)`.

## Acknowledgements

Special thanks to Ismael Faro. This tool grew out of a prototype built directly on his architectural recommendations and proposals: treating the development lifecycle itself as a program, and isolating capabilities behind strict, self-verifying contracts.

The idea was also inspired in part by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its "everything is a plugin" architecture, where that prototype was built and tested. Contract Gatekeeper itself has no dependency on it and runs in any TypeScript/JavaScript repository.

## License

Apache License 2.0. See [LICENSE](LICENSE).
