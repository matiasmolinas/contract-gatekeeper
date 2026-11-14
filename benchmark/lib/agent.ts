// benchmark/lib/agent.ts
// Bucle de herramientas mínimo. El agente decide qué leer: el contexto que
// consume es el que realmente pidió, no uno que el benchmark le arme.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  addUsage,
  emptyUsage,
  type ChatMessage,
  type ChatProvider,
  type RawUsage,
  type ToolSpec,
  type UsageTotals
} from './llm.js';

export interface ExecResult {
  code: number | null;
  output: string; // stdout + stderr intercalados
  ms: number;
  timedOut: boolean;
}

/** Ejecuta un comando sin shell y sin lanzar excepciones. */
export function exec(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }
): Promise<ExecResult> {
  return new Promise(resolve => {
    const t0 = performance.now();
    let output = '';
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const append = (chunk: Buffer) => {
      if (output.length < 2_000_000) output += chunk.toString('utf-8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 300_000);
    const done = (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, output, ms: Math.round(performance.now() - t0), timedOut });
    };
    child.on('error', err => {
      output += `\n${err.message}`;
      done(null);
    });
    child.on('close', done);
  });
}

export interface AgentCheck {
  description: string;
  command: string[]; // comando fijo: el agente no puede ejecutar shell arbitrario
}

export interface AgentOptions {
  root: string;            // worktree: único directorio que el agente puede tocar
  systemPrompt: string;
  task: string;
  provider: ChatProvider;
  checks: Record<string, AgentCheck>;
  maxTurns?: number;
}

export interface TurnRecord {
  turn: number;
  latencyMs: number;
  model: string | null;
  finishReason: string | null;
  usage: RawUsage | null;
  assistantText: string | null;
  toolCalls: { name: string; args: Record<string, unknown>; ok: boolean; resultChars: number }[];
}

export interface AgentRun {
  stopReason: 'finish' | 'max_turns' | 'no_tool_call' | 'provider_error';
  error?: string;
  summary: string | null;
  turns: TurnRecord[];
  usage: UsageTotals;
  filesRead: string[];
  charsRead: number;
  filesWritten: string[];
  searches: number;
  wallMs: number;
}

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const MAX_TOOL_RESULT = 16_000;
const MAX_READ_LINES = 400;

const BASE_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files under a directory of the repository (recursive).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory relative to the repo root. Default "."' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: `Read a text file. Returns at most ${MAX_READ_LINES} lines per call; use start_line to continue.`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          start_line: { type: 'integer', description: '1-based first line. Default 1' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search the repository for a regular expression. Returns matching lines as path:line: text (at most 60).',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'JavaScript regular expression (case-sensitive).' },
          path: { type: 'string', description: 'File or directory to search in. Default "."' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with the given full content.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: 'Replace one exact occurrence of old_text with new_text. Fails unless old_text occurs exactly once.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } },
        required: ['path', 'old_text', 'new_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Call when the task is complete and the checks pass.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: 'What you changed, in one or two sentences.' } },
        required: ['summary']
      }
    }
  }
];

/** Resuelve una ruta del agente dentro de `root`, o lanza si intenta salir. */
export function resolveInside(root: string, relative: unknown): string {
  if (typeof relative !== 'string' || relative.length === 0) throw new Error('path is required');
  const absRoot = fs.realpathSync(root);
  const target = path.resolve(absRoot, relative);
  if (target !== absRoot && !target.startsWith(absRoot + path.sep)) {
    throw new Error(`path escapes the repository: ${relative}`);
  }
  if (path.relative(absRoot, target).split(path.sep).some(part => SKIP_DIRS.has(part))) {
    throw new Error(`path is not accessible: ${relative}`);
  }
  // Un symlink dentro del repo no puede usarse para salir de él
  let existing = target;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = fs.realpathSync(existing);
  if (real !== absRoot && !real.startsWith(absRoot + path.sep)) {
    throw new Error(`path escapes the repository: ${relative}`);
  }
  return target;
}

function listFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  };
  walk(dir);
  return out;
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === 'string' && value.length > 200 ? `<${value.length} chars>` : value;
  }
  return out;
}

export async function runAgent(options: AgentOptions): Promise<AgentRun> {
  const { root, provider, checks } = options;
  const maxTurns = options.maxTurns ?? 40;
  const t0 = performance.now();

  const tools: ToolSpec[] = [
    ...BASE_TOOLS,
    ...Object.entries(checks).map(([name, check]): ToolSpec => ({
      type: 'function',
      function: { name, description: check.description, parameters: { type: 'object', properties: {} } }
    }))
  ];

  const messages: ChatMessage[] = [
    { role: 'system', content: options.systemPrompt },
    { role: 'user', content: options.task }
  ];

  const run: AgentRun = {
    stopReason: 'max_turns',
    summary: null,
    turns: [],
    usage: emptyUsage(),
    filesRead: [],
    charsRead: 0,
    filesWritten: [],
    searches: 0,
    wallMs: 0
  };
  const filesRead = new Set<string>();
  const filesWritten = new Set<string>();

  const callTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    if (name === 'list_files') {
      const dir = resolveInside(root, typeof args.path === 'string' && args.path ? args.path : '.');
      const files = listFiles(fs.realpathSync(root), dir);
      return files.length > 600 ? `${files.slice(0, 600).join('\n')}\n… (${files.length - 600} more)` : files.join('\n') || '(empty)';
    }
    if (name === 'read_file') {
      const file = resolveInside(root, args.path);
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      const start = Math.max(1, Number(args.start_line) || 1);
      const slice = lines.slice(start - 1, start - 1 + MAX_READ_LINES);
      const text = slice.join('\n');
      filesRead.add(path.relative(fs.realpathSync(root), file).replace(/\\/g, '/'));
      run.charsRead += text.length;
      const end = start - 1 + slice.length;
      return end < lines.length
        ? `${text}\n… (lines ${start}-${end} of ${lines.length}; call again with start_line=${end + 1})`
        : text;
    }
    if (name === 'search') {
      if (typeof args.pattern !== 'string' || !args.pattern) throw new Error('pattern is required');
      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern);
      } catch {
        regex = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      }
      const absRoot = fs.realpathSync(root);
      const target = resolveInside(root, typeof args.path === 'string' && args.path ? args.path : '.');
      const files = fs.statSync(target).isDirectory() ? listFiles(absRoot, target) : [path.relative(absRoot, target).replace(/\\/g, '/')];
      const hits: string[] = [];
      let total = 0;
      for (const file of files) {
        let lines: string[];
        try {
          lines = fs.readFileSync(path.join(absRoot, file), 'utf-8').split('\n');
        } catch {
          continue;
        }
        lines.forEach((line, index) => {
          if (!regex.test(line)) return;
          total++;
          if (hits.length < 60) hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 200)}`);
        });
      }
      run.searches++;
      return total === 0 ? 'no matches' : `${hits.join('\n')}${total > hits.length ? `\n… (${total - hits.length} more matches)` : ''}`;
    }
    if (name === 'write_file') {
      const file = resolveInside(root, args.path);
      if (typeof args.content !== 'string') throw new Error('content is required');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, args.content, 'utf-8');
      filesWritten.add(path.relative(fs.realpathSync(root), file).replace(/\\/g, '/'));
      return `wrote ${args.content.length} chars`;
    }
    if (name === 'replace_in_file') {
      const file = resolveInside(root, args.path);
      if (typeof args.old_text !== 'string' || typeof args.new_text !== 'string' || !args.old_text) {
        throw new Error('old_text and new_text are required');
      }
      const content = fs.readFileSync(file, 'utf-8');
      const count = content.split(args.old_text).length - 1;
      if (count !== 1) throw new Error(`old_text occurs ${count} times; it must occur exactly once`);
      fs.writeFileSync(file, content.replace(args.old_text, () => args.new_text as string), 'utf-8');
      filesWritten.add(path.relative(fs.realpathSync(root), file).replace(/\\/g, '/'));
      return 'replaced';
    }
    const check = checks[name];
    if (check) {
      const result = await exec(check.command[0], check.command.slice(1), { cwd: root, timeoutMs: 180_000 });
      const tail = result.output.length > 6000 ? `…${result.output.slice(-6000)}` : result.output;
      return `exit code: ${result.timedOut ? 'timeout' : result.code}\n${tail}`;
    }
    throw new Error(`unknown tool: ${name}`);
  };

  let nudged = false;
  for (let turn = 1; turn <= maxTurns; turn++) {
    let result;
    try {
      result = await provider.chat(messages, tools);
    } catch (err) {
      run.stopReason = 'provider_error';
      run.error = err instanceof Error ? err.message : String(err);
      break;
    }
    addUsage(run.usage, result.usage);
    messages.push(result.message);

    const record: TurnRecord = {
      turn,
      latencyMs: result.latencyMs,
      model: result.model,
      finishReason: result.finishReason,
      usage: result.usage,
      assistantText: result.message.content ? result.message.content.slice(0, 2000) : null,
      toolCalls: []
    };
    run.turns.push(record);

    const calls = result.message.tool_calls ?? [];
    if (calls.length === 0) {
      if (nudged) {
        run.stopReason = 'no_tool_call';
        break;
      }
      nudged = true;
      messages.push({ role: 'user', content: 'Use the tools to make the change, then call finish.' });
      continue;
    }

    let finished = false;
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      let output: string;
      let ok = true;
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        if (call.function.name === 'finish') {
          run.summary = typeof args.summary === 'string' ? args.summary : '';
          finished = true;
          output = 'ok';
        } else {
          output = await callTool(call.function.name, args);
        }
      } catch (err) {
        ok = false;
        output = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (output.length > MAX_TOOL_RESULT) output = `${output.slice(0, MAX_TOOL_RESULT)}\n… (truncated)`;
      record.toolCalls.push({ name: call.function.name, args: summarizeArgs(args), ok, resultChars: output.length });
      messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
    if (finished) {
      run.stopReason = 'finish';
      break;
    }
  }

  run.filesRead = [...filesRead].sort();
  run.filesWritten = [...filesWritten].sort();
  run.wallMs = Math.round(performance.now() - t0);
  return run;
}
