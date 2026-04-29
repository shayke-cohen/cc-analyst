import { spawn } from "node:child_process";
import type { AnalysisEngine, EngineRunOptions } from "./index.js";

export class CodexEngine implements AnalysisEngine {
  readonly name = "codex" as const;

  async run(prompt: string, opts: EngineRunOptions = {}): Promise<string> {
    const args = ["exec", "--json", "--skip-git-repo-check", "--ephemeral"];
    if (opts.model) args.push("--model", opts.model);
    args.push("-");

    const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${prompt}` : prompt;

    return new Promise((resolve, reject) => {
      const child = spawn("codex", args, {
        cwd: opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`codex exec exited ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        resolve(extractFinalMessage(stdout));
      });

      child.stdin.write(fullPrompt);
      child.stdin.end();
    });
  }
}

function extractFinalMessage(jsonl: string): string {
  const parts: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      const item = evt?.msg?.item ?? evt?.item ?? evt;
      if (item?.type === "agent_message" && typeof item.text === "string") parts.push(item.text);
      else if (item?.type === "assistant_message" && typeof item.text === "string") parts.push(item.text);
      else if (item?.role === "assistant" && Array.isArray(item.content)) {
        for (const b of item.content) if (typeof b?.text === "string") parts.push(b.text);
      }
    } catch { /* skip */ }
  }
  return parts.length ? parts[parts.length - 1].trim() : jsonl.trim();
}
