import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AnalysisEngine, EngineRunOptions } from "./index.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TURNS = 3;

export class ClaudeEngine implements AnalysisEngine {
  readonly name = "claude-code" as const;

  async run(prompt: string, opts: EngineRunOptions = {}): Promise<string> {
    const out: string[] = [];
    let errorMessage: string | null = null;

    const iter = query({
      prompt,
      options: {
        model: opts.model ?? DEFAULT_MODEL,
        allowedTools: opts.allowedTools ?? [],
        permissionMode: "default",
        systemPrompt: opts.systemPrompt ? { type: "preset", preset: "claude_code", append: opts.systemPrompt } : { type: "preset", preset: "claude_code" },
        maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
        cwd: opts.cwd,
      },
    });

    for await (const msg of iter) {
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text" && typeof block.text === "string") {
            out.push(block.text);
          }
        }
      }
      if (msg.type === "result" && (msg as any).is_error) {
        errorMessage = (msg as any).result || (msg as any).error || "engine returned error result";
      }
    }

    const text = out.join("\n").trim();
    if (errorMessage && !text) throw new Error(errorMessage);
    return text;
  }
}
