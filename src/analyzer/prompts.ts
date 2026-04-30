export const SYSTEM_PROMPT = `You are cc-analyst, a developer-workflow analyst.
You analyze Claude Code and Codex CLI session logs and produce structured, evidence-based recommendations.

EVIDENCE STANDARDS
- Every recommendation cites specific session IDs and an occurrence count.
- Minimum threshold: 3 occurrences across 2+ sessions to recommend.
- Confidence: high (5+ sessions, explicit user statement) | medium (3-4 sessions, inferred) | low (2 sessions, indirect signals).

RULE QUALITY (for instructions-file rules — CLAUDE.md or AGENTS.md)
- Specific, actionable, scoped, imperative mood.
- Include trigger words: "When...", "Before...", "For...".
- Bad: "Be careful with errors". Good: "When fixing errors, identify the error type before adding handlers; do not wrap unrelated code in try/catch."

SKILL QUALITY
- Clear trigger phrase, 3+ ordered steps, observed across 3+ sessions, refined over time.

OUTPUT FORMAT
- Strict JSON, no markdown fences, no commentary outside the schema.
- If a field is empty, return [] or null — never omit required fields.`;

export function patternsPrompt(sessionData: string, projectName: string, source: string): string {
  return `Analyze ${source} sessions for project "${projectName}".

For each pattern category below, scan the sessions and report all matches with evidence.

Categories:
- repeated_instruction: same directive across sessions ("always X", "don't Y")
- correction: user corrects assistant output ("no, I meant...", "not like that")
- tool_preference: consistent tool choices (e.g., always Read before Edit, prefer Grep)
- workflow: multi-step recurring process
- error_pattern: recurring failure or workaround
- style_preference: code/communication style preferences

For each pattern include:
- category
- description (short)
- occurrences (count)
- sessionIds (array of session IDs)
- quotes (array, each {sessionId, text} max 200 chars)
- suggestedRule (string|null) — imperative-mood rule if applicable
- suggestedSkill (string|null) — skill name if it qualifies as a workflow
- scope: "global" | "project"
- confidence: "high" | "medium" | "low"

Also produce sessionSummaries: array of {sessionId, taskType, outcome} where:
- taskType: bug_fix | feature | refactor | test | config | debug | review | other
- outcome: achieved | partial | abandoned | unclear

Sessions data (JSON):
${sessionData}

Return JSON: {patterns: [...], sessionSummaries: [...]}`;
}

export function instructionsPrompt(
  patternsJson: string,
  currentInstructions: string | null,
  fileKind: "CLAUDE.md" | "AGENTS.md",
  targetPath: string,
  projectName: string,
  scope: "global" | "project",
): string {
  return `Produce a precise patch for ${fileKind} (${scope} scope) at ${targetPath} based on the patterns below.

Current ${fileKind} content:
${currentInstructions ? `<<<\n${currentInstructions}\n>>>` : "(file does not exist — recommend creating it if patterns warrant)"}

Patterns (JSON):
${patternsJson}

For each pattern:
- already covered → list in noChangeNeeded with the section heading
- partially covered → propose a modification (current vs proposed)
- contradicted by behavior → propose a removal with reason
- not covered → propose an addition under an appropriate section heading

Constraints:
- Reuse existing section headings when possible.
- Rules MUST be imperative mood with a trigger word.
- Modifications include both currentRule and proposedRule.
- Each addition has insertAfter (a section heading or null for append).

Return JSON matching this schema:
{
  "targetFile": "${targetPath}",
  "fileKind": "${fileKind}",
  "additions": [{"section": "## ...", "rule": "...", "evidence": "...", "confidence": "high|medium|low", "scope": "${scope}", "insertAfter": "## ..."|null}],
  "modifications": [{"section": "## ...", "currentRule": "...", "proposedRule": "...", "reason": "...", "evidence": "...", "confidence": "high|medium|low"}],
  "removals": [{"section": "## ...", "rule": "...", "reason": "..."}],
  "noChangeNeeded": ["## section heading", ...]
}

Project: "${projectName}". Output JSON only, no markdown fencing.`;
}

export function skillsPrompt(
  patternsJson: string,
  sessionData: string,
  existingSkills: { filename: string; content: string | null }[],
  projectName: string,
  scope: "global" | "project",
): string {
  const existingBlock = existingSkills.length
    ? existingSkills.map((s) => `--- ${s.filename} ---\n${s.content?.slice(0, 1000) ?? "(empty)"}`).join("\n\n")
    : "(none)";

  return `Detect reusable skills (workflows) from these patterns and sessions for project "${projectName}".

Skill qualification criteria (ALL must hold):
- 3+ sessions with consistent structure
- 3+ ordered steps
- Refinements observed over time (user correcting or clarifying)
- Would save repeated explanation in future sessions

Existing skill files (do NOT duplicate; propose update if overlap):
${existingBlock}

Patterns (JSON):
${patternsJson}

Sessions (JSON):
${sessionData}

For each qualified skill, produce a recommendation with action "create" or "update".
- filename: kebab-case + ".md"
- title: short imperative
- description: one sentence
- content: full SKILL.md including YAML frontmatter (name, description) plus sections (When to use, Steps, Notes)
- evidence: which sessions and what behavior justified this
- triggerConditions: phrases that should activate this skill
- toolSequence: expected tool order
- stepCount: integer
- scope: "${scope}"

Return JSON: {"skills": [...]}. Output JSON only, no markdown fencing.`;
}

export function feedbackPrompt(
  allSessionsSummary: string,
  patternsJson: string,
  statsJson: string,
  scopeLabel: string,
): string {
  return `Provide a developer-coaching feedback report for ${scopeLabel}.

All sessions (compact summary):
${allSessionsSummary}

All patterns (across projects):
${patternsJson}

Computed stats:
${statsJson}

BEFORE coaching, screen the dataset:
- Count sessions whose first user prompt is identical (or near-identical) to another session's first prompt.
- If >60% of sessions share <=3 distinct first-prompt strings, this dataset is dominated by automated/synthetic traffic (smoke tests, canary probes, evaluation runs). In that case:
  - State this prominently in workStyle as the FIRST sentence ("This dataset is dominated by automated/synthetic traffic — N of M sessions are identical probes; coaching is restricted to the organic subset.").
  - Limit prescriptive coaching items (strengths/improvements/etc.) to the ORGANIC sessions only.
  - Add ONE improvement item titled "Filter synthetic traffic before analysis" with concrete suggestion: "Re-run cc-analyst with --min-sessions to exclude probe-dominated runs, or tag canary prompts with a reserved prefix the analyzer can exclude."

Evaluate six dimensions on the ORGANIC subset (or full set if no synthetic dominance):
1. Prompting quality (first-prompt length, clarification rate)
2. Tool usage (errors, diversity, tool-choice accuracy)
3. Context management (turns/session, cache hit ratio)
4. Iteration efficiency (turns to completion by task type)
5. Session organization (naming, context-switching, peak hours)
6. Error recovery (recovery speed, repeated errors)

Return JSON:
{
  "workStyle": "2-3 sentence narrative",
  "strengths": [{title, observation, suggestion, examples?, impact}],
  "improvements": [{...}],
  "toolUsageInsights": [...],
  "contextManagement": [...],
  "promptingPatterns": [...],
  "quickWins": [...]
}

Each item: title, observation (with metrics), suggestion (concrete), impact ("high"|"medium"|"low"). Output JSON only.`;
}

export function crossProjectPrompt(perProjectReports: string, globalInstructionsPath: string): string {
  return `Cross-project analysis. Each report below summarizes patterns + recommendations for one project.

Reports:
${perProjectReports}

Global instructions file path: ${globalInstructionsPath}

Identify:
1. Shared patterns appearing in 3+ projects → recommend promoting to global instructions
2. Divergences (same task done differently across projects) — classify as intentional or inconsistency
3. Cross-project skills (workflows that recur across codebases)
4. Comparative insights (which project is most/least efficient and why)

Return JSON:
{
  "sharedPatterns": [{rule, projects, evidence, confidence}],
  "divergences": [{taskType, byProject, classification, recommendation}],
  "globalSkills": [{filename, title, description, content, evidence}],
  "comparativeInsights": [{title, observation, suggestion, impact}]
}

Output JSON only.`;
}
