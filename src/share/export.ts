import { writeFileSync } from "node:fs";
import chalk from "chalk";
import type { AnalysisOutput } from "../analyzer/index.js";
import type { AnalysisEngine } from "../engine/index.js";
import { anonymizePack } from "./anonymize.js";
import { buildPack, writePack } from "./pack.js";
import type { InsightPack } from "./types.js";

export interface ExportOptions {
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  license?: string;
  output: string;
  minConfidence?: "high" | "medium" | "low";
  anonymize?: boolean;
  agentReview?: boolean;
  engine?: AnalysisEngine;
  toolVersion: string;
}

export async function exportPack(analysis: AnalysisOutput, opts: ExportOptions): Promise<{ pack: InsightPack; reportPath: string }> {
  let pack = buildPack({
    name: opts.name,
    description: opts.description,
    author: opts.author,
    tags: opts.tags,
    license: opts.license,
    analysis,
    toolVersion: opts.toolVersion,
    minConfidence: opts.minConfidence,
  });

  let reportPath = "";
  if (opts.anonymize !== false) {
    const result = await anonymizePack(pack, { agentReview: opts.agentReview, engine: opts.engine });
    pack = result.pack;
    reportPath = opts.output.replace(/\.json$/, "") + ".anonymize-report.json";
    writeFileSync(reportPath, JSON.stringify(result.report, null, 2));
    if (result.report.flaggedForManualReview.length) {
      console.log(chalk.yellow(`Anonymizer flagged ${result.report.flaggedForManualReview.length} items for manual review (see ${reportPath})`));
    }
  }

  writePack(opts.output, pack);
  return { pack, reportPath };
}
