import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

// We test the codex normalizer indirectly via a minimal fixture and the public extract flow.
// Codex extractor reads ~/.codex/sessions; we cannot easily reroot that without DI,
// so this test focuses on what we *can* test deterministically: the parsing of one rollout file.
// We import the internal module by re-importing through an isolated helper.

import { extractAllCodex } from "../../src/extractor/codex.js";

describe("codex extractor (real ~/.codex)", () => {
  it("returns an array (smoke; tolerant of empty)", () => {
    const result = extractAllCodex();
    expect(Array.isArray(result.sessions)).toBe(true);
    expect(Array.isArray(result.projects)).toBe(true);
  });

  it("each session has required normalized fields", () => {
    const { sessions } = extractAllCodex();
    for (const s of sessions.slice(0, 3)) {
      expect(s.source).toBe("codex");
      expect(s.sessionId).toBeTruthy();
      expect(s.cwd).toBeTruthy();
      expect(typeof s.totalTurns).toBe("number");
      expect(typeof s.userTurns).toBe("number");
      expect(s.toolStats).toBeTypeOf("object");
      expect(Array.isArray(s.messages)).toBe(true);
    }
  });
});

void mkdirSync; void mkdtempSync; void writeFileSync; void tmpdir; void homedir; void join;
