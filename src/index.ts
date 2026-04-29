#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { Source, EngineName } from "./types.js";
import { extract, listProjects } from "./extractor/index.js";
import { makeEngine } from "./engine/index.js";
import { analyze } from "./analyzer/index.js";
import { apply } from "./apply/index.js";
import { listBackups, restoreBackup } from "./apply/backup.js";
import { exportPack } from "./share/export.js";
import { importPack, previewImport } from "./share/import.js";
import { readPack } from "./share/pack.js";
import { listProjects as listProjectsForShare } from "./extractor/index.js";
import { readFileSync } from "node:fs";

const program = new Command();
program
  .name("cc-analyst")
  .description("Extract Claude Code & Codex sessions, analyze, and patch instruction files")
  .version("0.1.0");

function parseSource(s: string): Source | "all" {
  if (s === "all" || s === "claude-code" || s === "codex") return s as any;
  throw new Error(`--source must be claude-code | codex | all (got "${s}")`);
}
function parseEngine(s: string): EngineName {
  if (s === "claude-code" || s === "codex") return s;
  throw new Error(`--engine must be claude-code | codex (got "${s}")`);
}

program
  .command("extract")
  .description("Extract sessions to JSON (no API calls)")
  .option("--source <s>", "claude-code | codex | all", "all")
  .option("--days <n>", "limit to last N days", (v) => parseInt(v, 10))
  .option("--project <name>", "filter by project name/path substring")
  .option("--list-projects", "list discovered projects only")
  .option("-o, --output <file>", "write to file instead of stdout")
  .option("--format <f>", "full | summary", "full")
  .action((opts) => {
    const source = parseSource(opts.source);
    if (opts.listProjects) {
      const projects = listProjects({ source });
      const lines = projects.map((p) => `[${p.source}] ${p.name}\t${p.decodedPath}${p.gitRemote ? "\t(" + p.gitRemote + ")" : ""}`);
      const out = lines.join("\n");
      if (opts.output) writeFileSync(opts.output, out);
      else console.log(out);
      return;
    }
    const result = extract({
      source, days: opts.days, projectFilter: opts.project,
      includeInstructions: true, includeSkills: true,
    });
    if (opts.format === "summary") {
      const summary = {
        ...result,
        projects: result.projects.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) => ({
            sessionId: s.sessionId, source: s.source, cwd: s.cwd,
            startTime: s.startTime, totalTurns: s.totalTurns, userTurns: s.userTurns,
            tokens: s.tokens, toolStats: s.toolStats, errorCount: s.errors.length,
            filesModified: s.filesModified,
          })),
        })),
      };
      const text = JSON.stringify(summary, null, 2);
      if (opts.output) writeFileSync(opts.output, text);
      else process.stdout.write(text + "\n");
      return;
    }
    const text = JSON.stringify(result, null, 2);
    if (opts.output) writeFileSync(opts.output, text);
    else process.stdout.write(text + "\n");
  });

program
  .command("projects")
  .description("List discovered projects")
  .option("--source <s>", "claude-code | codex | all", "all")
  .action((opts) => {
    const projects = listProjects({ source: parseSource(opts.source) });
    for (const p of projects) {
      console.log(`${chalk.cyan("[" + p.source + "]")} ${chalk.bold(p.name)}\t${p.decodedPath}${p.gitRemote ? "  " + chalk.gray(p.gitRemote) : ""}`);
    }
  });

program
  .command("analyze", { isDefault: true })
  .description("Run analysis pipeline")
  .option("--source <s>", "claude-code | codex | all", "all")
  .option("--engine <e>", "claude-code | codex", "claude-code")
  .option("--model <m>", "model id override")
  .option("--days <n>", "limit to last N days", (v) => parseInt(v, 10))
  .option("--project <name>", "single project filter")
  .option("--all", "all projects")
  .option("--only <phase>", "patterns | instructions | skills | feedback")
  .option("--apply", "apply recommendations after analysis")
  .option("--auto", "auto-apply high-confidence (with --apply)")
  .option("--dry-run", "preview without writing (with --apply)")
  .option("-o, --output <dir>", "write reports to directory")
  .action(async (opts) => {
    const source = parseSource(opts.source);
    const engineName = parseEngine(opts.engine);

    if (opts.apply && opts.only && opts.only !== "instructions" && opts.only !== "skills") {
      console.error(chalk.yellow(`Warning: --apply has nothing to do when --only ${opts.only} skips both the instructions and skills phases. Drop --only, or use --only instructions / --only skills.`));
    }

    const result = extract({ source, days: opts.days, projectFilter: opts.project });
    if (result.projects.length === 0) {
      console.error(chalk.yellow("No projects found matching filters."));
      process.exit(1);
    }
    const projects = opts.all || !opts.project ? result.projects : result.projects.filter((p) => p.project.name.includes(opts.project));

    console.log(chalk.gray(`Analyzing ${projects.length} project(s) with engine=${engineName}, ${projects.reduce((n, p) => n + p.sessions.length, 0)} sessions total.`));

    const engine = makeEngine(engineName);
    const onlyPhases = opts.only ? [opts.only] : undefined;
    const output = await analyze(projects, { engine, model: opts.model, onlyPhases });

    if (opts.output) {
      mkdirSync(opts.output, { recursive: true });
      writeFileSync(join(opts.output, "analysis.json"), JSON.stringify(output, null, 2));
      for (const r of output.reports) {
        const dir = join(opts.output, "projects", r.projectRef!.name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "report.json"), JSON.stringify(r, null, 2));
      }
      if (output.feedback) writeFileSync(join(opts.output, "feedback.json"), JSON.stringify(output.feedback, null, 2));
      if (output.crossProject) writeFileSync(join(opts.output, "cross-project.json"), JSON.stringify(output.crossProject, null, 2));
      console.log(chalk.green(`Reports written to ${opts.output}`));
    } else {
      console.log(JSON.stringify(output, null, 2));
    }

    if (opts.apply) {
      const hasPatches = output.perProject.some((p) => p.instructionsPatch || p.skills.length > 0);
      if (!hasPatches) {
        console.log(chalk.yellow("\nNo recommendations to apply (instructions and skills phases produced nothing)."));
      } else {
        const applyResult = await apply(output, {
          mode: opts.dryRun ? "dry-run" : opts.auto ? "auto" : "interactive",
          autoApplyConfidence: "high",
        });
        console.log(chalk.bold("\n═══ Apply Summary ═══"));
        console.log(`Applied: ${applyResult.applied.length} files (${applyResult.applied.reduce((n, a) => n + a.opsApplied, 0)} ops)`);
        console.log(`Skipped: ${applyResult.skipped.length}`);
        console.log(`Skills created: ${applyResult.skillsCreated.length}, updated: ${applyResult.skillsUpdated.length}`);
        if (applyResult.backupId) console.log(`Backup: ${applyResult.backupId}`);
      }
    }
  });

program
  .command("rollback")
  .description("Restore from a backup")
  .option("--list", "list backups")
  .option("--id <id>", "specific backup id")
  .option("--dry-run", "preview only")
  .action((opts) => {
    if (opts.list) {
      for (const b of listBackups()) {
        console.log(`${b.id}\t${b.manifest?.files?.length ?? 0} files`);
      }
      return;
    }
    const all = listBackups();
    const target = opts.id ? all.find((b) => b.id === opts.id) : all[0];
    if (!target) { console.error("No backup found"); process.exit(1); }
    const result = restoreBackup(target.dir, !!opts.dryRun);
    console.log(`Restored: ${result.restored.length}, missing: ${result.missing.length}`);
    if (opts.dryRun) console.log("(dry-run; no files written)");
  });

const share = program.command("share").description("Export, import, and inspect insight packs");

share
  .command("export")
  .description("Export an insight pack from a prior analysis (analysis.json)")
  .requiredOption("--analysis <file>", "path to analysis.json from a previous run")
  .requiredOption("--name <name>", "pack name")
  .requiredOption("-o, --output <file>", "output .ccpack.json path")
  .option("--description <d>", "pack description")
  .option("--author <a>", "author")
  .option("--tags <tags>", "comma-separated tags", (v) => v.split(",").map((t) => t.trim()))
  .option("--license <l>", "license", "MIT")
  .option("--min-confidence <c>", "high | medium | low", "medium")
  .option("--no-anonymize", "skip anonymization")
  .option("--agent-review", "additional agent-driven privacy review")
  .option("--engine <e>", "engine for agent review", "claude-code")
  .action(async (opts) => {
    const analysis = JSON.parse(readFileSync(opts.analysis, "utf8"));
    const engine = opts.agentReview ? makeEngine(parseEngine(opts.engine)) : undefined;
    const { pack } = await exportPack(analysis, {
      name: opts.name, description: opts.description, author: opts.author,
      tags: opts.tags ?? [], license: opts.license, output: opts.output,
      minConfidence: opts.minConfidence as any,
      anonymize: opts.anonymize, agentReview: opts.agentReview,
      engine, toolVersion: "0.1.0",
    });
    console.log(chalk.green(`Wrote ${opts.output}`));
    console.log(`  rules:  ${pack.rules.length}`);
    console.log(`  skills: ${pack.skills.length}`);
  });

share
  .command("import <packPath>")
  .description("Preview or apply an imported insight pack")
  .option("--apply", "actually write changes")
  .option("--dry-run", "preview only")
  .option("--strategy <s>", "union | replace | interactive | theirs | ours", "union")
  .option("--project <name>", "scope to a project (otherwise global)")
  .option("--engine <e>", "engine for semantic dup detection", "claude-code")
  .option("--no-semantic", "skip semantic dup detection")
  .action(async (packPath, opts) => {
    let project;
    if (opts.project) {
      const all = listProjectsForShare({ source: "all" });
      project = all.find((p) => p.name.includes(opts.project) || p.decodedPath.includes(opts.project));
      if (!project) { console.error(`No project matching "${opts.project}"`); process.exit(1); }
    }
    const engine = opts.semantic === false ? undefined : makeEngine(parseEngine(opts.engine));
    if (!opts.apply) {
      const preview = await previewImport(packPath, { engine, project, dryRun: true });
      console.log(chalk.bold(`\nPack: ${preview.pack.name}`));
      console.log(chalk.gray(preview.pack.description));
      console.log(`Target file: ${preview.target.path} (${preview.target.kind})`);
      console.log(`New rules: ${preview.newRules.length}`);
      console.log(`Duplicates: ${preview.duplicateRules.length}`);
      console.log(`New skills: ${preview.newSkills.length}`);
      console.log(`Overlapping skills: ${preview.existingSkills.length}`);
      console.log(chalk.yellow("\n(preview only — pass --apply to write)"));
      return;
    }
    const result = await importPack(packPath, { engine, project, apply: true, strategy: opts.strategy as any });
    console.log(chalk.green(`Applied ${result.ruleOpsApplied} rule ops, ${result.skillsCreated} skills created, ${result.skillsUpdated} updated`));
    if (result.backupId) console.log(`Backup: ${result.backupId}`);
  });

share
  .command("inspect <packPath>")
  .description("Show pack contents")
  .action((packPath) => {
    const pack = readPack(packPath);
    console.log(chalk.bold(`${pack.name} ${chalk.gray("v" + pack.version)}`));
    if (pack.author) console.log(`by ${pack.author}`);
    console.log(pack.description);
    console.log(chalk.gray(`tags: ${pack.tags.join(", ")} | sources: ${pack.provenance.sources.join(", ")} | rules: ${pack.rules.length} | skills: ${pack.skills.length}`));
    for (const r of pack.rules) {
      console.log(`\n${chalk.cyan(r.section)} [${r.confidence}${r.fileKind ? " · " + r.fileKind : ""}]`);
      console.log(`  ${r.rule}`);
    }
    for (const s of pack.skills) {
      console.log(`\n${chalk.magenta("skill:")} ${s.filename} — ${s.title}`);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
