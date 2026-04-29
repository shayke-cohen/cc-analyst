import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  ExtractedSession, NormalizedMessage, ProjectRef, TokenUsage, ToolCall, ErrorEntry,
} from "../types.js";
import { CODEX_ARCHIVED, CODEX_SESSIONS, exists } from "../utils/paths.js";
import { detectGit } from "./git.js";

interface CodexRecord {
  timestamp?: string;
  type: string;
  payload?: any;
}

function listAllRollouts(): string[] {
  const out: string[] = [];
  for (const root of [CODEX_SESSIONS, CODEX_ARCHIVED]) {
    if (!exists(root)) continue;
    walk(root, out);
  }
  return out.filter((p) => p.endsWith(".jsonl") && basename(p).startsWith("rollout-"));
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
}

function parseLines(path: string): CodexRecord[] {
  const text = readFileSync(path, "utf8");
  const out: CodexRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

function isInjectedContext(text: string): boolean {
  const t = text.trim();
  return t.startsWith("<environment_context>") || t.startsWith("<permissions instructions>") || t.startsWith("<user_instructions>");
}

function extractTextBlocks(content: any): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    const text = block?.text;
    if (typeof text !== "string") continue;
    if (block.type === "input_text" || block.type === "output_text" || block.type === "text") {
      parts.push(text);
    }
  }
  return parts.length ? parts.join("\n") : undefined;
}

interface CodexSessionMeta {
  id: string;
  cwd: string;
  cli_version?: string;
  model_provider?: string;
  originator?: string;
  source?: string;
  timestamp?: string;
  model?: string;
}

function findMeta(records: CodexRecord[]): CodexSessionMeta | null {
  for (const r of records) {
    if (r.type === "session_meta" && r.payload?.id) {
      return {
        id: r.payload.id,
        cwd: r.payload.cwd ?? "",
        cli_version: r.payload.cli_version,
        model_provider: r.payload.model_provider,
        originator: r.payload.originator,
        source: r.payload.source,
        timestamp: r.payload.timestamp ?? r.timestamp,
        model: r.payload.model,
      };
    }
  }
  return null;
}

function normalize(records: CodexRecord[], path: string, projectByPath: Map<string, ProjectRef>): ExtractedSession | null {
  const meta = findMeta(records);
  if (!meta || !meta.cwd) return null;

  const project = ensureProject(meta.cwd, projectByPath);

  const messages: NormalizedMessage[] = [];
  const toolStats: Record<string, number> = {};
  const errors: ErrorEntry[] = [];
  const filesModified = new Set<string>();
  const tokens: TokenUsage = { input_tokens: 0, output_tokens: 0 };
  let model: string | null = meta.model ?? null;
  let userTurns = 0;
  let totalTurns = 0;
  let firstTs = meta.timestamp ?? "";
  let lastTs = "";

  const callIdToTool = new Map<string, string>();

  for (const r of records) {
    if (r.timestamp) lastTs = r.timestamp;
    if (!firstTs && r.timestamp) firstTs = r.timestamp;

    if (r.type === "response_item" && r.payload) {
      const p = r.payload;

      if (p.type === "message") {
        const text = extractTextBlocks(p.content);
        if (!text) continue;
        if (p.role === "user") {
          if (isInjectedContext(text)) continue;
          messages.push({ role: "user", timestamp: r.timestamp ?? "", text });
          userTurns++;
          totalTurns++;
        } else if (p.role === "assistant") {
          messages.push({ role: "assistant", timestamp: r.timestamp ?? "", text });
          totalTurns++;
        } else if (p.role === "developer" || p.role === "system") {
          continue;
        }
      } else if (p.type === "function_call" || p.type === "local_shell_call" || p.type === "tool_use") {
        const tool = p.name ?? p.action?.type ?? p.type;
        toolStats[tool] = (toolStats[tool] ?? 0) + 1;
        if (p.call_id) callIdToTool.set(p.call_id, tool);
        let input: any = undefined;
        try {
          input = typeof p.arguments === "string" ? JSON.parse(p.arguments) : p.arguments;
        } catch {
          input = p.arguments;
        }
        const fp = input?.file_path ?? input?.path;
        if (typeof fp === "string" && (tool === "apply_patch" || tool === "Edit" || tool === "Write" || tool === "edit"))
          filesModified.add(fp);
        const last = messages[messages.length - 1];
        const call: ToolCall = { tool, input, id: p.call_id };
        if (last && last.role === "assistant") {
          (last.toolCalls ??= []).push(call);
        } else {
          messages.push({ role: "assistant", timestamp: r.timestamp ?? "", toolCalls: [call] });
          totalTurns++;
        }
      } else if (p.type === "function_call_output" || p.type === "local_shell_call_output") {
        const out = typeof p.output === "string" ? p.output : JSON.stringify(p.output ?? "");
        const isError = out.startsWith('{"error"') || /^\s*Error:/.test(out);
        if (isError) {
          const tool = p.call_id ? callIdToTool.get(p.call_id) : undefined;
          errors.push({
            sessionId: meta.id,
            turnIndex: messages.length,
            tool,
            message: out.slice(0, 300),
          });
        }
        const last = messages[messages.length - 1];
        const tr = { tool_use_id: p.call_id ?? "", isError, preview: out.slice(0, 500) };
        if (last) {
          (last.toolResults ??= []).push(tr);
        }
      }
    } else if (r.type === "event_msg" && r.payload?.type === "token_count" && r.payload?.usage) {
      tokens.input_tokens += r.payload.usage.input_tokens ?? 0;
      tokens.output_tokens += r.payload.usage.output_tokens ?? 0;
    }
  }

  if (messages.length === 0) return null;

  return {
    source: "codex",
    sessionId: meta.id,
    project,
    cwd: meta.cwd,
    gitBranch: null,
    model,
    startTime: firstTs,
    endTime: lastTs || firstTs,
    totalTurns,
    userTurns,
    tokens,
    toolStats,
    errors,
    messages,
    filesModified: Array.from(filesModified),
  };
}

function ensureProject(cwd: string, cache: Map<string, ProjectRef>): ProjectRef {
  if (cache.has(cwd)) return cache.get(cwd)!;
  const git = existsSync(cwd) ? detectGit(cwd) : {};
  const ref: ProjectRef = {
    encodedDir: cwd.replace(/\//g, "-"),
    decodedPath: cwd,
    name: basename(cwd) || cwd,
    gitRemote: git.remote,
    currentBranch: git.branch,
    source: "codex",
  };
  cache.set(cwd, ref);
  return ref;
}

export function extractAllCodex(daysBack?: number): { projects: ProjectRef[]; sessions: ExtractedSession[] } {
  const cutoff = daysBack ? Date.now() - daysBack * 86_400_000 : 0;
  const cache = new Map<string, ProjectRef>();
  const sessions: ExtractedSession[] = [];
  for (const path of listAllRollouts()) {
    let records: CodexRecord[];
    try { records = parseLines(path); } catch { continue; }
    if (records.length === 0) continue;
    const session = normalize(records, path, cache);
    if (!session) continue;
    if (cutoff && session.startTime && new Date(session.startTime).getTime() < cutoff) continue;
    sessions.push(session);
  }
  sessions.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return { projects: Array.from(cache.values()), sessions };
}

export function listCodexProjects(): ProjectRef[] {
  const { projects } = extractAllCodex();
  return projects;
}
