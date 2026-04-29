export type Source = "claude-code" | "codex";
export type EngineName = "claude-code" | "codex";

export interface ProjectRef {
  encodedDir: string;
  decodedPath: string;
  name: string;
  gitRemote?: string;
  currentBranch?: string;
  source: Source;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ToolCall {
  tool: string;
  input?: unknown;
  id?: string;
}

export interface ErrorEntry {
  sessionId: string;
  turnIndex: number;
  tool?: string;
  message: string;
}

export interface NormalizedMessage {
  role: "user" | "assistant" | "system";
  timestamp: string;
  text?: string;
  toolCalls?: ToolCall[];
  toolResults?: { tool_use_id: string; isError?: boolean; preview?: string }[];
  thinking?: string;
}

export interface ExtractedSession {
  source: Source;
  sessionId: string;
  project: ProjectRef;
  cwd: string;
  gitBranch: string | null;
  model: string | null;
  startTime: string;
  endTime: string;
  totalTurns: number;
  userTurns: number;
  tokens: TokenUsage;
  toolStats: Record<string, number>;
  errors: ErrorEntry[];
  messages: NormalizedMessage[];
  filesModified: string[];
}

export interface SkillFile {
  filename: string;
  path: string;
  scope: "global" | "project";
  content: string | null;
}

export interface InstructionsFile {
  kind: "CLAUDE.md" | "AGENTS.md";
  path: string;
  scope: "global" | "project";
  content: string | null;
  exists: boolean;
}

export interface ExtractedProject {
  project: ProjectRef;
  instructionsFiles: InstructionsFile[];
  skills: SkillFile[];
  languages: string[];
  peakHours: number[];
  aggregateTokens: TokenUsage;
  sessionCount: number;
  sessions: ExtractedSession[];
}

export interface ExtractOptions {
  source: Source | "all";
  days?: number;
  projectFilter?: string;
  includeSkills?: boolean;
  includeInstructions?: boolean;
}

export interface ClaudeMdRule {
  section: string;
  rule: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
  scope: "global" | "project";
  sourceProjects?: string[];
  insertAfter?: string;
}

export interface ClaudeMdModification {
  section: string;
  currentRule: string;
  proposedRule: string;
  reason: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
}

export interface ClaudeMdRemoval {
  section: string;
  rule: string;
  reason: string;
}

export interface InstructionsPatch {
  targetFile: string;
  fileKind: "CLAUDE.md" | "AGENTS.md";
  currentContent: string | null;
  additions: ClaudeMdRule[];
  modifications: ClaudeMdModification[];
  removals: ClaudeMdRemoval[];
  noChangeNeeded?: string[];
}

export interface SkillRecommendation {
  action: "create" | "update";
  filename: string;
  title: string;
  description: string;
  content: string;
  evidence: string;
  scope: "global" | "project";
  targetDir: string;
  currentContent?: string;
  triggerConditions?: string[];
  toolSequence?: string[];
  stepCount?: number;
}

export interface FeedbackItem {
  title: string;
  observation: string;
  suggestion: string;
  examples?: string[];
  impact: "high" | "medium" | "low";
}

export interface FeedbackReport {
  workStyle: string;
  strengths: FeedbackItem[];
  improvements: FeedbackItem[];
  toolUsageInsights: FeedbackItem[];
  contextManagement: FeedbackItem[];
  promptingPatterns: FeedbackItem[];
  quickWins?: FeedbackItem[];
}

export interface UsageStats {
  totalTokens: { input: number; output: number };
  totalSessions: number;
  avgSessionLength: number;
  avgTokensPerSession: number;
  topTools: [string, number][];
  topProjects: [string, number][];
  errorRate: number;
  peakHours: number[];
  languageDistribution: Record<string, number>;
}

export interface AnalysisReport {
  generatedAt: string;
  sessionRange: { from: string; to: string };
  sessionCount: number;
  scope: "global" | "project";
  source: Source;
  engine: EngineName;
  projectRef?: ProjectRef;
  instructionsPatch?: InstructionsPatch;
  skills: SkillRecommendation[];
  feedback?: FeedbackReport;
  stats: UsageStats;
}
