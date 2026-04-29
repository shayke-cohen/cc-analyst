import { existsSync, readFileSync, writeFileSync } from "node:fs";
import inquirer from "inquirer";
import chalk from "chalk";
import type { AnalysisEngine } from "../engine/index.js";
import { applyOps, type PatchOp } from "../apply/patch.js";
import { ensureTrailingNewline } from "../apply/parser.js";
import { unifiedDiff } from "../apply/diff.js";
import { backupFile, createBackupSession, writeManifest } from "../apply/backup.js";
import { CLAUDE_MD_GLOBAL, AGENTS_MD_GLOBAL, CLAUDE_SKILLS_GLOBAL } from "../utils/paths.js";
import { instructionsTargetForApply } from "../extractor/instructions.js";
import type { ProjectRef } from "../types.js";
import type { InsightPack, MergeStrategy, SharedRule, SharedSkill } from "./types.js";
import { fastDuplicates, semanticDuplicates, type DuplicateGroup } from "./duplicate-detect.js";
import { readPack } from "./pack.js";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ImportOptions {
  strategy?: MergeStrategy;
  apply?: boolean;
  project?: ProjectRef;
  engine?: AnalysisEngine;
  dryRun?: boolean;
}

export interface ImportPreview {
  pack: InsightPack;
  newRules: SharedRule[];
  duplicateRules: DuplicateGroup[];
  newSkills: SharedSkill[];
  existingSkills: { skill: SharedSkill; targetPath: string }[];
  target: { path: string; kind: "CLAUDE.md" | "AGENTS.md" };
}

function existingRulesFromFile(path: string): SharedRule[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8");
  const out: SharedRule[] = [];
  let section = "";
  for (const line of content.split("\n")) {
    if (/^#{1,6}\s+/.test(line)) {
      section = line;
    } else if (line.trim().startsWith("-")) {
      const rule = line.replace(/^\s*-\s*/, "").trim();
      if (rule) out.push({ id: `local-${out.length}`, section, rule, rationale: "", confidence: "low", tags: [] });
    }
  }
  return out;
}

export async function previewImport(packPath: string, opts: ImportOptions): Promise<ImportPreview> {
  const pack = readPack(packPath);
  const target = opts.project
    ? instructionsTargetForApply(opts.project)
    : { path: pack.rules.some((r) => r.fileKind === "AGENTS.md") ? AGENTS_MD_GLOBAL : CLAUDE_MD_GLOBAL,
        kind: pack.rules.some((r) => r.fileKind === "AGENTS.md") ? "AGENTS.md" as const : "CLAUDE.md" as const };
  const existing = existingRulesFromFile(target.path);

  const dups = fastDuplicates(existing, pack.rules);
  let allDups = dups;
  if (opts.engine && pack.rules.length > 0) {
    const remaining = pack.rules.filter((r) => !dups.find((d) => d.theirs.id === r.id));
    if (remaining.length) {
      const semantic = await semanticDuplicates(existing, remaining, opts.engine);
      allDups = [...dups, ...semantic];
    }
  }

  const dupIds = new Set(allDups.map((d) => d.theirs.id));
  const newRules = pack.rules.filter((r) => !dupIds.has(r.id));

  const skillsDir = opts.project ? join(opts.project.decodedPath, ".claude", "skills") : CLAUDE_SKILLS_GLOBAL;
  const newSkills: SharedSkill[] = [];
  const existingSkills: { skill: SharedSkill; targetPath: string }[] = [];
  for (const s of pack.skills) {
    const targetPath = join(skillsDir, s.filename);
    if (existsSync(targetPath)) existingSkills.push({ skill: s, targetPath });
    else newSkills.push(s);
  }

  return { pack, newRules, duplicateRules: allDups, newSkills, existingSkills, target };
}

export async function importPack(packPath: string, opts: ImportOptions): Promise<{ ruleOpsApplied: number; skillsCreated: number; skillsUpdated: number; backupId: string | null }> {
  const preview = await previewImport(packPath, opts);
  const strategy = opts.strategy ?? "union";

  console.log(chalk.bold(`\nImporting pack: ${preview.pack.name}`));
  console.log(chalk.gray(preview.pack.description));
  console.log(`new rules: ${preview.newRules.length}`);
  console.log(`duplicate rules: ${preview.duplicateRules.length}`);
  console.log(`new skills: ${preview.newSkills.length}`);
  console.log(`overlapping skills: ${preview.existingSkills.length}`);

  if (!opts.apply || opts.dryRun) {
    console.log(chalk.yellow("(preview only — pass --apply to write)"));
    return { ruleOpsApplied: 0, skillsCreated: 0, skillsUpdated: 0, backupId: null };
  }

  const session = createBackupSession();
  const manifestFiles: any[] = [];

  const rulesToWrite: SharedRule[] = [];
  if (strategy === "replace" || strategy === "theirs") {
    rulesToWrite.push(...preview.pack.rules);
  } else if (strategy === "ours") {
    // skip everything
  } else if (strategy === "interactive") {
    rulesToWrite.push(...preview.newRules);
    for (const dup of preview.duplicateRules) {
      const ans = await inquirer.prompt({
        type: "list", name: "choice",
        message: `Duplicate detected (${dup.similarity}):\n  ours:   ${dup.ours.rule}\n  theirs: ${dup.theirs.rule}`,
        choices: ["keep ours", "use theirs", "skip"],
      });
      if ((ans as any).choice === "use theirs") rulesToWrite.push(dup.theirs);
    }
  } else {
    rulesToWrite.push(...preview.newRules);
  }

  let ruleOpsApplied = 0;
  if (rulesToWrite.length > 0) {
    const original = existsSync(preview.target.path) ? readFileSync(preview.target.path, "utf8") : "";
    const ops: PatchOp[] = rulesToWrite.map((r) => ({
      type: "append_to_section" as const,
      heading: r.section.startsWith("#") ? r.section : `## ${r.section}`,
      content: r.rule,
    }));
    const result = applyOps(original, ops);
    console.log(unifiedDiff(preview.target.path, original, result.patched));
    if (existsSync(preview.target.path)) {
      manifestFiles.push(backupFile(session.dir, preview.target.path, {
        originalPath: preview.target.path,
        type: preview.target.kind === "CLAUDE.md" ? "claude-md" : "agents-md",
        scope: opts.project ? "project" : "global",
        projectName: opts.project?.name,
      }));
    }
    mkdirSync(dirname(preview.target.path), { recursive: true });
    writeFileSync(preview.target.path, ensureTrailingNewline(result.patched));
    ruleOpsApplied = result.opsApplied;
  }

  let skillsCreated = 0;
  let skillsUpdated = 0;
  const skillsDir = opts.project ? join(opts.project.decodedPath, ".claude", "skills") : CLAUDE_SKILLS_GLOBAL;
  for (const s of preview.newSkills) {
    const target = join(skillsDir, s.filename);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, ensureTrailingNewline(s.content));
    skillsCreated++;
  }
  if (strategy === "replace" || strategy === "theirs") {
    for (const { skill, targetPath } of preview.existingSkills) {
      manifestFiles.push(backupFile(session.dir, targetPath, { originalPath: targetPath, type: "skill", scope: opts.project ? "project" : "global", projectName: opts.project?.name }));
      writeFileSync(targetPath, ensureTrailingNewline(skill.content));
      skillsUpdated++;
    }
  }

  writeManifest(session.dir, { timestamp: new Date().toISOString(), toolVersion: "0.1.0", files: manifestFiles });

  return { ruleOpsApplied, skillsCreated, skillsUpdated, backupId: session.id };
}
