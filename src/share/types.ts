export interface InsightPack {
  id: string;
  version: string;
  name: string;
  description: string;
  author?: string;
  createdAt: string;
  tags: string[];
  license: string;
  rules: SharedRule[];
  skills: SharedSkill[];
  provenance: {
    derivedFromSessions: number;
    derivedFromProjects: number;
    toolVersion: string;
    confidenceDistribution: Record<string, number>;
    sources: string[];
  };
  compatibility?: {
    targetStack?: string[];
    claudeCodeMinVersion?: string;
    codexMinVersion?: string;
  };
}

export interface SharedRule {
  id: string;
  section: string;
  rule: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
  tags: string[];
  fileKind?: "CLAUDE.md" | "AGENTS.md" | "either";
}

export interface SharedSkill {
  filename: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
}

export interface AnonymizeReport {
  stagesApplied: string[];
  redactionCount: Record<string, number>;
  flaggedForManualReview: { kind: string; sample: string }[];
}

export type MergeStrategy = "union" | "replace" | "interactive" | "theirs" | "ours";
