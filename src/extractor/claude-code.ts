import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  ExtractedSession, NormalizedMessage, ProjectRef, TokenUsage, ToolCall, ErrorEntry,
} from "../types.js";
import { CLAUDE_PROJECTS, decodeProjectDir, exists } from "../utils/paths.js";
import { detectGit } from "./git.js";

const MESSAGE_TYPES = new Set(["user", "assistant", "system"]);

interface ClaudeRecord {
  type: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isCompactSummary?: boolean;
  isSidechain?: boolean;
  message?: {
    role?: string;
    model?: string;
    content?: any;
    usage?: any;
  };
  toolUseResult?: any;
}

export function listClaudeProjects(): ProjectRef[] {
  if (!exists(CLAUDE_PROJECTS)) return [];
  const entries = readdirSync(CLAUDE_PROJECTS, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const decoded = decodeProjectDir(e.name);
      const git = exists(decoded) ? detectGit(decoded) : {};
      return {
        encodedDir: e.name,
        decodedPath: decoded,
        name: basename(decoded) || e.name,
        gitRemote: git.remote,
        currentBranch: git.branch,
        source: "claude-code" as const,
      };
    });
}

export function listSessionFiles(project: ProjectRef): string[] {
  const dir = join(CLAUDE_PROJECTS, project.encodedDir);
  if (!exists(dir)) return [];
  const out: string[] = [];
  walk(dir, out);
  return out.filter((p) => p.endsWith(".jsonl"));
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
}

function parseJsonlLines(path: string): ClaudeRecord[] {
  const text = readFileSync(path, "utf8");
  const out: ClaudeRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}

function extractText(content: any): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.length ? parts.join("\n") : undefined;
}

function extractThinking(content: any): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (block?.type === "thinking" && typeof block.thinking === "string") parts.push(block.thinking);
  }
  return parts.length ? parts.join("\n") : undefined;
}

function extractToolCalls(content: any): ToolCall[] {
  if (!Array.isArray(content)) return [];
  const out: ToolCall[] = [];
  for (const block of content) {
    if (block?.type === "tool_use") {
      out.push({ tool: block.name, input: block.input, id: block.id });
    }
  }
  return out;
}

function previewToolResult(tur: any): { tool_use_id: string; isError?: boolean; preview?: string } | null {
  if (!tur) return null;
  let text: string | undefined;
  if (typeof tur.content === "string") text = tur.content;
  else if (Array.isArray(tur.content)) {
    text = tur.content
      .map((b: any) => (typeof b?.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return {
    tool_use_id: tur.tool_use_id || tur.toolUseID || "",
    isError: !!tur.is_error,
    preview: text ? text.slice(0, 500) : undefined,
  };
}

function dedupByUuid(records: ClaudeRecord[]): ClaudeRecord[] {
  const seen = new Set<string>();
  const out: ClaudeRecord[] = [];
  for (const r of records) {
    if (r.uuid) {
      if (seen.has(r.uuid)) continue;
      seen.add(r.uuid);
    }
    out.push(r);
  }
  return out;
}

function isContinuationFile(path: string, records: ClaudeRecord[]): boolean {
  const fileId = basename(path).replace(/\.jsonl$/, "");
  const first = records.find((r) => r.sessionId);
  return !!first && !!first.sessionId && first.sessionId !== fileId;
}

interface SessionGroup {
  fileId: string;
  records: ClaudeRecord[];
  paths: string[];
}

function groupSessions(project: ProjectRef): SessionGroup[] {
  const files = listSessionFiles(project);
  const groups: Record<string, SessionGroup> = {};
  for (const path of files) {
    const fileId = basename(path).replace(/\.jsonl$/, "");
    const records = parseJsonlLines(path);
    if (records.length === 0) continue;
    if (isContinuationFile(path, records)) {
      const parentId = records[0].sessionId!;
      const grp = groups[parentId] ?? (groups[parentId] = { fileId: parentId, records: [], paths: [] });
      grp.records.push(...records);
      grp.paths.push(path);
    } else {
      const grp = groups[fileId] ?? (groups[fileId] = { fileId, records: [], paths: [] });
      grp.records.push(...records);
      grp.paths.push(path);
    }
  }
  return Object.values(groups).map((g) => ({ ...g, records: dedupByUuid(g.records) }));
}

function normalize(group: SessionGroup, project: ProjectRef): ExtractedSession | null {
  const records = group.records
    .filter((r) => !r.isCompactSummary)
    .filter((r) => !r.isSidechain)
    .filter((r) => MESSAGE_TYPES.has(r.type) || r.type === "tool_result");

  if (records.length === 0) return null;

  records.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));

  const first = records[0];
  const last = records[records.length - 1];
  const cwd = first.cwd ?? project.decodedPath;
  const branch = first.gitBranch ?? null;

  const messages: NormalizedMessage[] = [];
  const toolStats: Record<string, number> = {};
  const errors: ErrorEntry[] = [];
  const filesModified = new Set<string>();
  const tokens: TokenUsage = { input_tokens: 0, output_tokens: 0 };
  let model: string | null = null;
  let userTurns = 0;
  let totalTurns = 0;

  records.forEach((r, i) => {
    if (r.type === "user" && r.message) {
      const text = extractText(r.message.content);
      messages.push({ role: "user", timestamp: r.timestamp ?? "", text });
      const tur = (r.message.content || []).find?.((b: any) => b?.type === "tool_result");
      if (tur) {
        const prev = previewToolResult(tur);
        if (prev) messages[messages.length - 1].toolResults = [prev];
        if (tur.is_error) errors.push({ sessionId: group.fileId, turnIndex: i, message: prev?.preview ?? "tool_error" });
      }
      if (text) userTurns++;
      totalTurns++;
    } else if (r.type === "assistant" && r.message) {
      if (r.message.model && !model) model = r.message.model;
      const text = extractText(r.message.content);
      const thinking = extractThinking(r.message.content);
      const calls = extractToolCalls(r.message.content);
      for (const c of calls) {
        toolStats[c.tool] = (toolStats[c.tool] ?? 0) + 1;
        if (c.tool === "Edit" || c.tool === "Write") {
          const fp = (c.input as any)?.file_path;
          if (typeof fp === "string") filesModified.add(fp);
        }
      }
      messages.push({ role: "assistant", timestamp: r.timestamp ?? "", text, thinking, toolCalls: calls.length ? calls : undefined });
      if (r.message.usage) {
        tokens.input_tokens += r.message.usage.input_tokens ?? 0;
        tokens.output_tokens += r.message.usage.output_tokens ?? 0;
        if (r.message.usage.cache_creation_input_tokens) {
          tokens.cache_creation_input_tokens = (tokens.cache_creation_input_tokens ?? 0) + r.message.usage.cache_creation_input_tokens;
        }
        if (r.message.usage.cache_read_input_tokens) {
          tokens.cache_read_input_tokens = (tokens.cache_read_input_tokens ?? 0) + r.message.usage.cache_read_input_tokens;
        }
      }
      totalTurns++;
    }
  });

  return {
    source: "claude-code",
    sessionId: group.fileId,
    project,
    cwd,
    gitBranch: branch,
    model,
    startTime: first.timestamp ?? "",
    endTime: last.timestamp ?? "",
    totalTurns,
    userTurns,
    tokens,
    toolStats,
    errors,
    messages,
    filesModified: Array.from(filesModified),
  };
}

export function extractClaudeProject(project: ProjectRef, daysBack?: number): ExtractedSession[] {
  const cutoff = daysBack ? Date.now() - daysBack * 86_400_000 : 0;
  const groups = groupSessions(project);
  const out: ExtractedSession[] = [];
  for (const g of groups) {
    const session = normalize(g, project);
    if (!session) continue;
    if (cutoff && session.startTime && new Date(session.startTime).getTime() < cutoff) continue;
    out.push(session);
  }
  out.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return out;
}
