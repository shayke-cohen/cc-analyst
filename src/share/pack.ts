import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { AnalysisOutput } from "../analyzer/index.js";
import type { InsightPack, SharedRule, SharedSkill } from "./types.js";

export interface BuildPackInput {
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  license?: string;
  analysis: AnalysisOutput;
  toolVersion: string;
  minConfidence?: "high" | "medium" | "low";
}

const RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

export function buildPack(input: BuildPackInput): InsightPack {
  const min = RANK[input.minConfidence ?? "medium"];
  const rules: SharedRule[] = [];
  const skills: SharedSkill[] = [];
  const sources = new Set<string>();
  const confDist: Record<string, number> = { high: 0, medium: 0, low: 0 };

  for (const proj of input.analysis.perProject) {
    sources.add(proj.source);
    if (proj.instructionsPatch) {
      for (const a of proj.instructionsPatch.additions ?? []) {
        if (RANK[a.confidence] < min) continue;
        confDist[a.confidence] = (confDist[a.confidence] ?? 0) + 1;
        rules.push({
          id: randomUUID(),
          section: a.section,
          rule: a.rule,
          rationale: a.evidence,
          confidence: a.confidence,
          tags: input.tags ?? [],
          fileKind: proj.instructionsPatch.fileKind,
        });
      }
    }
    for (const s of proj.skills) {
      skills.push({
        filename: s.filename,
        title: s.title,
        description: s.description,
        content: s.content,
        tags: input.tags ?? [],
      });
    }
  }

  return {
    id: randomUUID(),
    version: "1.0.0",
    name: input.name,
    description: input.description ?? "",
    author: input.author,
    createdAt: new Date().toISOString(),
    tags: input.tags ?? [],
    license: input.license ?? "MIT",
    rules,
    skills,
    provenance: {
      derivedFromSessions: input.analysis.perProject.reduce((n, p) => n + (p.patterns?.sessionSummaries?.length ?? 0), 0),
      derivedFromProjects: input.analysis.perProject.length,
      toolVersion: input.toolVersion,
      confidenceDistribution: confDist,
      sources: [...sources],
    },
  };
}

export function writePack(path: string, pack: InsightPack) {
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function readPack(path: string): InsightPack {
  return JSON.parse(readFileSync(path, "utf8"));
}
