import { describe, expect, it } from "vitest";
import { ensureTrailingNewline, findSectionIndex, parseMarkdown, renderMarkdown } from "../../src/apply/parser.js";

describe("markdown parser", () => {
  it("parses preamble + sections", () => {
    const md = "intro line\n\n## A\nbody A\n\n## B\nbody B\n";
    const sections = parseMarkdown(md);
    expect(sections[0].level).toBe(0);
    expect(sections[0].content).toContain("intro line");
    expect(sections.find((s) => s.heading === "## A")?.content).toContain("body A");
    expect(sections.find((s) => s.heading === "## B")?.content).toContain("body B");
  });

  it("renders back to similar shape", () => {
    const md = "## A\nbody A\n\n## B\nbody B\n";
    const sections = parseMarkdown(md);
    const rendered = renderMarkdown(sections);
    expect(rendered).toContain("## A");
    expect(rendered).toContain("body A");
    expect(rendered).toContain("## B");
    expect(rendered).toContain("body B");
  });

  it("findSectionIndex is heading-text case-insensitive", () => {
    const sections = parseMarkdown("## Bug Fixing\nrules\n");
    expect(findSectionIndex(sections, "## bug fixing")).toBeGreaterThanOrEqual(0);
    expect(findSectionIndex(sections, "Bug Fixing")).toBeGreaterThanOrEqual(0);
    expect(findSectionIndex(sections, "Nope")).toBe(-1);
  });

  it("handles empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
  });

  it("preserves blank line between heading and first paragraph (regression #2)", () => {
    const md = "## Project Overview\n\nVoiceStream is a thing.\n\n## Next\nbody\n";
    const sections = parseMarkdown(md);
    const rendered = renderMarkdown(sections);
    expect(rendered).toContain("## Project Overview\n\nVoiceStream is a thing.");
    expect(rendered).toContain("## Next\nbody");
  });

  it("renderMarkdown roundtrips multi-section content byte-identical (modulo trailing newline)", () => {
    const md = "preamble line\n\n## A\nbody A\n\n## B\nbody B\n";
    const out = renderMarkdown(parseMarkdown(md));
    expect(out.trimEnd()).toBe(md.trimEnd());
  });

  it("ensureTrailingNewline adds exactly one trailing newline (regression #4)", () => {
    expect(ensureTrailingNewline("foo")).toBe("foo\n");
    expect(ensureTrailingNewline("foo\n")).toBe("foo\n");
    expect(ensureTrailingNewline("foo\n\n")).toBe("foo\n\n");
    expect(ensureTrailingNewline("")).toBe("\n");
  });
});
