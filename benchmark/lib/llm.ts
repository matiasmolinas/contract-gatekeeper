// benchmark/lib/llm.ts
// Cliente de chat con herramientas (formato OpenAI) y contabilidad de tokens.
// Regla del benchmark: los tokens salen SOLO del campo `usage` que devuelve el
// API. Si una respuesta no trae `usage`, se cuenta como "sin dato"; nunca se estima.

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type RawUsage = Record<string, unknown>;

export interface ChatResult {
  message: ChatMessage;
  usage: RawUsage | null;   // tal cual lo devolvió el API
  model: string | null;     // modelo que el API dice haber usado
  finishReason: string | null;
  latencyMs: number;
}

export interface ChatProvider {
  readonly name: string;
  /** false para proveedores guionados de prueba: sus corridas no son resultados. */
  readonly live: boolean;
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResult>;
}

export interface UsageTotals {
  calls: number;
  callsWithoutUsage: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  /** Costo que reporta el proveedor en `usage.cost` (OpenRouter); 0 si no lo informa. */
  costUsd: number;
}

export function emptyUsage(): UsageTotals {
  return {
    calls: 0,
    callsWithoutUsage: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    costUsd: 0
  };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function addUsage(totals: UsageTotals, usage: RawUsage | null): void {
  totals.calls++;
  if (!usage) {
    totals.callsWithoutUsage++;
    return;
  }
  totals.promptTokens += num(usage.prompt_tokens);
  totals.completionTokens += num(usage.completion_tokens);
  totals.totalTokens += num(usage.total_tokens);
  // DeepSeek directo informa hit/miss; OpenRouter informa `prompt_tokens_details.cached_tokens`
  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  if (typeof usage.prompt_cache_hit_tokens === 'number') {
    totals.cacheHitTokens += num(usage.prompt_cache_hit_tokens);
    totals.cacheMissTokens += num(usage.prompt_cache_miss_tokens);
  } else if (details && typeof details.cached_tokens === 'number') {
    totals.cacheHitTokens += details.cached_tokens;
    totals.cacheMissTokens += num(usage.prompt_tokens) - details.cached_tokens;
  }
  totals.costUsd += num(usage.cost);
}

export function mergeUsage(into: UsageTotals, from: UsageTotals): void {
  for (const key of Object.keys(into) as (keyof UsageTotals)[]) into[key] += from[key];
}

export interface ProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxRetries?: number;
}

/**
 * Proveedor según el entorno. Con OPENROUTER_API_KEY usa OpenRouter y, por
 * defecto, el snapshot fechado `deepseek/deepseek-v4-flash-0731` (fijo, para
 * que la corrida sea repetible); con DEEPSEEK_API_KEY usa el API de DeepSeek.
 * BENCH_MODEL y BENCH_BASE_URL permiten cambiar ambos.
 */
export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): ChatProvider {
  if (env.OPENROUTER_API_KEY) {
    return createChatProvider('openrouter', {
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.BENCH_BASE_URL ?? 'https://openrouter.ai/api/v1',
      model: env.BENCH_MODEL ?? 'deepseek/deepseek-v4-flash-0731'
    });
  }
  if (env.DEEPSEEK_API_KEY) {
    return createChatProvider('deepseek', {
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.BENCH_BASE_URL ?? env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      model: env.BENCH_MODEL ?? env.DEEPSEEK_MODEL ?? 'deepseek-flash'
    });
  }
  throw new Error('Define OPENROUTER_API_KEY o DEEPSEEK_API_KEY para una corrida real.');
}

/** Cliente de chat-completions en formato OpenAI. El modelo usado se toma del campo `model` de cada respuesta. */
export function createChatProvider(vendor: string, options: ProviderOptions): ChatProvider {
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error('Falta la API key.');
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const model = options.model ?? '';
  const temperature = options.temperature ?? Number(process.env.BENCH_TEMPERATURE ?? 0);
  const maxRetries = options.maxRetries ?? 4;

  return {
    name: `${vendor}:${model}`,
    live: true,
    async chat(messages, tools) {
      let lastError = '';
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * 2 ** (attempt - 1)));
        const t0 = performance.now();
        let response: Response;
        try {
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, temperature, messages, tools, tool_choice: 'auto' }),
            signal: AbortSignal.timeout(300_000)
          });
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
          continue;
        }
        if (!response.ok) {
          throw new Error(`${vendor} API ${response.status}: ${(await response.text()).slice(0, 500)}`);
        }
        const data = (await response.json()) as {
          model?: string;
          usage?: RawUsage;
          choices?: { message?: ChatMessage; finish_reason?: string }[];
        };
        const choice = data.choices?.[0];
        return {
          message: {
            role: 'assistant',
            content: choice?.message?.content ?? null,
            ...(choice?.message?.tool_calls?.length ? { tool_calls: choice.message.tool_calls } : {})
          },
          usage: data.usage ?? null,
          model: data.model ?? null,
          finishReason: choice?.finish_reason ?? null,
          latencyMs: Math.round(performance.now() - t0)
        };
      }
      throw new Error(`${vendor} API sin respuesta tras ${maxRetries + 1} intentos: ${lastError}`);
    }
  };
}
