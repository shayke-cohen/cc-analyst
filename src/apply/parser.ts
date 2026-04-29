export interface MarkdownSection {
  heading: string;
  level: number;
  content: string;
  startLine: number;
  endLine: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

export function parseMarkdown(content: string): MarkdownSection[] {
  if (!content) return [];
  const lines = content.split("\n");
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { heading: "", level: 0, content: "", startLine: 0, endLine: 0 };
  let buffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = HEADING_RE.exec(line);
    if (m) {
      current.endLine = i - 1;
      current.content = buffer.join("\n");
      sections.push(current);
      current = { heading: line, level: m[1].length, content: "", startLine: i, endLine: i };
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  current.endLine = lines.length - 1;
  current.content = buffer.join("\n");
  sections.push(current);

  return sections;
}

export function renderMarkdown(sections: MarkdownSection[]): string {
  const parts: string[] = [];
  for (const s of sections) {
    if (s.heading) parts.push(s.heading);
    if (s.content !== "") parts.push(s.content);
  }
  return parts.join("\n");
}

export function findSectionIndex(sections: MarkdownSection[], heading: string): number {
  const norm = heading.replace(/^#+\s*/, "").trim().toLowerCase();
  return sections.findIndex((s) => s.heading.replace(/^#+\s*/, "").trim().toLowerCase() === norm);
}

export function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : s + "\n";
}
