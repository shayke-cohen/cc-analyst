import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

export const HOME = homedir();
export const CLAUDE_HOME = join(HOME, ".claude");
export const CLAUDE_PROJECTS = join(CLAUDE_HOME, "projects");
export const CLAUDE_SKILLS_GLOBAL = join(CLAUDE_HOME, "skills");
export const CLAUDE_MD_GLOBAL = join(CLAUDE_HOME, "CLAUDE.md");
export const CODEX_HOME = join(HOME, ".codex");
export const CODEX_SESSIONS = join(CODEX_HOME, "sessions");
export const CODEX_ARCHIVED = join(CODEX_HOME, "archived_sessions");
export const CODEX_HISTORY = join(CODEX_HOME, "history.jsonl");
export const AGENTS_MD_GLOBAL = join(CODEX_HOME, "AGENTS.md");
export const TOOL_HOME = join(HOME, ".cc-analyst");
export const BACKUPS_DIR = join(TOOL_HOME, "backups");
export const AUDIT_LOG = join(TOOL_HOME, "audit.log");

export function decodeProjectDir(encoded: string): string {
  let s = encoded;
  const leading = s.startsWith("-");
  if (leading) s = s.slice(1);
  s = s.replace(/--/g, "/.").replace(/-/g, "/");
  return leading ? "/" + s : s;
}

export function encodeProjectDir(absolutePath: string): string {
  return absolutePath.replace(/\//g, "-");
}

export function exists(path: string): boolean {
  try { return existsSync(path); } catch { return false; }
}
