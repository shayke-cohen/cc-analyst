import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BACKUPS_DIR } from "../utils/paths.js";

export interface BackupFile {
  originalPath: string;
  backupPath: string;
  type: "claude-md" | "agents-md" | "skill";
  scope: "global" | "project";
  projectName?: string;
}

export interface BackupManifest {
  timestamp: string;
  toolVersion: string;
  files: BackupFile[];
}

export function createBackupSession(): { id: string; dir: string } {
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(BACKUPS_DIR, id);
  mkdirSync(dir, { recursive: true });
  return { id, dir };
}

export function backupFile(sessionDir: string, originalPath: string, file: Omit<BackupFile, "backupPath">): BackupFile {
  if (!existsSync(originalPath)) {
    return { ...file, backupPath: "" };
  }
  const rel = originalPath.replace(/^\//, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  const backupPath = join(sessionDir, rel);
  mkdirSync(dirname(backupPath), { recursive: true });
  copyFileSync(originalPath, backupPath);
  return { ...file, backupPath };
}

export function writeManifest(sessionDir: string, manifest: BackupManifest) {
  writeFileSync(join(sessionDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

export function readManifest(sessionDir: string): BackupManifest | null {
  const p = join(sessionDir, "manifest.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export function listBackups(): { id: string; dir: string; manifest: BackupManifest | null }[] {
  if (!existsSync(BACKUPS_DIR)) return [];
  const entries = readdirSync(BACKUPS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  return entries.map((e) => ({
    id: e.name,
    dir: join(BACKUPS_DIR, e.name),
    manifest: readManifest(join(BACKUPS_DIR, e.name)),
  })).sort((a, b) => b.id.localeCompare(a.id));
}

export function restoreBackup(sessionDir: string, dryRun = false): { restored: string[]; missing: string[] } {
  const manifest = readManifest(sessionDir);
  if (!manifest) throw new Error(`No manifest in ${sessionDir}`);
  const restored: string[] = [];
  const missing: string[] = [];
  for (const f of manifest.files) {
    if (!f.backupPath || !existsSync(f.backupPath)) { missing.push(f.originalPath); continue; }
    if (!dryRun) {
      mkdirSync(dirname(f.originalPath), { recursive: true });
      copyFileSync(f.backupPath, f.originalPath);
    }
    restored.push(f.originalPath);
  }
  return { restored, missing };
}

export function pruneOldBackups(maxKeep: number) {
  const all = listBackups();
  if (all.length <= maxKeep) return;
  for (const b of all.slice(maxKeep)) {
    rmSync(b.dir, { recursive: true, force: true });
  }
}
