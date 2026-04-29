import { createPatch } from "diff";

export function unifiedDiff(filePath: string, oldText: string, newText: string): string {
  return createPatch(filePath, oldText ?? "", newText ?? "", "", "");
}
