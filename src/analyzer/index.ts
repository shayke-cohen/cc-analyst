import type {
  AnalysisReport, EngineName, ExtractedProject, FeedbackReport, InstructionsPatch,
  SkillRecommendation, Source, UsageStats,
} from "../types.js";
import type { AnalysisEngine } from "../engine/index.js";
import { prepareSessionData, summarizeAllSessions } from "./chunker.js";
import {
  SYSTEM_PROMPT, crossProjectPrompt, feedbackPrompt, instructionsPrompt, patternsPrompt, skillsPrompt,
} from "./prompts.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_SKILLS_GLOBAL } from "../utils/paths.js";
import { instructionsTargetForApply } from "../extractor/instructions.js";

export interface AnalyzeOptions {
  engine: AnalysisEngine;
  model?: string;
  onlyPhases?: Array<"patterns" | "instructions" | "skills" | "feedback">;
}

export interface ProjectAnalysis {
  project: ExtractedProject["project"];
  source: Source;
  patterns: any;
  instructionsPatch: InstructionsPatch | null;
  skills: SkillRecommendation[];
}

export interface AnalysisOutput {
  perProject: ProjectAnalysis[];
  feedback?: FeedbackReport;
  crossProject?: any;
  reports: AnalysisReport[];
}

function stripFences(s: string): string {
  let t = s.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z0-9_-]*\n/, "");
    t = t.replace(/\n```\s*$/, "");
  }
  return t.trim();
}

async function runJson<T>(engine: AnalysisEngine, prompt: string, model?: string): Promise<T> {
  const raw = await engine.run(prompt, { model, systemPrompt: SYSTEM_PROMPT });
  const cleaned = stripFences(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    const repaired = await engine.run(
      `Your previous response was not valid JSON. Return ONLY the JSON, no commentary, no fences.\n\nPrevious response:\n${cleaned}`,
      { model, systemPrompt: SYSTEM_PROMPT },
    );
    return JSON.parse(stripFences(repaired)) as T;
  }
}

function shouldRun(opts: AnalyzeOptions, phase: "patterns" | "instructions" | "skills" | "feedback") {
  return !opts.onlyPhases || opts.onlyPhases.includes(phase);
}

function normalizeSkill(s: SkillRecommendation, project: { decodedPath: string }): SkillRecommendation {
  const filename = s.filename?.endsWith(".md") ? s.filename : `${s.filename ?? "skill"}.md`;
  const scope = s.scope ?? "project";
  const targetDir = s.targetDir ?? (scope === "global" ? CLAUDE_SKILLS_GLOBAL : join(project.decodedPath, ".claude", "skills"));
  const targetPath = join(targetDir, filename);
  const action = s.action ?? (existsSync(targetPath) ? "update" : "create");
  return { ...s, action, filename, scope, targetDir };
}

function computeStats(projects: ExtractedProject[]): UsageStats {
  const all = projects.flatMap((p) => p.sessions);
  const tools: Record<string, number> = {};
  const langCounts: Record<string, number> = {};
  let errors = 0;
  let totalTurns = 0;
  const tokens = { input: 0, output: 0 };
  for (const s of all) {
    tokens.input += s.tokens.input_tokens;
    tokens.output += s.tokens.output_tokens;
    totalTurns += s.totalTurns;
    errors += s.errors.length;
    for (const [t, n] of Object.entries(s.toolStats)) tools[t] = (tools[t] ?? 0) + n;
  }
  for (const p of projects) for (const lang of p.languages) langCounts[lang] = (langCounts[lang] ?? 0) + 1;
  const peakHours = new Array(24).fill(0);
  for (const s of all) {
    if (!s.startTime) continue;
    const h = new Date(s.startTime).getHours();
    if (Number.isFinite(h)) peakHours[h]++;
  }
  return {
    totalTokens: tokens,
    totalSessions: all.length,
    avgSessionLength: all.length ? totalTurns / all.length : 0,
    avgTokensPerSession: all.length ? (tokens.input + tokens.output) / all.length : 0,
    topTools: Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 10),
    topProjects: projects.map((p) => [p.project.name, p.sessionCount] as [string, number])
      .sort((a, b) => b[1] - a[1]).slice(0, 10),
    errorRate: totalTurns ? errors / totalTurns : 0,
    peakHours,
    languageDistribution: langCounts,
  };
}

export async function analyzePerProject(project: ExtractedProject, opts: AnalyzeOptions): Promise<ProjectAnalysis> {
  const sessionData = prepareSessionData(project);
  const projectName = project.project.name;
  const source = project.project.source;

  let patterns: any = { patterns: [], sessionSummaries: [] };
  if (shouldRun(opts, "patterns")) {
    patterns = await runJson(opts.engine, patternsPrompt(sessionData, projectName, source), opts.model);
  }

  let instructionsPatch: InstructionsPatch | null = null;
  if (shouldRun(opts, "instructions")) {
    const target = instructionsTargetForApply(project.project);
    const currentFile = project.instructionsFiles.find((f) => f.kind === target.kind && f.exists);
    instructionsPatch = await runJson<InstructionsPatch>(
      opts.engine,
      instructionsPrompt(
        JSON.stringify(patterns.patterns ?? []),
        currentFile?.content ?? null,
        target.kind,
        target.path,
        projectName,
        "project",
      ),
      opts.model,
    );
    instructionsPatch.targetFile = target.path;
    instructionsPatch.fileKind = target.kind;
    instructionsPatch.currentContent = currentFile?.content ?? null;
  }

  let skills: SkillRecommendation[] = [];
  if (shouldRun(opts, "skills") && source === "claude-code") {
    const result = await runJson<{ skills: SkillRecommendation[] }>(
      opts.engine,
      skillsPrompt(
        JSON.stringify(patterns.patterns ?? []),
        sessionData,
        project.skills.map((s) => ({ filename: s.filename, content: s.content })),
        projectName,
        "project",
      ),
      opts.model,
    );
    skills = (result.skills ?? []).map((s) => normalizeSkill(s, project.project));
  }

  return { project: project.project, source, patterns, instructionsPatch, skills };
}

export async function analyze(projects: ExtractedProject[], opts: AnalyzeOptions): Promise<AnalysisOutput> {
  const perProject: ProjectAnalysis[] = [];
  for (const p of projects) {
    perProject.push(await analyzePerProject(p, opts));
  }

  const stats = computeStats(projects);
  let feedback: FeedbackReport | undefined;
  if (shouldRun(opts, "feedback")) {
    const allPatterns = perProject.flatMap((r) => r.patterns?.patterns ?? []);
    feedback = await runJson<FeedbackReport>(
      opts.engine,
      feedbackPrompt(
        summarizeAllSessions(projects),
        JSON.stringify(allPatterns),
        JSON.stringify(stats),
        projects.length === 1 ? `project "${projects[0].project.name}"` : "all projects",
      ),
      opts.model,
    );
  }

  let crossProject: any;
  if (projects.length >= 2) {
    crossProject = await runJson(
      opts.engine,
      crossProjectPrompt(
        JSON.stringify(perProject.map((r) => ({ project: r.project.name, source: r.source, patterns: r.patterns?.patterns ?? [] }))),
        "~/.claude/CLAUDE.md and ~/.codex/AGENTS.md",
      ),
      opts.model,
    );
  }

  const reports: AnalysisReport[] = perProject.map((r, i) => ({
    generatedAt: new Date().toISOString(),
    sessionRange: { from: projects[i].sessions[0]?.startTime ?? "", to: projects[i].sessions.at(-1)?.endTime ?? "" },
    sessionCount: projects[i].sessions.length,
    scope: "project",
    source: r.source,
    engine: opts.engine.name as EngineName,
    projectRef: r.project,
    instructionsPatch: r.instructionsPatch ?? undefined,
    skills: r.skills,
    feedback: undefined,
    stats,
  }));

  return { perProject, feedback, crossProject, reports };
}

export { computeStats };
