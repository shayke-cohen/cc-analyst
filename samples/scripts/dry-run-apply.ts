// Run a dry-run apply against a previously-saved analysis.json without
// going through the CLI. Demonstrates the right async-wrapping pattern
// for inline `tsx` use (top-level await fails in tsx's CJS eval mode).
//
// Usage:
//   npx tsx samples/scripts/dry-run-apply.ts <path-to-analysis.json>

import { readFileSync } from "node:fs";
import { apply } from "../../src/apply/index.js";

(async () => {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx dry-run-apply.ts <analysis.json>");
    process.exit(1);
  }
  const output = JSON.parse(readFileSync(path, "utf8"));
  const result = await apply(output, { mode: "dry-run" });
  console.log("\n=== DRY-RUN RESULT ===");
  console.log("  applied (files):  ", result.applied.length);
  console.log("  skipped:          ", result.skipped.length);
  console.log("  skillsCreated:    ", result.skillsCreated.length);
  console.log("  skillsUpdated:    ", result.skillsUpdated.length);
})();
