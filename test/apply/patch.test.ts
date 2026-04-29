import { describe, expect, it } from "vitest";
import { applyOps, patchToOps } from "../../src/apply/patch.js";
import type { InstructionsPatch } from "../../src/types.js";

describe("apply ops", () => {
  it("appends a rule to an existing section", () => {
    const original = "## Tests\n- Run vitest before commit\n";
    const result = applyOps(original, [
      { type: "append_to_section", heading: "## Tests", content: "Mock HTTP with msw" },
    ]);
    expect(result.opsApplied).toBe(1);
    expect(result.patched).toContain("Run vitest before commit");
    expect(result.patched).toContain("Mock HTTP with msw");
  });

  it("creates a missing section when appending", () => {
    const original = "## Tests\n- Run vitest\n";
    const result = applyOps(original, [
      { type: "append_to_section", heading: "## Style", content: "Use TypeScript strict" },
    ]);
    expect(result.opsApplied).toBe(1);
    expect(result.patched).toContain("## Style");
    expect(result.patched).toContain("Use TypeScript strict");
  });

  it("replace fails gracefully when target text missing", () => {
    const original = "## Tests\n- Run vitest\n";
    const result = applyOps(original, [
      { type: "replace_in_section", heading: "## Tests", find: "missing text", replace: "x" },
    ]);
    expect(result.opsApplied).toBe(0);
    expect(result.opsFailed).toHaveLength(1);
  });

  it("replace happy path", () => {
    const original = "## Tests\n- Run vitest\n";
    const result = applyOps(original, [
      { type: "replace_in_section", heading: "## Tests", find: "Run vitest", replace: "Run vitest with coverage" },
    ]);
    expect(result.opsApplied).toBe(1);
    expect(result.patched).toContain("Run vitest with coverage");
  });

  it("appending preserves blank line before next heading (regression #3)", () => {
    const original = "## Safety\n\n### File System\n- existing\n";
    const result = applyOps(original, [
      { type: "append_to_section", heading: "## Safety", content: "Verify backups" },
    ]);
    expect(result.opsApplied).toBe(1);
    // The new bullet should not collide with the next heading
    expect(result.patched).toMatch(/- Verify backups\n\n### File System/);
  });

  it("appending into empty section produces clean blank-line spacing", () => {
    const original = "## Safety\n\n### Sub\n- item\n";
    const result = applyOps(original, [
      { type: "append_to_section", heading: "## Safety", content: "Rule one" },
    ]);
    expect(result.patched).toMatch(/## Safety\n\n- Rule one\n\n### Sub/);
  });

  it("patchToOps maps additions/modifications/removals", () => {
    const patch: InstructionsPatch = {
      targetFile: "/x/CLAUDE.md",
      fileKind: "CLAUDE.md",
      currentContent: "",
      additions: [{ section: "Style", rule: "Use strict", evidence: "...", confidence: "high", scope: "project" }],
      modifications: [{ section: "Tests", currentRule: "Run", proposedRule: "Run all", reason: "", evidence: "", confidence: "medium" }],
      removals: [{ section: "Old", rule: "Drop me", reason: "stale" }],
    };
    const ops = patchToOps(patch);
    expect(ops).toHaveLength(3);
    expect(ops[0].type).toBe("append_to_section");
    expect(ops[1].type).toBe("replace_in_section");
    expect(ops[2].type).toBe("remove_from_section");
  });
});
