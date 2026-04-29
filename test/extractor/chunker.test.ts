import { describe, expect, it } from "vitest";
import { pickStrategy, prepareSessionData } from "../../src/analyzer/chunker.js";
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
  it("picks full strategy under 20", () => {
    expect(pickStrategy(5)).toBe("full");
    expect(pickStrategy(20)).toBe("full");
  });
  it("picks hybrid 21-50", () => {
    expect(pickStrategy(21)).toBe("hybrid");
    expect(pickStrategy(50)).toBe("hybrid");
  });
  it("picks summary 51+", () => {
    expect(pickStrategy(51)).toBe("summary");
    expect(pickStrategy(500)).toBe("summary");
  });
  it("full keeps message text", () => {
    const json = prepareSessionData(makeProject(5));
    expect(json).toContain("hello world");
  });
  it("hybrid trims assistant snippets to ~200 chars", () => {
    const json = prepareSessionData(makeProject(30));
    expect(json).toContain("hello world");
    const parsed = JSON.parse(json);
    expect(parsed[0].assistantSnippets[0].length).toBeLessThanOrEqual(200);
  });
  it("summary drops messages but keeps prompts", () => {
    const json = prepareSessionData(makeProject(60));
    expect(json).toContain("hello world");
    const parsed = JSON.parse(json);
    expect(parsed[0].userPrompts).toBeTruthy();
    expect(parsed[0].messages).toBeUndefined();
  });
});
