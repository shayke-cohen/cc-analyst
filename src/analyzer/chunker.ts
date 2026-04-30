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

function serializeSessions(sessions: ExtractedSession[], strategy: ChunkStrategy): string {
  if (strategy === "full") return JSON.stringify(sessions.map(truncateToolOutputs));
  if (strategy === "hybrid") return JSON.stringify(sessions.map(hybridSummary));
  return JSON.stringify(sessions.map(compactSummary));
}

export function prepareSessionData(project: ExtractedProject): { data: string; strategy: ChunkStrategy } {
  const strategy = pickStrategy(project.sessions.length);
  return { data: serializeSessions(project.sessions, strategy), strategy };
}

export const PATTERN_BATCH_SIZE = 100;

export function prepareSessionBatches(
  project: ExtractedProject,
  batchSize: number = PATTERN_BATCH_SIZE,
): { batches: string[]; strategy: ChunkStrategy } {
  const strategy = pickStrategy(project.sessions.length);
  const sessions = project.sessions;
  if (sessions.length <= batchSize) {
    return { batches: [serializeSessions(sessions, strategy)], strategy };
  }
  const batches: string[] = [];
  for (let i = 0; i < sessions.length; i += batchSize) {
    batches.push(serializeSessions(sessions.slice(i, i + batchSize), strategy));
  }
  return { batches, strategy };
}

const CONFIDENCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

export function mergePatternResults(
  results: Array<{ patterns?: any[]; sessionSummaries?: any[] }>,
): { patterns: any[]; sessionSummaries: any[] } {
  const byKey = new Map<string, any>();
  const summaries: any[] = [];
  for (const r of results) {
    for (const s of r.sessionSummaries ?? []) summaries.push(s);
    for (const p of r.patterns ?? []) {
      const key = `${p.category}::${(p.description ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          ...p,
          sessionIds: [...(p.sessionIds ?? [])],
          quotes: [...(p.quotes ?? [])],
        });
        continue;
      }
      existing.occurrences = (existing.occurrences ?? 0) + (p.occurrences ?? 0);
      const seen = new Set(existing.sessionIds);
      for (const id of p.sessionIds ?? []) if (!seen.has(id)) existing.sessionIds.push(id);
      for (const q of p.quotes ?? []) if (existing.quotes.length < 5) existing.quotes.push(q);
      if ((CONFIDENCE_RANK[p.confidence] ?? 0) > (CONFIDENCE_RANK[existing.confidence] ?? 0)) {
        existing.confidence = p.confidence;
      }
      if (!existing.suggestedRule && p.suggestedRule) existing.suggestedRule = p.suggestedRule;
      if (!existing.suggestedSkill && p.suggestedSkill) existing.suggestedSkill = p.suggestedSkill;
    }
  }
  return { patterns: Array.from(byKey.values()), sessionSummaries: summaries };
}

export function maxTurnsForStrategy(strategy: ChunkStrategy): number {
  if (strategy === "summary") return 8;
  if (strategy === "hybrid") return 5;
  return 3;
}

export function summarizeAllSessions(projects: ExtractedProject[]): string {
  const all = projects.flatMap((p) => p.sessions);
  return JSON.stringify(all.map(compactSummary));
}
