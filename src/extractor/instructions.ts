import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { InstructionsFile, ProjectRef, SkillFile, Source } from "../types.js";
import {
  AGENTS_MD_GLOBAL, CLAUDE_HOME, CLAUDE_MD_GLOBAL, CLAUDE_SKILLS_GLOBAL, CODEX_HOME, exists,
} from "../utils/paths.js";

function readIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function fileEntry(kind: "CLAUDE.md" | "AGENTS.md", path: string, scope: "global" | "project"): InstructionsFile {
  const content = readIfExists(path);
  return { kind, path, scope, content, exists: content !== null };
}

export function findProjectInstructions(project: ProjectRef): InstructionsFile[] {
  const out: InstructionsFile[] = [];
  if (project.source === "claude-code") {
    const candidates = [
      join(project.decodedPath, "CLAUDE.md"),
      join(project.decodedPath, ".claude", "CLAUDE.md"),
    ];
    for (const p of candidates) out.push(fileEntry("CLAUDE.md", p, "project"));
  } else {
    const candidates = [
      join(project.decodedPath, "AGENTS.override.md"),
      join(project.decodedPath, "AGENTS.md"),
      join(project.decodedPath, ".codex", "AGENTS.md"),
    ];
    for (const p of candidates) out.push(fileEntry("AGENTS.md", p, "project"));
  }
  return out.filter((f) => f.exists);
}

export function findGlobalInstructions(source: Source): InstructionsFile[] {
  if (source === "claude-code") {
    return [fileEntry("CLAUDE.md", CLAUDE_MD_GLOBAL, "global")];
  }
  return [fileEntry("AGENTS.md", AGENTS_MD_GLOBAL, "global")];
}

export function instructionsTargetForApply(project: ProjectRef): { path: string; kind: "CLAUDE.md" | "AGENTS.md" } {
  if (project.source === "claude-code") {
    const a = join(project.decodedPath, "CLAUDE.md");
    const b = join(project.decodedPath, ".claude", "CLAUDE.md");
    return { path: existsSync(b) && !existsSync(a) ? b : a, kind: "CLAUDE.md" };
  }
  return { path: join(project.decodedPath, "AGENTS.md"), kind: "AGENTS.md" };
}

export function findProjectSkills(project: ProjectRef): SkillFile[] {
  if (project.source !== "claude-code") return [];
  const out: SkillFile[] = [];
  const dirs = [
    join(project.decodedPath, ".claude", "skills"),
    join(project.decodedPath, ".claude", "commands"),
  ];
  for (const dir of dirs) collectSkills(dir, "project", out);
  return out;
}

export function findGlobalSkills(source: Source): SkillFile[] {
  if (source !== "claude-code") return [];
  const out: SkillFile[] = [];
  collectSkills(CLAUDE_SKILLS_GLOBAL, "global", out);
  collectSkills(join(CLAUDE_HOME, "commands"), "global", out);
  return out;
}

function collectSkills(dir: string, scope: "global" | "project", out: SkillFile[]) {
  if (!exists(dir)) return;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        const skill = join(p, "SKILL.md");
        if (existsSync(skill)) {
          out.push({ filename: `${entry.name}/SKILL.md`, path: skill, scope, content: readIfExists(skill) });
        }
      } else if (entry.name.endsWith(".md")) {
        out.push({ filename: entry.name, path: p, scope, content: readIfExists(p) });
      }
    }
  } catch { /* skip */ }
}

void CODEX_HOME;
