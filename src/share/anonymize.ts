import type { AnonymizeReport, InsightPack } from "./types.js";
import type { AnalysisEngine } from "../engine/index.js";

const PATH_RE = /\/Users\/[^/\s"']+|\/home\/[^/\s"']+|C:\\Users\\[^\\\s"']+/g;
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/g;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const SESSION_ID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO_TS_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const ABS_FILE_RE = /\/(?:Users|home|var|opt|tmp|private)\/[A-Za-z0-9._/-]+\.[a-zA-Z0-9]{1,6}/g;

export function stripPaths(s: string, counts: Record<string, number>): string {
  return s
    .replace(ABS_FILE_RE, () => { counts.path = (counts.path ?? 0) + 1; return "<file>"; })
    .replace(PATH_RE, () => { counts.path = (counts.path ?? 0) + 1; return "<home>"; });
}

export function stripIdentifiers(s: string, counts: Record<string, number>): string {
  return s
    .replace(EMAIL_RE, () => { counts.email = (counts.email ?? 0) + 1; return "<email>"; })
    .replace(URL_RE, (m) => {
      counts.url = (counts.url ?? 0) + 1;
      try {
        const u = new URL(m);
        return `<url:${u.hostname.split(".").slice(-2).join(".")}>`;
      } catch { return "<url>"; }
    })
    .replace(IP_RE, () => { counts.ip = (counts.ip ?? 0) + 1; return "<ip>"; });
}

export function stripSessionRefs(s: string, counts: Record<string, number>): string {
  return s
    .replace(SESSION_ID_RE, () => { counts.session_id = (counts.session_id ?? 0) + 1; return "<session>"; })
    .replace(ISO_TS_RE, () => { counts.timestamp = (counts.timestamp ?? 0) + 1; return "<ts>"; });
}

const COMPANY_NAME_HINT = /(?:Acme|Wix|MyCorp|Inc|Ltd|LLC|GmbH)/g;

export function generalize(s: string, counts: Record<string, number>): string {
  return s.replace(COMPANY_NAME_HINT, () => { counts.company = (counts.company ?? 0) + 1; return "<org>"; });
}

function flag(text: string): { kind: string; sample: string }[] {
  const flags: { kind: string; sample: string }[] = [];
  if (text.match(/[A-Z][a-z]+[A-Z][a-z]+/) && !text.includes("<")) {
    const sample = text.match(/[A-Z][a-z]+[A-Z][a-z]+/)?.[0];
    if (sample) flags.push({ kind: "possible_camel_case_identifier", sample });
  }
  if (text.match(/\bsk-[A-Za-z0-9]{20,}/)) flags.push({ kind: "possible_api_key", sample: "sk-..." });
  return flags;
}

function applyStages(input: string, counts: Record<string, number>, flags: { kind: string; sample: string }[]): string {
  let s = input;
  s = stripPaths(s, counts);
  s = stripIdentifiers(s, counts);
  s = stripSessionRefs(s, counts);
  s = generalize(s, counts);
  flags.push(...flag(s));
  return s;
}

export function anonymizeText(input: string): { text: string; counts: Record<string, number>; flags: { kind: string; sample: string }[] } {
  const counts: Record<string, number> = {};
  const flags: { kind: string; sample: string }[] = [];
  return { text: applyStages(input, counts, flags), counts, flags };
}

export interface AnonymizeOptions {
  agentReview?: boolean;
  engine?: AnalysisEngine;
}

export async function anonymizePack(pack: InsightPack, opts: AnonymizeOptions = {}): Promise<{ pack: InsightPack; report: AnonymizeReport }> {
  const counts: Record<string, number> = {};
  const flags: { kind: string; sample: string }[] = [];
  const stagesApplied: string[] = ["paths", "identifiers", "session_refs", "generalize"];

  const cleanedRules = pack.rules.map((r) => ({
    ...r,
    rule: applyStages(r.rule, counts, flags),
    rationale: applyStages(r.rationale, counts, flags),
    section: applyStages(r.section, counts, flags),
  }));

  const cleanedSkills = pack.skills.map((s) => ({
    ...s,
    title: applyStages(s.title, counts, flags),
    description: applyStages(s.description, counts, flags),
    content: applyStages(s.content, counts, flags),
  }));

  let cleaned: InsightPack = {
    ...pack,
    rules: cleanedRules,
    skills: cleanedSkills,
    provenance: { ...pack.provenance, sources: pack.provenance.sources ?? [] },
  };

  if (opts.agentReview && opts.engine) {
    stagesApplied.push("agent_review");
    const prompt = `You are a privacy reviewer. Read the insight pack JSON and identify any remaining PII, proprietary identifiers (company names, internal product names, employee references, internal hostnames, project codenames), or material that could leak proprietary information. Return JSON: {"flagged": [{"location": "rules[N].rule" | "skills[N].content", "kind": "...", "sample": "..."}], "suggestions": [{"location": "...", "current": "...", "suggested": "..."}]}.\n\nPack:\n${JSON.stringify(cleaned, null, 2)}\n\nOutput JSON only.`;
    try {
      const raw = await opts.engine.run(prompt);
      const parsed = JSON.parse(raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, ""));
      for (const f of parsed.flagged ?? []) flags.push({ kind: f.kind, sample: f.sample });
    } catch { /* skip */ }
  }

  return {
    pack: cleaned,
    report: { stagesApplied, redactionCount: counts, flaggedForManualReview: flags },
  };
}
