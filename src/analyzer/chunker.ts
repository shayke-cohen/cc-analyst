import type { ExtractedProject, ExtractedSession } from "../types.js";

export type ChunkStrategy = "full" | "hybrid" | "summary";

export function pickStrategy(count: number): ChunkStrategy {
  if (count <= 8) return "full";
  if (count <= 30) return "hybrid";
  return "summary";
}

const MAX_MSG_TEXT = 2000;

function truncText(s: string | undefined): string | undefined {
  if (!s) return s;
  return s.length > MAX_MSG_TEXT ? s.slice(0, MAX_MSG_TEXT) + "…[truncated]" : s;
}

function truncateToolOutputs(s: ExtractedSession) {
  return {
    sessionId: s.sessionId,
    cwd: s.cwd,
    model: s.model,
    startTime: s.startTime,
    endTime: s.endTime,
    totalTurns: s.totalTurns,
    userTurns: s.userTurns,
    tokens: s.tokens,
    toolStats: s.toolStats,
    errors: s.errors,
    filesModified: s.filesModified,
    messages: s.messages.map((m) => ({
      role: m.role,
      timestamp: m.timestamp,
      text: truncText(m.text),
      toolCalls: m.toolCalls?.map((tc) => ({ tool: tc.tool, inputKeys: tc.input && typeof tc.input === "object" ? Object.keys(tc.input) : [] })),
    })),
  };
}

function hybridSummary(s: ExtractedSession) {
  return {
    sessionId: s.sessionId,
    startTime: s.startTime,
    endTime: s.endTime,
    model: s.model,
    totalTurns: s.totalTurns,
    tokens: s.tokens,
    toolStats: s.toolStats,
    errorCount: s.errors.length,
    filesModified: s.filesModified,
    userMessages: s.messages.filter((m) => m.role === "user" && m.text).map((m) => ({ timestamp: m.timestamp, text: truncText(m.text) })),
    assistantSnippets: s.messages.filter((m) => m.role === "assistant" && m.text).map((m) => m.text!.slice(0, 200)),
  };
}

function compactSummary(s: ExtractedSession) {
  return {
    sessionId: s.sessionId,
    startTime: s.startTime,
    totalTurns: s.totalTurns,
    userTurns: s.userTurns,
    tokens: s.tokens,
    toolStats: s.toolStats,
    errorCount: s.errors.length,
    filesModified: s.filesModified,
    userPrompts: s.messages.filter((m) => m.role === "user").map((m) => m.text?.slice(0, 300)).filter(Boolean),
  };
}

export function prepareSessionData(project: ExtractedProject): string {
  const strat = pickStrategy(project.sessions.length);
  if (strat === "full") return JSON.stringify(project.sessions.map(truncateToolOutputs));
  if (strat === "hybrid") return JSON.stringify(project.sessions.map(hybridSummary));
  return JSON.stringify(project.sessions.map(compactSummary));
}

export function summarizeAllSessions(projects: ExtractedProject[]): string {
  const all = projects.flatMap((p) => p.sessions);
  return JSON.stringify(all.map(compactSummary));
}
