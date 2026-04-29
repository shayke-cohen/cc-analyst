import { describe, expect, it } from "vitest";
import { decodeProjectDir, encodeProjectDir } from "../../src/utils/paths.js";

describe("decodeProjectDir", () => {
  it("decodes a simple absolute path", () => {
    expect(decodeProjectDir("-Users-shayco-AgentDispatcher")).toBe("/Users/shayco/AgentDispatcher");
  });
  it("decodes hidden directories via -- → /. heuristic", () => {
    expect(decodeProjectDir("-Users-shayco--claude-skills")).toBe("/Users/shayco/.claude/skills");
  });
  it("encodeProjectDir is the rough inverse", () => {
    expect(encodeProjectDir("/Users/shayco/foo")).toBe("-Users-shayco-foo");
  });
});
