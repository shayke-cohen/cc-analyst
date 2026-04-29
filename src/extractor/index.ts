import type { ExtractedProject, ExtractedSession, ExtractOptions, ProjectRef, TokenUsage, Source } from "../types.js";
import { extractClaudeProject, listClaudeProjects } from "./claude-code.js";
import { extractAllCodex } from "./codex.js";
import { findGlobalInstructions, findGlobalSkills, findProjectInstructions, findProjectSkills } from "./instructions.js";

const LANG_BY_EXT: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  py: "Python", rs: "Rust", go: "Go", java: "Java", kt: "Kotlin",
  swift: "Swift", rb: "Ruby", php: "PHP", c: "C", cpp: "C++", cc: "C++",
  cs: "C#", md: "Markdown", json: "JSON", yaml: "YAML", yml: "YAML",
  sh: "Shell", html: "HTML", css: "CSS", sql: "SQL",
};

function detectLanguages(sessions: ExtractedSession[]): string[] {
  const counts: Record<string, number> = {};
  for (const s of sessions) {
    for (const f of s.filesModified) {
      const ext = f.split(".").pop()?.toLowerCase();
      if (!ext) continue;
      const lang = LANG_BY_EXT[ext];
      if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

function peakHours(sessions: ExtractedSession[]): number[] {
  const hours = new Array(24).fill(0);
  for (const s of sessions) {
    if (!s.startTime) continue;
    const h = new Date(s.startTime).getHours();
    if (Number.isFinite(h)) hours[h]++;
  }
  return hours;
}

function aggregateTokens(sessions: ExtractedSession[]): TokenUsage {
  const out: TokenUsage = { input_tokens: 0, output_tokens: 0 };
  for (const s of sessions) {
    out.input_tokens += s.tokens.input_tokens;
    out.output_tokens += s.tokens.output_tokens;
    if (s.tokens.cache_creation_input_tokens) out.cache_creation_input_tokens = (out.cache_creation_input_tokens ?? 0) + s.tokens.cache_creation_input_tokens;
    if (s.tokens.cache_read_input_tokens) out.cache_read_input_tokens = (out.cache_read_input_tokens ?? 0) + s.tokens.cache_read_input_tokens;
  }
  return out;
}

function buildProject(project: ProjectRef, sessions: ExtractedSession[]): ExtractedProject {
  return {
    project,
    instructionsFiles: findProjectInstructions(project),
    skills: findProjectSkills(project),
    languages: detectLanguages(sessions),
    peakHours: peakHours(sessions),
    aggregateTokens: aggregateTokens(sessions),
    sessionCount: sessions.length,
    sessions,
  };
}

export interface ExtractResult {
  generatedAt: string;
  source: Source | "all";
  daysBack?: number;
  projects: ExtractedProject[];
  globalInstructions: { source: Source; files: ReturnType<typeof findGlobalInstructions> }[];
  globalSkills: { source: Source; files: ReturnType<typeof findGlobalSkills> }[];
}

export function extract(opts: ExtractOptions): ExtractResult {
  const projects: ExtractedProject[] = [];
  const wantedSources: Source[] = opts.source === "all" ? ["claude-code", "codex"] : [opts.source];

  if (wantedSources.includes("claude-code")) {
    for (const p of listClaudeProjects()) {
      if (opts.projectFilter && !p.name.includes(opts.projectFilter) && !p.decodedPath.includes(opts.projectFilter)) continue;
      const sessions = extractClaudeProject(p, opts.days);
      if (sessions.length === 0) continue;
      projects.push(buildProject(p, sessions));
    }
  }

  if (wantedSources.includes("codex")) {
    const { sessions } = extractAllCodex(opts.days);
    const grouped = new Map<string, { project: ProjectRef; sessions: ExtractedSession[] }>();
    for (const s of sessions) {
      if (opts.projectFilter && !s.project.name.includes(opts.projectFilter) && !s.project.decodedPath.includes(opts.projectFilter)) continue;
      const key = s.project.decodedPath;
      const g = grouped.get(key) ?? { project: s.project, sessions: [] };
      g.sessions.push(s);
      grouped.set(key, g);
    }
    for (const { project, sessions: ss } of grouped.values()) {
      projects.push(buildProject(project, ss));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    source: opts.source,
    daysBack: opts.days,
    projects,
    globalInstructions: wantedSources.map((s) => ({ source: s, files: findGlobalInstructions(s) })),
    globalSkills: wantedSources.map((s) => ({ source: s, files: findGlobalSkills(s) })),
  };
}

export function listProjects(opts: { source: Source | "all" }): ProjectRef[] {
  const out: ProjectRef[] = [];
  const wanted: Source[] = opts.source === "all" ? ["claude-code", "codex"] : [opts.source];
  if (wanted.includes("claude-code")) out.push(...listClaudeProjects());
  if (wanted.includes("codex")) {
    const { projects } = extractAllCodex();
    out.push(...projects);
  }
  return out;
}
