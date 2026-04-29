import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPack, readPack, writePack } from "../../src/share/pack.js";
import type { AnalysisOutput } from "../../src/analyzer/index.js";

const dummyAnalysis: AnalysisOutput = {
  perProject: [
    {
      project: { encodedDir: "x", decodedPath: "/x", name: "x", source: "claude-code" },
      source: "claude-code",
      patterns: { patterns: [], sessionSummaries: [] },
      instructionsPatch: {
        targetFile: "/x/CLAUDE.md",
        fileKind: "CLAUDE.md",
        currentContent: null,
        additions: [
          { section: "Tests", rule: "Run vitest", evidence: "5 sessions", confidence: "high", scope: "project" },
          { section: "Tests", rule: "Mock HTTP", evidence: "3 sessions", confidence: "low", scope: "project" },
        ],
        modifications: [],
        removals: [],
      },
      skills: [],
    },
  ],
  reports: [],
};

describe("buildPack", () => {
  it("includes only rules at or above min-confidence", () => {
    const pack = buildPack({ name: "p", analysis: dummyAnalysis, toolVersion: "0", minConfidence: "medium" });
    expect(pack.rules.length).toBe(1);
    expect(pack.rules[0].rule).toBe("Run vitest");
    expect(pack.provenance.confidenceDistribution.high).toBe(1);
  });

  it("includes low-confidence when threshold is low", () => {
    const pack = buildPack({ name: "p", analysis: dummyAnalysis, toolVersion: "0", minConfidence: "low" });
    expect(pack.rules.length).toBe(2);
  });

  it("roundtrips through write/read", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-"));
    const path = join(dir, "p.ccpack.json");
    const pack = buildPack({ name: "p", analysis: dummyAnalysis, toolVersion: "0" });
    writePack(path, pack);
    const loaded = readPack(path);
    expect(loaded.name).toBe("p");
    expect(loaded.rules.length).toBe(pack.rules.length);
    expect(JSON.parse(readFileSync(path, "utf8")).id).toBe(pack.id);
  });
});
