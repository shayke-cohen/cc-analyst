# Samples

Reference inputs and outputs you can use to understand the data shapes cc-analyst works with — or to hand-craft pipeline test fixtures.

## Files

| File | What it is |
| --- | --- |
| [`sessions/claude-code/example-session.jsonl`](sessions/claude-code/example-session.jsonl) | One synthetic Claude Code session showing the `user` / `assistant` / `tool_use` / `tool_result` record shape. |
| [`sessions/codex/rollout-example.jsonl`](sessions/codex/rollout-example.jsonl) | One synthetic Codex rollout showing the `session_meta` + `response_item` (`message` / `function_call` / `function_call_output`) shape. |
| [`CLAUDE.md`](CLAUDE.md) | Example project instruction file the apply engine might patch. |
| [`AGENTS.md`](AGENTS.md) | Example Codex equivalent for the same project. |
| [`example-analysis.json`](example-analysis.json) | Sample `analysis.json` shape — what the analyzer writes when invoked with `--output ./out`. Use this as the input to `share export`. |
| [`example-pack.ccpack.json`](example-pack.ccpack.json) | Sample exported insight pack (`InsightPack` shape) with rules, a skill, and provenance. |

## Try it

```bash
# Inspect the sample pack
npx tsx ../src/index.ts share inspect example-pack.ccpack.json

# Preview importing it (no changes)
npx tsx ../src/index.ts share import example-pack.ccpack.json
```

## Field reference

`SessionRecord` (Claude Code) and the Codex rollout record shape are both documented in [src/types.ts](../src/types.ts). The normalized `ExtractedSession` shape is what every engine call sees, regardless of which source produced it.
