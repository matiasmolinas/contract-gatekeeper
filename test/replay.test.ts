// test/replay.test.ts
// Replay de las historias del benchmark contra el gatekeeper. Arma un repositorio
// git desechable con el árbol de plugins en `main` y la solución de referencia de
// cada historia en `story/<id>`, y corre `contract-gatekeeper replay` con los
// casos de test/replay/story-cases.json. Sin modelo ni red: solo git y node.
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { STORIES, pluginPath, type StoryDef } from '../benchmark/stories.js';

const ROOT = process.cwd();
const WORK = path.join(ROOT, 'test', `.fixtures-replay-${process.pid}`);
const REPO = path.join(WORK, 'repo');
const CASES = path.join(ROOT, 'test/replay/story-cases.json');
const TSX = path.join(ROOT, 'node_modules/.bin/tsx');
const CLI = path.join(ROOT, 'src/cli.ts');

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=replay', '-c', 'user.email=replay@example.invalid', ...args], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8'
  });

/** La misma solución de referencia que valida benchmark/test/stories.test.ts, en el árbol de plugins. */
function applyReference(story: StoryDef) {
  for (const { file, edits } of story.reference) {
    const target = path.join(REPO, pluginPath(file));
    let source = fs.readFileSync(target, 'utf-8');
    for (const [from, to] of edits) {
      assert.strictEqual(source.split(from).length - 1, 1, `${story.id}: edit does not apply exactly once in ${file}`);
      source = source.replace(from, () => to);
    }
    fs.writeFileSync(target, source, 'utf-8');
  }
  if (story.newExports) {
    const index = path.join(REPO, pluginPath(story.reference[0].file).split('/').slice(0, 2).join('/'), 'index.js');
    const additions = Object.entries(story.newExports).map(([name, kind]) => `    "${name}": "${kind}",\n`).join('');
    const source = fs.readFileSync(index, 'utf-8');
    fs.writeFileSync(index, source.replace('  "inputSchema": {\n', `  "inputSchema": {\n${additions}`), 'utf-8');
  }
}

function replay(casesFile: string): { status: number; outcomes: { name: string; ok: boolean; verdict: string; failures: string[]; selectedTests: { file: string; reason: string }[] }[] } {
  const run = spawnSync(TSX, [CLI, 'replay', casesFile, '--json'], { cwd: REPO, encoding: 'utf-8' });
  assert.ok(run.status === 0 || run.status === 1, `replay exited with ${run.status}:\n${run.stderr}`);
  return { status: run.status!, outcomes: JSON.parse(run.stdout) };
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'benchmark/repos/plugins'), REPO, {
    recursive: true,
    filter: source => path.basename(source) !== 'node_modules'
  });
  // Los tests del árbol son .js: la selección necesita saberlo
  const configFile = path.join(REPO, 'gatekeeper.config.json');
  const repoConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  fs.writeFileSync(configFile, JSON.stringify({ ...repoConfig, testFilePatterns: ['**/*.test.js'] }, null, 2) + '\n');

  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  for (const story of STORIES) {
    git('checkout', '-q', '-b', `story/${story.id}`, 'main');
    applyReference(story);
    git('add', '-A');
    git('commit', '-q', '-m', `${story.id}: ${story.title}`);
    git('checkout', '-q', 'main');
  }
  const statusBefore = git('status', '--porcelain');

  const { status, outcomes } = replay(CASES);
  for (const o of outcomes) {
    const tests = o.selectedTests.map(t => `${path.basename(t.file)}:${t.reason}`).join(', ');
    console.log(`${o.ok ? '✅' : '❌'} ${o.name} -> ${o.verdict} [${tests}]${o.failures.length ? `\n   ${o.failures.join('\n   ')}` : ''}`);
  }
  assert.strictEqual(status, 0, 'every story replay case must pass');
  assert.strictEqual(outcomes.length, 12);

  // El replay es de solo lectura: ni el working tree ni la rama cambian, y no quedan temporales
  assert.strictEqual(git('status', '--porcelain'), statusBefore);
  assert.strictEqual(git('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  assert.deepStrictEqual(fs.readdirSync(REPO).filter(name => name.startsWith('.gatekeeper-')), []);

  // Un caso mal declarado o un ref que no existe hace fallar el replay
  const bad = path.join(WORK, 'bad-cases.json');
  fs.writeFileSync(
    bad,
    JSON.stringify([
      { name: 'internal story declared as escalating', base: 'main', head: 'story/S01', mustEscalate: true },
      { name: 'test of another capsule', base: 'main', head: 'story/S07', mustSelect: ['plugins/report-render/test/report.test.js'] },
      { name: 'missing ref', base: 'main', head: 'story/none', mustEscalate: true }
    ])
  );
  const negative = replay(bad);
  assert.strictEqual(negative.status, 1);
  const expected = [/^must escalate, but the verdict is FAST_TRACK/, /^required test not selected: plugins\/report-render/, /^ref 'story\/none' does not resolve/];
  assert.strictEqual(negative.outcomes.length, expected.length);
  negative.outcomes.forEach((o, i) => {
    assert.strictEqual(o.ok, false, o.name);
    assert.match(o.failures.join('\n'), expected[i], o.name);
  });
  console.log('✅ Replay: 12 story cases pass; wrong expectations and missing refs fail the replay');
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(WORK, { recursive: true, force: true }));
