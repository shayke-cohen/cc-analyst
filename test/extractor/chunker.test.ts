import { describe, expect, it } from "vitest";
import { mergePatternResults, pickStrategy, prepareSessionBatches, prepareSessionData } from "../../src/analyzer/chunker.js";
import type { ExtractedProject, ExtractedSession } from "../../src/types.js";

function makeSession(id: string): ExtractedSession {
  return {
    source: "claude-code",
    sessionId: id,
    project: { encodedDir: "x", decodedPath: "/x", name: "x", source: "claude-code" },
    cwd: "/x",
    gitBranch: null,
    model: "claude-sonnet-4-6",
    startTime: "2026-04-01T00:00:00Z",
    endTime: "2026-04-01T01:00:00Z",
    totalTurns: 5,
    userTurns: 2,
    tokens: { input_tokens: 100, output_tokens: 50 },
    toolStats: { Read: 3, Bash: 1 },
    errors: [],
    messages: [
      { role: "user", timestamp: "t", text: "hello world" },
      { role: "assistant", timestamp: "t", text: "Hi there. " + "x".repeat(500) },
    ],
    filesModified: ["/x/foo.ts"],
  };
}

function makeProject(count: number): ExtractedProject {
  const sessions = Array.from({ length: count }, (_, i) => makeSession(`s${i}`));
  return {
    project: sessions[0].project,
    instructionsFiles: [],
    skills: [],
    languages: ["TypeScript"],
    peakHours: new Array(24).fill(0),
    aggregateTokens: { input_tokens: 0, output_tokens: 0 },
    sessionCount: count,
    sessions,
  };
}

describe("chunker", () => {
  it("picks full strategy under 9", () => {
    expect(pickStrategy(5)).toBe("full");
    expect(pickStrategy(8)).toBe("full");
  });
  it("picks hybrid 9-30", () => {
    expect(pickStrategy(9)).toBe("hybrid");
    expect(pickStrategy(30)).toBe("hybrid");
  });
  it("picks summary 31+", () => {
    expect(pickStrategy(31)).toBe("summary");
    expect(pickStrategy(500)).toBe("summary");
  });
  it("full keeps message text", () => {
    const { data: json } = prepareSessionData(makeProject(5));
    expect(json).toContain("hello world");
  });
  it("hybrid trims assistant snippets to ~200 chars", () => {
    const { data: json } = prepareSessionData(makeProject(20));
    expect(json).toContain("hello world");
    const parsed = JSON.parse(json);
    expect(parsed[0].assistantSnippets[0].length).toBeLessThanOrEqual(200);
  });
  it("summary drops messages but keeps prompts", () => {
    const { data: json } = prepareSessionData(makeProject(60));
    expect(json).toContain("hello world");
    const parsed = JSON.parse(json);
    expect(parsed[0].userPrompts).toBeTruthy();
    expect(parsed[0].messages).toBeUndefined();
  });
});

describe("prepareSessionBatches", () => {
  it("returns one batch when sessions ≤ batch size", () => {
    const { batches } = prepareSessionBatches(makeProject(40), 100);
    expect(batches).toHaveLength(1);
  });
  it("splits into N batches above threshold", () => {
    const { batches } = prepareSessionBatches(makeProject(250), 100);
    expect(batches).toHaveLength(3);
    expect(JSON.parse(batches[0])).toHaveLength(100);
    expect(JSON.parse(batches[2])).toHaveLength(50);
  });
  it("each batch is independently parseable JSON", () => {
    const { batches } = prepareSessionBatches(makeProject(150), 50);
    for (const b of batches) expect(() => JSON.parse(b)).not.toThrow();
  });
});

describe("mergePatternResults", () => {
  const make = (description: string, occ: number, sids: string[], confidence = "high") => ({
    category: "tool_preference",
    description,
    occurrences: occ,
    sessionIds: sids,
    quotes: sids.map((id) => ({ sessionId: id, text: "x" })),
    confidence,
  });

  it("dedupes by category + normalized description", () => {
    const merged = mergePatternResults([
      { patterns: [make("Always use msw for HTTP mocks", 5, ["a", "b"])] },
      { patterns: [make("ALWAYS USE MSW FOR HTTP MOCKS", 3, ["b", "c"])] },
    ]);
    expect(merged.patterns).toHaveLength(1);
    expect(merged.patterns[0].occurrences).toBe(8);
    expect(merged.patterns[0].sessionIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("upgrades confidence to the highest seen", () => {
    const merged = mergePatternResults([
      { patterns: [make("Run tsc before commit", 3, ["a"], "low")] },
      { patterns: [make("Run tsc before commit", 5, ["b"], "high")] },
    ]);
    expect(merged.patterns[0].confidence).toBe("high");
  });

  it("keeps distinct patterns separate", () => {
    const merged = mergePatternResults([
      { patterns: [make("Use msw", 5, ["a"])] },
      { patterns: [make("Use vitest", 5, ["b"])] },
    ]);
    expect(merged.patterns).toHaveLength(2);
  });

  it("concatenates session summaries across batches", () => {
    const merged = mergePatternResults([
      { sessionSummaries: [{ sessionId: "a", taskType: "test", outcome: "achieved" }] },
      { sessionSummaries: [{ sessionId: "b", taskType: "feature", outcome: "achieved" }] },
    ]);
    expect(merged.sessionSummaries).toHaveLength(2);
  });
});
