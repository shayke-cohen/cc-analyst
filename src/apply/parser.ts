export interface MarkdownSection {
  heading: string;
  level: number;
  content: string;
  startLine: number;
  endLine: number;
}

export function parseMarkdown(content: string): MarkdownSection[] {
  if (!content) return [];
  const lines = content.split("\n");
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { heading: "", level: 0, content: "", startLine: 0, endLine: 0 };
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/;

  lines.forEach((line, idx) => {
    const m = headingRe.exec(line);
    if (m) {
      current.endLine = idx - 1;
      sections.push(current);
      current = {
        heading: line,
        level: m[1].length,
        content: "",
        startLine: idx,
        endLine: idx,
      };
    } else {
      current.content += (current.content ? "\n" : "") + line;
    }
  });
  current.endLine = lines.length - 1;
  sections.push(current);

  return sections;
}

export function renderMarkdown(sections: MarkdownSection[]): string {
  const parts: string[] = [];
  for (const s of sections) {
    if (s.heading) parts.push(s.heading);
    if (s.content) parts.push(s.content);
  }
  return parts.join("\n");
}

export function findSectionIndex(sections: MarkdownSection[], heading: string): number {
  const norm = heading.replace(/^#+\s*/, "").trim().toLowerCase();
  return sections.findIndex((s) => s.heading.replace(/^#+\s*/, "").trim().toLowerCase() === norm);
}
