import type { EngineName } from "../types.js";
import { ClaudeEngine } from "./claude.js";
import { CodexEngine } from "./codex.js";

export interface EngineRunOptions {
  model?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  maxTurns?: number;
  cwd?: string;
}

export interface AnalysisEngine {
  readonly name: EngineName;
  run(prompt: string, opts?: EngineRunOptions): Promise<string>;
}

const TRANSIENT_PATTERNS = [
  /stream idle timeout/i,
  /partial response/i,
  /econnreset/i,
  /etimedout/i,
  /socket hang up/i,
  /network error/i,
  /503/, /504/, /429/,
];

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

function withRetry(engine: AnalysisEngine): AnalysisEngine {
  return {
    name: engine.name,
    async run(prompt, opts) {
      try {
        return await engine.run(prompt, opts);
      } catch (err) {
        if (!isTransient(err)) throw err;
        const delay = 5000 + Math.floor(Math.random() * 5000);
        console.error(`  ⚠ engine transient error, retrying in ${(delay / 1000).toFixed(1)}s: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, delay));
        return await engine.run(prompt, opts);
      }
    },
  };
}

export function makeEngine(name: EngineName): AnalysisEngine {
  const raw = name === "claude-code" ? new ClaudeEngine() : new CodexEngine();
  return withRetry(raw);
}

export { ClaudeEngine, CodexEngine };
