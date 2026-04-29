import type { InstructionsPatch } from "../types.js";
import { findSectionIndex, parseMarkdown, renderMarkdown, type MarkdownSection } from "./parser.js";

export type PatchOp =
  | { type: "add_section"; heading: string; level: number; content: string; after?: string }
  | { type: "append_to_section"; heading: string; content: string }
  | { type: "replace_in_section"; heading: string; find: string; replace: string }
  | { type: "remove_from_section"; heading: string; find: string };

export interface PatchResult {
  original: string;
  patched: string;
  opsApplied: number;
  opsFailed: PatchOp[];
}

export function patchToOps(patch: InstructionsPatch): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const add of patch.additions ?? []) {
    if (add.section) {
      const heading = add.section.startsWith("#") ? add.section : `## ${add.section}`;
      ops.push({ type: "append_to_section", heading, content: add.rule });
    }
  }
  for (const mod of patch.modifications ?? []) {
    const heading = mod.section.startsWith("#") ? mod.section : `## ${mod.section}`;
    ops.push({ type: "replace_in_section", heading, find: mod.currentRule, replace: mod.proposedRule });
  }
  for (const rem of patch.removals ?? []) {
    const heading = rem.section.startsWith("#") ? rem.section : `## ${rem.section}`;
    ops.push({ type: "remove_from_section", heading, find: rem.rule });
  }
  return ops;
}

export function applyOps(original: string, ops: PatchOp[]): PatchResult {
  let sections = parseMarkdown(original);
  const failed: PatchOp[] = [];
  let applied = 0;

  for (const op of ops) {
    if (op.type === "add_section") {
      const idx = op.after ? findSectionIndex(sections, op.after) : -1;
      const newSection: MarkdownSection = {
        heading: op.heading,
        level: op.level,
        content: op.content,
        startLine: 0, endLine: 0,
      };
      if (idx >= 0) sections.splice(idx + 1, 0, newSection);
      else sections.push(newSection);
      applied++;
    } else if (op.type === "append_to_section") {
      const idx = findSectionIndex(sections, op.heading);
      if (idx >= 0) {
        sections[idx].content = (sections[idx].content ? sections[idx].content + "\n" : "") + "\n- " + op.content;
        applied++;
      } else {
        sections.push({
          heading: op.heading,
          level: 2,
          content: "\n- " + op.content,
          startLine: 0, endLine: 0,
        });
        applied++;
      }
    } else if (op.type === "replace_in_section") {
      const idx = findSectionIndex(sections, op.heading);
      if (idx < 0) { failed.push(op); continue; }
      if (!sections[idx].content.includes(op.find)) { failed.push(op); continue; }
      sections[idx].content = sections[idx].content.replace(op.find, op.replace);
      applied++;
    } else if (op.type === "remove_from_section") {
      const idx = findSectionIndex(sections, op.heading);
      if (idx < 0) { failed.push(op); continue; }
      if (!sections[idx].content.includes(op.find)) { failed.push(op); continue; }
      sections[idx].content = sections[idx].content.replace(op.find, "").replace(/\n{3,}/g, "\n\n");
      applied++;
    }
  }

  return { original, patched: renderMarkdown(sections), opsApplied: applied, opsFailed: failed };
}
