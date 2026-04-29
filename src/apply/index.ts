import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import inquirer from "inquirer";
import chalk from "chalk";
import type { AnalysisOutput, ProjectAnalysis } from "../analyzer/index.js";
import type { SkillRecommendation } from "../types.js";
import { applyOps, patchToOps } from "./patch.js";
import { unifiedDiff } from "./diff.js";
import { backupFile, createBackupSession, pruneOldBackups, writeManifest } from "./backup.js";
import { CLAUDE_HOME, CLAUDE_SKILLS_GLOBAL } from "../utils/paths.js";

export interface ApplyOptions {
  mode: "interactive" | "auto" | "dry-run";
  autoApplyConfidence?: "high" | "medium" | "low";
  only?: "instructions" | "skills";
  maxBackups?: number;
}

export interface ApplyResult {
  applied: { file: string; opsApplied: number }[];
  skipped: { file: string; reason: string }[];
  skillsCreated: string[];
  skillsUpdated: string[];
  backupId: string | null;
}

const CONFIDENCE_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

function meetsThreshold(item: { confidence?: string }, threshold: "high" | "medium" | "low"): boolean {
  const c = item.confidence ?? "low";
  return CONFIDENCE_RANK[c] >= CONFIDENCE_RANK[threshold];
}

async function confirm(message: string, defaultYes = true): Promise<boolean> {
  const ans = await inquirer.prompt({ type: "confirm", name: "ok", message, default: defaultYes });
  return !!(ans as any).ok;
}

async function chooseAction(label: string, choices: string[]): Promise<string> {
  const ans = await inquirer.prompt({ type: "list", name: "action", message: label, choices });
  return (ans as any).action;
}

async function applyInstructions(analysis: ProjectAnalysis, sessionDir: string, opts: ApplyOptions, manifestFiles: any[]): Promise<{ file: string; opsApplied: number } | null> {
  const patch = analysis.instructionsPatch;
  if (!patch) return null;

  const target = patch.targetFile;
  const original = patch.currentContent ?? (existsSync(target) ? readFileSync(target, "utf8") : "");
  const ops = patchToOps(patch);

  if (ops.length === 0) return null;

  const result = applyOps(original, ops);
  const diff = unifiedDiff(target, original, result.patched);

  console.log(chalk.bold(`\n═══ ${analysis.project.name} (${analysis.source}) → ${patch.fileKind} ═══`));
  console.log(chalk.gray(target));
  console.log(diff || chalk.gray("(no textual change produced)"));

  if (opts.mode === "dry-run") return null;

  let go = false;
  if (opts.mode === "auto") {
    const allHigh = (patch.additions ?? []).every((a) => meetsThreshold(a, opts.autoApplyConfidence ?? "high"))
      && (patch.modifications ?? []).every((m) => meetsThreshold(m, opts.autoApplyConfidence ?? "high"));
    go = allHigh;
  } else {
    const action = await chooseAction(`Apply patch to ${patch.fileKind}?`, ["accept", "skip", "show ops failed"]);
    if (action === "show ops failed") {
      console.log(chalk.yellow(JSON.stringify(result.opsFailed, null, 2)));
      go = await confirm("Apply anyway?", false);
    } else go = action === "accept";
  }

  if (!go) return null;

  if (existsSync(target)) {
    const bf = backupFile(sessionDir, target, {
      originalPath: target,
      type: patch.fileKind === "CLAUDE.md" ? "claude-md" : "agents-md",
      scope: "project",
      projectName: analysis.project.name,
    });
    manifestFiles.push(bf);
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, result.patched);
  return { file: target, opsApplied: result.opsApplied };
}

function resolveSkillTarget(rec: SkillRecommendation, projectPath: string): string {
  const filename = rec.filename.endsWith(".md") ? rec.filename : `${rec.filename}.md`;
  if (rec.scope === "project") return join(projectPath, ".claude", "skills", filename);
  return join(CLAUDE_SKILLS_GLOBAL, filename);
}

async function applySkills(analysis: ProjectAnalysis, sessionDir: string, opts: ApplyOptions, manifestFiles: any[]): Promise<{ created: string[]; updated: string[] }> {
  const created: string[] = [];
  const updated: string[] = [];

  for (const rec of analysis.skills) {
    const target = resolveSkillTarget(rec, analysis.project.decodedPath);
    const exists = existsSync(target);
    const action = exists ? "update" : "create";

    console.log(chalk.bold(`\n── skill ${action}: ${target} ──`));
    if (exists) {
      const current = readFileSync(target, "utf8");
      console.log(unifiedDiff(target, current, rec.content));
    } else {
      console.log(chalk.gray(rec.description));
    }

    if (opts.mode === "dry-run") continue;

    let go = false;
    if (opts.mode === "auto") {
      go = !exists;
    } else {
      go = await confirm(`${action} skill ${rec.filename}?`, !exists);
    }

    if (!go) continue;

    if (exists) {
      manifestFiles.push(backupFile(sessionDir, target, { originalPath: target, type: "skill", scope: rec.scope, projectName: analysis.project.name }));
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, rec.content);
    if (exists) updated.push(target); else created.push(target);
  }

  return { created, updated };
}

export async function apply(output: AnalysisOutput, opts: ApplyOptions): Promise<ApplyResult> {
  const session = opts.mode === "dry-run" ? null : createBackupSession();
  const sessionDir = session?.dir ?? "";
  const manifestFiles: any[] = [];

  const applied: ApplyResult["applied"] = [];
  const skipped: ApplyResult["skipped"] = [];
  const skillsCreated: string[] = [];
  const skillsUpdated: string[] = [];

  for (const project of output.perProject) {
    if (opts.only !== "skills") {
      const r = await applyInstructions(project, sessionDir, opts, manifestFiles);
      if (r) applied.push(r);
      else if (project.instructionsPatch) skipped.push({ file: project.instructionsPatch.targetFile, reason: "user skipped or empty patch" });
    }
    if (opts.only !== "instructions") {
      const r = await applySkills(project, sessionDir, opts, manifestFiles);
      skillsCreated.push(...r.created);
      skillsUpdated.push(...r.updated);
    }
  }

  let backupId: string | null = null;
  if (session) {
    writeManifest(session.dir, {
      timestamp: new Date().toISOString(),
      toolVersion: "0.1.0",
      files: manifestFiles,
    });
    pruneOldBackups(opts.maxBackups ?? 20);
    backupId = session.id;
  }

  void CLAUDE_HOME;
  return { applied, skipped, skillsCreated, skillsUpdated, backupId };
}
