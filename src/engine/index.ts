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

export function makeEngine(name: EngineName): AnalysisEngine {
  if (name === "claude-code") return new ClaudeEngine();
  return new CodexEngine();
}

export { ClaudeEngine, CodexEngine };
