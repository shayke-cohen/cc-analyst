import { describe, expect, it } from "vitest";
import { renderCrossProject, renderFeedback, renderProjectReport, renderStats } from "../../src/output/markdown.js";
import type { AnalysisReport, FeedbackReport, UsageStats } from "../../src/types.js";
import type { ProjectAnalysis } from "../../src/analyzer/index.js";

const dummyReport: AnalysisReport = {
  generatedAt: "2026-04-29T20:00:00Z",
  sessionRange: { from: "2026-04-01T00:00:00Z", to: "2026-04-15T00:00:00Z" },
  sessionCount: 5,
  scope: "project",
  source: "claude-code",
  engine: "claude-code",
  projectRef: { encodedDir: "x", decodedPath: "/x", name: "demo", source: "claude-code" },
  skills: [],
  stats: {} as any,
};

const dummyAnalysis: ProjectAnalysis = {
  project: dummyReport.projectRef!,
  source: "claude-code",
  patterns: {
    patterns: [
      {
        category: "tool_preference",
        description: "Always use msw for HTTP mocks",
        occurrences: 5,
        sessionIds: ["abc123", "def456"],
        quotes: [{ sessionId: "abc12345", text: "use msw please" }],
        suggestedRule: "When mocking HTTP, use msw.",
        scope: "project",
        confidence: "high",
      },
    ],
    sessionSummaries: [],
  },
  instructionsPatch: {
    targetFile: "/x/CLAUDE.md",
    fileKind: "CLAUDE.md",
    currentContent: "## Tests\n\n- Run vitest\n",
    additions: [
      { section: "## Tests", rule: "Use msw", evidence: "5 sessions", confidence: "high", scope: "project" },
    ],
    modifications: [],
    removals: [],
  },
  skills: [
    {
      action: "create",
      filename: "scaffold.md",
      title: "Scaffold endpoint",
      description: "Add a new HTTP endpoint",
      content: "---\nname: scaffold\n---\n# Scaffold\n",
      evidence: "3 sessions",
      scope: "project",
      targetDir: "/x/.claude/skills",
    },
  ],
};

describe("renderProjectReport", () => {
  it("renders patterns + patch + diff + skills", () => {
    const md = renderProjectReport(dummyReport, dummyAnalysis);
    expect(md).toContain("# demo");
    expect(md).toContain("## Patterns (1)");
    expect(md).toContain("Always use msw for HTTP mocks");
    expect(md).toContain("🟢 high");
    expect(md).toContain("## CLAUDE.md patch");
    expect(md).toContain("### Unified diff");
    expect(md).toContain("```diff");
    expect(md).toContain("## Skills (1)");
    expect(md).toContain("scaffold.md");
  });

  it("handles empty patterns gracefully", () => {
    const empty = { ...dummyAnalysis, patterns: { patterns: [], sessionSummaries: [] } };
    const md = renderProjectReport(dummyReport, empty);
    expect(md).toContain("No patterns met the evidence threshold");
  });
});

describe("renderFeedback", () => {
  it("renders all sections that have content", () => {
    const fb: FeedbackReport = {
      workStyle: "Terse and effective.",
      strengths: [{ title: "Clear prompts", observation: "obs", suggestion: "sug", impact: "high" }],
      improvements: [{ title: "More tests", observation: "obs", suggestion: "sug", impact: "medium" }],
      toolUsageInsights: [],
      contextManagement: [],
      promptingPatterns: [],
    };
    const md = renderFeedback(fb);
    expect(md).toContain("# Feedback");
    expect(md).toContain("## Work style");
    expect(md).toContain("Terse and effective.");
    expect(md).toContain("## Strengths");
    expect(md).toContain("Clear prompts");
    expect(md).toContain("🔴 high");
    expect(md).toContain("## Improvements");
    expect(md).not.toContain("## Tool usage insights"); // empty section omitted
  });
});

describe("renderStats", () => {
  it("renders metrics table and tool/project lists", () => {
    const stats: UsageStats = {
      totalTokens: { input: 100_000, output: 5_000 },
      totalSessions: 12,
      avgSessionLength: 22.5,
      avgTokensPerSession: 8_750,
      topTools: [["Read", 100], ["Edit", 50]],
      topProjects: [["demo", 10]],
      errorRate: 0.05,
      peakHours: new Array(24).fill(0).map((_, i) => (i === 14 ? 8 : 0)),
      languageDistribution: { TypeScript: 3, Python: 1 },
    };
    const md = renderStats(stats);
    expect(md).toContain("Total sessions | 12");
    expect(md).toContain("`Read` | 100");
    expect(md).toContain("Peak hours");
    expect(md).toContain("TypeScript");
  });
});

describe("renderCrossProject", () => {
  it("renders shared patterns + divergences + skills", () => {
    const cp = {
      sharedPatterns: [{ rule: "Run tests", projects: ["a", "b"], evidence: "x", confidence: "high" }],
      divergences: [{
        taskType: "test", classification: "inconsistency",
        byProject: { a: "uses msw", b: "stubs fetch" },
        recommendation: "standardize on msw",
      }],
      globalSkills: [{ filename: "x.md", title: "X", description: "y" }],
      comparativeInsights: [{ title: "I", observation: "o", suggestion: "s", impact: "medium" }],
    };
    const md = renderCrossProject(cp);
    expect(md).toContain("## Shared patterns");
    expect(md).toContain("Run tests");
    expect(md).toContain("## Divergences");
    expect(md).toContain("standardize on msw");
    expect(md).toContain("## Cross-project skills");
    expect(md).toContain("## Comparative insights");
  });
});
