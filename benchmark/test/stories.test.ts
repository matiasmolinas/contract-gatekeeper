// benchmark/test/stories.test.ts
// Valida las historias antes de gastar un token: en los dos árboles, cada test
// de aceptación (1) falla sobre el árbol base y (2) pasa con la solución de
// referencia, que además deja verde la batería completa y, en plugins, el gatekeeper.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from '../lib/agent.js';
import { STORIES, acceptanceSource, pluginPath, type ArmName, type StoryDef } from '../stories.js';

const ROOT = process.cwd();
const WORK = path.join(ROOT, 'benchmark/.work', `stories-${process.pid}`);
const GATEKEEPER = [path.join(ROOT, 'node_modules/.bin/tsx'), path.join(ROOT, 'src/cli.ts')];
const SUITE: Record<ArmName, string[]> = {
  classic: ['node', '--test', 'test/'],
  plugins: ['node', '--test', 'plugins/*/test/*.test.js', 'test/*.test.js']
};

function applyReference(dir: string, arm: ArmName, story: StoryDef) {
  for (const { file, edits } of story.reference) {
    const target = path.join(dir, arm === 'classic' ? file : pluginPath(file));
    let source = fs.readFileSync(target, 'utf-8');
    for (const [from, to] of edits) {
      const count = source.split(from).length - 1;
      assert.strictEqual(count, 1, `${story.id}: el texto a reemplazar aparece ${count} veces en ${file}: ${from.slice(0, 60)}`);
      source = source.replace(from, () => to);
    }
    fs.writeFileSync(target, source, 'utf-8');
  }
  if (arm === 'plugins' && story.newExports) {
    // En plugins el contrato es explícito: los exports nuevos se declaran en el manifest
    const dir0 = pluginPath(story.reference[0].file).split('/').slice(0, 2).join('/');
    const index = path.join(dir, dir0, 'index.js');
    const additions = Object.entries(story.newExports).map(([name, kind]) => `    "${name}": "${kind}",\n`).join('');
    const source = fs.readFileSync(index, 'utf-8');
    assert.ok(source.includes('  "inputSchema": {\n'));
    fs.writeFileSync(index, source.replace('  "inputSchema": {\n', `  "inputSchema": {\n${additions}`), 'utf-8');
  }
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  for (const arm of ['classic', 'plugins'] as ArmName[]) {
    for (const story of STORIES) {
      const dir = path.join(WORK, arm, story.id);
      fs.cpSync(path.join(ROOT, 'benchmark/repos', arm), dir, { recursive: true });
      const testFile = `test/__acceptance__${story.id}.test.js`;
      const acceptance = () => {
        fs.writeFileSync(path.join(dir, testFile), acceptanceSource(story, arm), 'utf-8');
        return exec('node', ['--test', testFile], { cwd: dir }).finally(() => fs.rmSync(path.join(dir, testFile)));
      };

      const before = await acceptance();
      assert.notStrictEqual(before.code, 0, `${arm}/${story.id}: el test de aceptación ya pasa sobre el árbol base`);

      applyReference(dir, arm, story);
      const after = await acceptance();
      assert.strictEqual(after.code, 0, `${arm}/${story.id}: la referencia no satisface el test:\n${after.output.slice(-1500)}`);

      const suite = await exec(SUITE[arm][0], SUITE[arm].slice(1), { cwd: dir });
      assert.strictEqual(suite.code, 0, `${arm}/${story.id}: la referencia rompe la batería base:\n${suite.output.slice(-1500)}`);

      if (arm === 'plugins') {
        const files = story.reference.map(r => pluginPath(r.file)).join(',');
        const check = await exec(GATEKEEPER[0], [...GATEKEEPER.slice(1), 'check', '--files', files, '--json'], { cwd: dir });
        const verdict = JSON.parse(check.output.slice(check.output.indexOf('{')));
        assert.notStrictEqual(verdict.verdict, 'REJECTED', `${story.id}: ${JSON.stringify(verdict.reasons)} ${JSON.stringify(verdict.selfTestReports)}`);
      }
    }
    console.log(`✅ ${arm}: las ${STORIES.length} historias fallan sobre la base y pasan con la referencia`);
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(WORK, { recursive: true, force: true }));
