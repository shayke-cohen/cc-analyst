import type { AnalysisEngine } from "../engine/index.js";
import type { SharedRule } from "./types.js";

export interface DuplicateGroup {
  ours: SharedRule;
  theirs: SharedRule;
  similarity: "exact" | "semantic" | "none";
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function fastDuplicates(ours: SharedRule[], theirs: SharedRule[]): DuplicateGroup[] {
  const out: DuplicateGroup[] = [];
  for (const t of theirs) {
    for (const o of ours) {
      if (normalize(o.rule) === normalize(t.rule)) {
        out.push({ ours: o, theirs: t, similarity: "exact" });
        break;
      }
    }
  }
  return out;
}

export async function semanticDuplicates(
  ours: SharedRule[],
  theirs: SharedRule[],
  engine: AnalysisEngine,
): Promise<DuplicateGroup[]> {
  if (theirs.length === 0 || ours.length === 0) return [];
  const prompt = `Find rules in "incoming" that are semantically equivalent to rules in "existing".
Equivalent means: same intent, same trigger context, same actionable directive — even if phrased differently.

existing:
${JSON.stringify(ours.map((r) => ({ id: r.id, rule: r.rule })))}

incoming:
${JSON.stringify(theirs.map((r) => ({ id: r.id, rule: r.rule })))}

Return JSON: {"matches": [{"existingId": "...", "incomingId": "..."}]}. Output JSON only.`;
  try {
    const raw = await engine.run(prompt);
    const cleaned = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as { matches: { existingId: string; incomingId: string }[] };
    const out: DuplicateGroup[] = [];
    for (const m of parsed.matches ?? []) {
      const o = ours.find((r) => r.id === m.existingId);
      const t = theirs.find((r) => r.id === m.incomingId);
      if (o && t) out.push({ ours: o, theirs: t, similarity: "semantic" });
    }
    return out;
  } catch {
    return [];
  }
}
