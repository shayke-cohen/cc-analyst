# cc-analyst

> Extract Claude Code & Codex CLI session logs, analyze them with an agent, and patch your `CLAUDE.md` / `AGENTS.md` and skill files. Share what you learn as portable insight packs.

![tests](https://img.shields.io/badge/tests-29%20passing-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue) ![node](https://img.shields.io/badge/node-%E2%89%A520-blue)

Both Claude Code and Codex CLI persist every session as JSONL — a rich behavioural record of how you work with AI. cc-analyst turns those logs into something useful: it spots patterns you keep repeating ("always use msw for HTTP mocks"), detects multi-step workflows worth codifying as skills, and proposes precise edits to your instruction files. Recommendations come with evidence, confidence levels, and a rollback-safe apply step.

---

## Two pluggable axes

| Axis | Options | Default |
| --- | --- | --- |
| **`--source`** (what we extract) | `claude-code`, `codex`, `all` | `all` |
| **`--engine`** (who analyzes) | `claude-code`, `codex` | `claude-code` |

Sources and engines are independent. You can analyze Codex sessions with the Claude engine, or analyze Claude Code sessions with Codex. All four combinations are validated end-to-end.

---

## Install

```bash
git clone https://github.com/shayke-cohen/cc-analyst.git
cd cc-analyst
npm install --legacy-peer-deps
```

Requires Node ≥ 20.

### Engine credentials

- Claude engine — uses `@anthropic-ai/claude-agent-sdk`. Set `ANTHROPIC_API_KEY` (or use Bedrock / Vertex per the SDK's docs).
- Codex engine — shells out to the `codex` CLI. Install from [openai/codex](https://github.com/openai/codex) and run `codex login` first.

---

## Quick start

```bash
# 1. List discovered projects across both ecosystems
npx tsx src/index.ts projects

# 2. Extract sessions to JSON (no API calls — purely local)
npx tsx src/index.ts extract --source all --output sessions.json

# 3. Analyze one project, write reports
npx tsx src/index.ts analyze --project my-api --output ./out

# 4. Preview the proposed CLAUDE.md / AGENTS.md edits
npx tsx src/index.ts analyze --project my-api --output ./out --apply --dry-run

# 5. Apply interactively (with backup)
npx tsx src/index.ts analyze --project my-api --output ./out --apply

# 6. Roll back the last apply
npx tsx src/index.ts rollback
```

Use a different engine:

```bash
npx tsx src/index.ts analyze --engine codex --project my-api --output ./out
```

---

## What it extracts

| Source | Path | Notes |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` | Continuation chains resolved, UUIDs deduped, compact-summary records skipped |
| Codex active | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | One self-contained session per rollout |
| Codex archived | `~/.codex/archived_sessions/rollout-*.jsonl` | Same shape as active |

Per-session it normalizes user/assistant turns, tool calls (with input keys), tool results (truncated previews), token usage, errors, and modified-file lists into a unified shape.

---

## What it patches

| Source | Project file | Global file | Skill files |
| --- | --- | --- | --- |
| Claude Code | `<repo>/CLAUDE.md` | `~/.claude/CLAUDE.md` | `<repo>/.claude/skills/`, `~/.claude/skills/` |
| Codex | `<repo>/AGENTS.md` | `~/.codex/AGENTS.md` | (rolled into AGENTS.md) |

Apply mode shows a unified diff before writing. Backups go to `~/.cc-analyst/backups/<timestamp>/` with a manifest. `cc-analyst rollback` restores any backup.

---

## The pipeline

```text
sessions ─▶ Phase 1: patterns ─┬─▶ Phase 2: instructions patch (CLAUDE.md / AGENTS.md)
                                ├─▶ Phase 3: skills (Claude Code only)
                                └─▶ Phase 4: feedback
all reports ──────────────────────▶ Cross-project: shared rules + divergences
```

Each phase is one engine call. Inputs are chunked by session count: full payload (≤20), hybrid (≤50), summary (>50).

The system prompt enforces evidence standards:

- Minimum **3 occurrences across 2+ sessions** to recommend a rule.
- **Confidence calibration**: high (5+ sessions, explicit user statement), medium (3–4 sessions, inferred), low (2 sessions, indirect signals).
- Rules must be imperative-mood with a trigger word ("When…", "Before…", "For…").

See [src/analyzer/prompts.ts](src/analyzer/prompts.ts) for the full prompt set.

---

## Sample output

A live run against a small Claude Code project produced this pattern (excerpt):

```json
{
  "category": "error_pattern",
  "description": "Autonomous-mode task dispatched without provisioning required tools.",
  "occurrences": 1,
  "sessionIds": ["f6523d08-09a3-4a6e-b737-1b73b8ff9b98"],
  "quotes": [
    {
      "sessionId": "f6523d08-09a3-4a6e-b737-1b73b8ff9b98",
      "text": "I can't check the weather - I don't have access to weather data..."
    }
  ],
  "suggestedRule": "Before dispatching a task in Execution Mode, verify the target session has all required tools provisioned; do not dispatch tasks that depend on real-time data without a matching MCP or tool binding.",
  "suggestedSkill": null,
  "scope": "project",
  "confidence": "low"
}
```

A complete sample analysis is at [`samples/example-analysis.json`](samples/example-analysis.json), and a sample exported insight pack is at [`samples/example-pack.ccpack.json`](samples/example-pack.ccpack.json).

---

## Sharing — insight packs

Export your distilled patterns as a portable `.ccpack.json`. Anonymization runs five stages before any data leaves your machine: paths, identifiers (emails / URLs / IPs), session refs (UUIDs / timestamps), generalization (company-name hints), and an optional agent-driven privacy review.

```bash
# Export
npx tsx src/index.ts share export \
  --analysis ./out/analysis.json \
  --name "ts-api-patterns" \
  --tags typescript,api,testing \
  -o ts-api-patterns.ccpack.json

# Inspect a pack
npx tsx src/index.ts share inspect ts-api-patterns.ccpack.json

# Import another team's pack (preview)
npx tsx src/index.ts share import their-pack.ccpack.json

# Apply, scoped to one project, with semantic dedup
npx tsx src/index.ts share import their-pack.ccpack.json --apply --project my-api
```

Merge strategies: `union` (default), `replace`, `interactive`, `theirs`, `ours`. Duplicate detection runs in two passes — fast normalized-string match, then semantic match via the configured engine.

---

## CLI reference

```text
cc-analyst extract       # extract sessions to JSON (no API calls)
cc-analyst projects      # list discovered projects
cc-analyst analyze       # run pipeline (default subcommand)
  --source <src>         #   claude-code | codex | all
  --engine <engine>      #   claude-code | codex
  --model <id>           #   override model
  --project <name>       #   filter by project name/path
  --days <n>             #   limit to last N days
  --only <phase>         #   patterns | instructions | skills | feedback
  --apply                #   apply recommendations
  --auto                 #   auto-apply high-confidence (with --apply)
  --dry-run              #   preview only (with --apply)
  -o, --output <dir>     #   write reports to directory

cc-analyst rollback      # undo last apply
  --list                 #   show all backups
  --id <id>              #   specific backup
  --dry-run              #   preview restoration

cc-analyst share export <opts>     # build a .ccpack.json from analysis.json
cc-analyst share import <pack>     # preview / apply an imported pack
cc-analyst share inspect <pack>    # show pack contents
```

---

## Architecture

```text
src/
├── index.ts                 # commander CLI
├── types.ts
├── extractor/
│   ├── claude-code.ts       # ~/.claude source adapter
│   ├── codex.ts             # ~/.codex source adapter
│   ├── instructions.ts      # CLAUDE.md / AGENTS.md / skills discovery
│   ├── git.ts
│   └── index.ts             # combine sources, normalize
├── engine/
│   ├── claude.ts            # Agent SDK
│   ├── codex.ts             # codex exec --json
│   └── index.ts
├── analyzer/
│   ├── chunker.ts           # session-data chunking
│   ├── prompts.ts           # 4-phase prompt templates
│   └── index.ts             # orchestrator
├── apply/
│   ├── parser.ts            # markdown section parser
│   ├── patch.ts             # add / append / replace / remove ops
│   ├── diff.ts              # unified diff
│   ├── backup.ts            # backup + rollback
│   └── index.ts             # interactive apply
├── share/
│   ├── pack.ts              # InsightPack format
│   ├── anonymize.ts         # 5-stage anonymization
│   ├── duplicate-detect.ts  # fast + semantic dedup
│   ├── export.ts
│   └── import.ts
└── utils/paths.ts
```

---

## Development

```bash
npm install --legacy-peer-deps
npm run typecheck
npm test
```

29 vitest tests cover the markdown parser, patch ops, anonymization, pack roundtrip, chunker thresholds, path decoder, and a Codex extractor smoke test.

---

## Roadmap

| Phase | Status |
| --- | --- |
| 0 — Extractor (Claude Code + Codex) | ✅ |
| 1 — Per-project analyzer (4 phases, both engines) | ✅ |
| 2 — Apply engine (parse, patch, diff, backup, rollback) | ✅ |
| 3 — Multi-project + cross-project | ✅ |
| 4 — Sharing (insight packs, anonymization, file export/import) | ✅ |
| 4b — Git sync, public registry | ⏳ |
| 5 — Watch mode, dashboard, MCP server | ⏳ |

---

## Privacy & safety

| Concern | Mitigation |
| --- | --- |
| Session data sent to Claude or Codex API | Standard API usage; no third-party storage. Use `--engine codex` to keep it within OpenAI, or vice versa. |
| Sharing leaks proprietary info | 5-stage anonymization with optional agent privacy review; preview before publishing. |
| Imported pack injecting bad rules | Import preview mode by default; rules are markdown text, never executable. |
| Backups contain originals | `~/.cc-analyst/backups/<ts>/`, same permissions as source files. Pruned to a configurable max. |

---

## License

MIT — see [LICENSE](LICENSE).
