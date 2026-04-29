import { describe, expect, it } from "vitest";
import { anonymizeText, anonymizePack } from "../../src/share/anonymize.js";
import type { InsightPack } from "../../src/share/types.js";

describe("anonymizeText", () => {
  it("strips home paths", () => {
    const { text, counts } = anonymizeText("Run cd /Users/shayco/code/secret-project");
    expect(text).not.toContain("shayco");
    expect(counts.path).toBeGreaterThan(0);
  });

  it("strips emails", () => {
    const { text, counts } = anonymizeText("contact alice@acme.com for access");
    expect(text).toContain("<email>");
    expect(text).not.toContain("alice@");
    expect(counts.email).toBe(1);
  });

  it("strips URLs preserving rough hostname class", () => {
    const { text, counts } = anonymizeText("see https://internal.acme.corp/foo for details");
    expect(text).toMatch(/<url:[^>]+>/);
    expect(counts.url).toBe(1);
  });

  it("strips session UUIDs and ISO timestamps", () => {
    const { text, counts } = anonymizeText("session 12345678-1234-1234-1234-123456789012 at 2026-04-29T18:00:00.000Z");
    expect(text).toContain("<session>");
    expect(text).toContain("<ts>");
    expect(counts.session_id).toBe(1);
    expect(counts.timestamp).toBe(1);
  });

  it("flags potential api key", () => {
    const { flags } = anonymizeText("token sk-abcdef0123456789ABCDEFG");
    expect(flags.find((f) => f.kind === "possible_api_key")).toBeTruthy();
  });
});

describe("anonymizePack", () => {
  it("anonymizes rule and skill content fields", async () => {
    const pack: InsightPack = {
      id: "p1", version: "1.0.0", name: "n", description: "", createdAt: "",
      tags: [], license: "MIT", rules: [
        { id: "r1", section: "## Acme guidelines", rule: "ping alice@acme.com first", rationale: "see /Users/x/foo.ts", confidence: "high", tags: [] },
      ],
      skills: [
        { filename: "deploy.md", title: "deploy", description: "uses internal.acme.corp", content: "ssh user@10.0.0.1", tags: [] },
      ],
      provenance: { derivedFromSessions: 0, derivedFromProjects: 0, toolVersion: "0", confidenceDistribution: {}, sources: [] },
    };
    const { pack: clean, report } = await anonymizePack(pack);
    expect(clean.rules[0].rule).not.toContain("alice@");
    expect(clean.rules[0].rationale).not.toContain("/Users/x");
    expect(clean.skills[0].content).not.toContain("10.0.0.1");
    expect(report.stagesApplied).toContain("paths");
    expect(report.redactionCount.email).toBeGreaterThan(0);
  });
});
