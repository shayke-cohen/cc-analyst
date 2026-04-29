import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function detectGit(repoPath: string): { remote?: string; branch?: string } {
  if (!existsSync(join(repoPath, ".git")) && !existsSync(repoPath)) return {};
  try {
    const remote = execSync("git config --get remote.origin.url", {
      cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { remote: remote || undefined, branch: branch || undefined };
  } catch {
    return {};
  }
}
