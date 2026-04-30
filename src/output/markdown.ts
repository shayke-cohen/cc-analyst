import type { AnalysisOutput, ProjectAnalysis } from "../analyzer/index.js";
import type { AnalysisReport, FeedbackItem, FeedbackReport, UsageStats } from "../types.js";
import { applyOps, patchToOps } from "../apply/patch.js";
import { unifiedDiff } from "../apply/diff.js";

const CONFIDENCE_BADGE: Record<string, string> = {
  high: "🟢 high",
  medium: "🟡 medium",
  low: "⚪ low",
};

const IMPACT_BADGE: Record<string, string> = {
  high: "🔴 high",
  medium: "🟠 medium",
  low: "⚪ low",
};

function escape(text: string): string {
  return (text ?? "").replace(/\|/g, "\\|");
}

function badge(level?: string): string {
  return level ? CONFIDENCE_BADGE[level] ?? level : "—";
}

export function renderProjectReport(report: AnalysisReport, analysis: ProjectAnalysis): string {
  const lines: string[] = [];
  const project = report.projectRef!;
  lines.push(`# ${project.name}`);
  lines.push("");
  lines.push(`> ${project.decodedPath}`);
  lines.push("");
  lines.push(`| | |`);
  lines.push(`| --- | --- |`);
  lines.push(`| **Source** | \`${report.source}\` |`);
  lines.push(`| **Engine** | \`${report.engine}\` |`);
  lines.push(`| **Sessions** | ${report.sessionCount} |`);
  lines.push(`| **Range** | ${report.sessionRange.from || "—"} → ${report.sessionRange.to || "—"} |`);
  lines.push(`| **Generated** | ${report.generatedAt} |`);
  lines.push("");

  const patterns = analysis.patterns?.patterns ?? [];
  lines.push(`## Patterns (${patterns.length})`);
  lines.push("");
  if (patterns.length === 0) {
    lines.push("_No patterns met the evidence threshold (≥3 occurrences across 2+ sessions)._");
    lines.push("");
  } else {
    for (const p of patterns) {
      lines.push(`### ${p.category} · ×${p.occurrences} · ${badge(p.confidence)}`);
      lines.push("");
      lines.push(p.description);
      lines.push("");
      if (p.suggestedRule) {
        lines.push(`**Suggested rule:** ${p.suggestedRule}`);
        lines.push("");
      }
      if (Array.isArray(p.quotes) && p.quotes.length) {
        lines.push("**Quotes:**");
        for (const q of p.quotes.slice(0, 4)) {
          const text = (q.text ?? "").replace(/\n/g, " ");
          lines.push(`- _${text.length > 200 ? text.slice(0, 200) + "…" : text}_ — \`${q.sessionId?.slice(0, 8) ?? "?"}\``);
        }
        lines.push("");
      }
    }
  }

  const patch = analysis.instructionsPatch;
  if (patch) {
    lines.push(`## ${patch.fileKind} patch`);
    lines.push("");
    lines.push(`Target: \`${patch.targetFile}\``);
    lines.push("");
    lines.push(`| Op | Section | Confidence |`);
    lines.push(`| --- | --- | --- |`);
    for (const a of patch.additions ?? []) lines.push(`| add | ${escape(a.section)} | ${badge(a.confidence)} |`);
    for (const m of patch.modifications ?? []) lines.push(`| modify | ${escape(m.section)} | ${badge(m.confidence)} |`);
    for (const r of patch.removals ?? []) lines.push(`| remove | ${escape(r.section)} | — |`);
    lines.push("");

    if ((patch.additions?.length ?? 0) > 0) {
      lines.push("### Additions");
      lines.push("");
      for (const a of patch.additions ?? []) {
        lines.push(`#### ${a.section}  ·  ${badge(a.confidence)}`);
        lines.push("");
        lines.push(`> ${a.rule.replace(/\n/g, "\n> ")}`);
        lines.push("");
        if (a.evidence) {
          lines.push(`Evidence: ${a.evidence}`);
          lines.push("");
        }
      }
    }

    if ((patch.modifications?.length ?? 0) > 0) {
      lines.push("### Modifications");
      lines.push("");
      for (const m of patch.modifications ?? []) {
        lines.push(`#### ${m.section}  ·  ${badge(m.confidence)}`);
        lines.push("");
        lines.push("```diff");
        lines.push(`- ${m.currentRule}`);
        lines.push(`+ ${m.proposedRule}`);
        lines.push("```");
        lines.push("");
        if (m.reason) lines.push(`_Reason: ${m.reason}_`);
        if (m.evidence) lines.push(`_Evidence: ${m.evidence}_`);
        lines.push("");
      }
    }

    const original = patch.currentContent ?? "";
    const ops = patchToOps(patch);
    if (ops.length > 0) {
      const result = applyOps(original, ops);
      const diff = unifiedDiff(patch.targetFile, original, result.patched);
      lines.push("### Unified diff");
      lines.push("");
      lines.push("```diff");
      lines.push(diff || "(no textual change)");
      lines.push("```");
      lines.push("");
    }
  }

  const skills = analysis.skills ?? [];
  if (skills.length > 0) {
    lines.push(`## Skills (${skills.length})`);
    lines.push("");
    for (const s of skills) {
      lines.push(`### ${s.action ?? "create"} · \`${s.filename}\``);
      lines.push("");
      lines.push(`**${s.title}** — ${s.description}`);
      lines.push("");
      if (s.evidence) {
        lines.push(`_Evidence: ${s.evidence}_`);
        lines.push("");
      }
      lines.push("<details><summary>Skill content</summary>");
      lines.push("");
      lines.push("```markdown");
      lines.push(s.content);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}

function renderFeedbackSection(title: string, items: FeedbackItem[]): string[] {
  if (!items?.length) return [];
  const lines: string[] = [];
  lines.push(`## ${title}`);
  lines.push("");
  for (const i of items) {
    lines.push(`### ${i.title}  ·  ${IMPACT_BADGE[i.impact] ?? i.impact}`);
    lines.push("");
    lines.push(`**Observation:** ${i.observation}`);
    lines.push("");
    lines.push(`**Suggestion:** ${i.suggestion}`);
    lines.push("");
    if (i.examples?.length) {
      lines.push("Examples:");
      for (const ex of i.examples) lines.push(`- ${ex}`);
      lines.push("");
    }
  }
  return lines;
}

export function renderFeedback(feedback: FeedbackReport): string {
  const lines: string[] = [];
  lines.push("# Feedback");
  lines.push("");
  if (feedback.workStyle) {
    lines.push("## Work style");
    lines.push("");
    lines.push(feedback.workStyle);
    lines.push("");
  }
  lines.push(...renderFeedbackSection("Strengths", feedback.strengths ?? []));
  lines.push(...renderFeedbackSection("Improvements", feedback.improvements ?? []));
  lines.push(...renderFeedbackSection("Quick wins", feedback.quickWins ?? []));
  lines.push(...renderFeedbackSection("Tool usage insights", feedback.toolUsageInsights ?? []));
  lines.push(...renderFeedbackSection("Context management", feedback.contextManagement ?? []));
  lines.push(...renderFeedbackSection("Prompting patterns", feedback.promptingPatterns ?? []));
  return lines.join("\n") + "\n";
}

export function renderStats(stats: UsageStats): string {
  const lines: string[] = [];
  lines.push("# Stats");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total sessions | ${stats.totalSessions} |`);
  lines.push(`| Avg session length (turns) | ${stats.avgSessionLength.toFixed(1)} |`);
  lines.push(`| Avg tokens / session | ${Math.round(stats.avgTokensPerSession).toLocaleString()} |`);
  lines.push(`| Total input tokens | ${stats.totalTokens.input.toLocaleString()} |`);
  lines.push(`| Total output tokens | ${stats.totalTokens.output.toLocaleString()} |`);
  lines.push(`| Error rate | ${(stats.errorRate * 100).toFixed(2)}% |`);
  lines.push("");

  if (stats.topTools.length) {
    lines.push("## Top tools");
    lines.push("");
    lines.push(`| Tool | Calls |`);
    lines.push(`| --- | --- |`);
    for (const [tool, n] of stats.topTools) lines.push(`| \`${tool}\` | ${n} |`);
    lines.push("");
  }

  if (stats.topProjects.length) {
    lines.push("## Top projects");
    lines.push("");
    lines.push(`| Project | Sessions |`);
    lines.push(`| --- | --- |`);
    for (const [name, n] of stats.topProjects) lines.push(`| ${escape(name)} | ${n} |`);
    lines.push("");
  }

  const langs = Object.entries(stats.languageDistribution).sort((a, b) => b[1] - a[1]);
  if (langs.length) {
    lines.push("## Languages");
    lines.push("");
    lines.push(`| Language | Projects |`);
    lines.push(`| --- | --- |`);
    for (const [lang, n] of langs) lines.push(`| ${lang} | ${n} |`);
    lines.push("");
  }

  if (stats.peakHours.some((h) => h > 0)) {
    const max = Math.max(...stats.peakHours);
    lines.push("## Peak hours (sessions started, local time)");
    lines.push("");
    lines.push("```text");
    for (let h = 0; h < 24; h++) {
      const bar = "█".repeat(Math.round((stats.peakHours[h] / max) * 30));
      lines.push(`${String(h).padStart(2, "0")}  ${bar} ${stats.peakHours[h]}`);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

export function renderCrossProject(crossProject: any): string {
  const lines: string[] = [];
  lines.push("# Cross-project analysis");
  lines.push("");

  const shared = crossProject?.sharedPatterns ?? [];
  if (shared.length) {
    lines.push("## Shared patterns");
    lines.push("");
    for (const p of shared) {
      lines.push(`- **${badge(p.confidence)}** \`${(p.projects || []).join(", ")}\` — ${p.rule}`);
      if (p.evidence) lines.push(`  - _${p.evidence}_`);
    }
    lines.push("");
  }

  const div = crossProject?.divergences ?? [];
  if (div.length) {
    lines.push("## Divergences");
    lines.push("");
    for (const d of div) {
      lines.push(`### ${d.taskType ?? "—"} · ${d.classification ?? "—"}`);
      lines.push("");
      if (d.byProject) {
        for (const [project, behavior] of Object.entries(d.byProject)) {
          lines.push(`- **${project}**: ${behavior}`);
        }
        lines.push("");
      }
      if (d.recommendation) lines.push(`**Recommendation:** ${d.recommendation}`);
      lines.push("");
    }
  }

  const skills = crossProject?.globalSkills ?? [];
  if (skills.length) {
    lines.push("## Cross-project skills");
    lines.push("");
    for (const s of skills) {
      lines.push(`- \`${s.filename}\` — **${s.title}**: ${s.description}`);
    }
    lines.push("");
  }

  const insights = crossProject?.comparativeInsights ?? [];
  if (insights.length) {
    lines.push("## Comparative insights");
    lines.push("");
    for (const i of insights) {
      lines.push(`### ${i.title}  ·  ${IMPACT_BADGE[i.impact] ?? i.impact}`);
      lines.push("");
      lines.push(i.observation);
      lines.push("");
      lines.push(`**Suggestion:** ${i.suggestion}`);
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}

export function renderRunIndex(args: {
  output: AnalysisOutput;
  reports: AnalysisReport[];
  generatedAt: string;
  source: string;
  engine: string;
  outputDir: string;
}): string {
  const lines: string[] = [];
  lines.push("# cc-analyst run");
  lines.push("");
  lines.push(`Generated **${args.generatedAt}** · source: \`${args.source}\` · engine: \`${args.engine}\``);
  lines.push("");

  lines.push("## Files");
  lines.push("");
  lines.push("| File | Description |");
  lines.push("| --- | --- |");
  lines.push("| [`analysis.json`](analysis.json) | Full structured pipeline output |");
  if (args.output.feedback) lines.push("| [`feedback.md`](feedback.md) / [`feedback.json`](feedback.json) | Aggregated feedback report |");
  if (args.output.crossProject) lines.push("| [`cross-project.md`](cross-project.md) / [`cross-project.json`](cross-project.json) | Cross-project analysis |");
  if (args.reports.length) lines.push("| [`stats.md`](stats.md) | Usage statistics |");
  lines.push("");

  if (args.reports.length) {
    lines.push("## Projects");
    lines.push("");
    lines.push("| Project | Source | Sessions | Patterns | Patch Δ | Skills |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const r of args.reports) {
      const proj = args.output.perProject.find((p) => p.project.name === r.projectRef?.name);
      const patterns = proj?.patterns?.patterns?.length ?? 0;
      const adds = proj?.instructionsPatch?.additions?.length ?? 0;
      const mods = proj?.instructionsPatch?.modifications?.length ?? 0;
      const skills = proj?.skills?.length ?? 0;
      const link = `[${r.projectRef!.name}](projects/${r.projectRef!.name}/report.md)`;
      lines.push(`| ${link} | \`${r.source}\` | ${r.sessionCount} | ${patterns} | +${adds}/~${mods} | ${skills} |`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
