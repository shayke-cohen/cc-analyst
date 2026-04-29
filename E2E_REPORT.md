# E2E Test Report — cc-analyst v0.1

> Real-world evaluation of the extract → analyze → apply → share pipeline against actual `~/.claude` and `~/.codex` data on 2026-04-29.

## Summary

| # | Scenario | Source | Engine | Project | Sessions | Result |
| --- | --- | --- | --- | --- | --- | --- |
| A | Full pipeline | claude-code | claude-code | VoiceStream | 12 | ✅ produced 15 patterns, 9+4 patches, 5 skills, 4+6 feedback items |
| B | Full pipeline | claude-code | codex | apiFS | 10 | ✅ produced 14 patterns, 14 patches, 4 skills, 4+4 feedback items |
| C | Share export + roundtrip | (uses A) | — | VoiceStream | — | ✅ 9 rules + 5 skills exported; anonymizer caught 6 project-name leaks |
| D | Apply `--dry-run` | (uses A) | — | VoiceStream | — | ✅ produced real working diff against existing 174-line CLAUDE.md |

**Headline:** All four scenarios worked end-to-end. Output quality is high — patterns are specific, evidence-cited with session IDs, properly confidence-rated, and rules are imperative-mood with trigger words. The patch engine produces readable diffs but introduces formatting regressions worth fixing before v0.2.

## What worked well

### Pattern detection is specific and well-evidenced

Sample from Scenario A — the 12 VoiceStream sessions surfaced patterns the user repeatedly stated but never wrote down:

```text
[high] repeated_instruction (x15)
  Build signed release APK and reveal in Finder after completing work
  rule: When any implementation task is complete, build a signed release APK using
        `./scripts/build-release.sh` and reveal the output file in Finder.

[high] workflow (x8)
  End-of-feature checklist: run tests → update PROTOCOL.md/CHANGELOG → commit+push
  → build release APK
```

Each pattern carries `sessionIds`, `quotes` (with text excerpts), and a `suggestedRule` ready to drop into CLAUDE.md.

### Both engines produce comparable output

The Codex engine (Scenario B) was indistinguishable in output quality from the Claude engine (Scenario A). Both returned valid JSON, both surfaced 14–15 patterns with specific evidence, both proposed 9–14 rule additions. The one bug found (missing `action` field on skill records) appeared with **both** engines — it's a prompt-schema issue, not an engine issue.

### Apply produces real working diffs

Scenario D ran `apply` in dry-run against the actual VoiceStream `CLAUDE.md` (174 lines, hand-written). The patch engine successfully:

- Inserted new rules under existing sections (`## Safety Rules`, `### Kotlin / Android`, `## Common Pitfalls`)
- Modified an existing rule about `PROTOCOL.md` to extend it with "...update it in the same commit as the code change and confirm it is visible on the remote main branch before reporting the task done"
- Added a new `## End-of-Task Checklist` section at the end
- Added a Room database migration testing requirement to the existing pitfall

### Anonymization is honest about uncertainty

Scenario C exported a pack from Scenario A's analysis. The anonymizer:

- Stripped 4 URLs, 1 IP (10.0.2.2 — Android emulator localhost), 1 company-name hint
- Flagged 9 items for manual review — 6 of which were the literal project name "VoiceStream" appearing in skill titles. **True positive** — the user would manually review and decide to strip the name before publishing the pack publicly.

This is the right behavior: the agent doesn't pretend to know which CamelCase identifiers are sensitive product names vs. generic terms. It surfaces them and asks.

### Feedback is actionable, not generic

```text
[high] Automate the End-of-Task Checklist
  obs: 'Commit and push' was issued as an explicit user prompt 14 times across 8
       sessions; 'build signed release APK and open in Finder' was issued 15 times.
  sug: Add to project CLAUDE.md: "After verifying any significant change..."

[high] Mandate Local-Server Smoke Test Before Reporting Complete
  obs: Had to ask 'did you tested the app with local server?' 5 times across
       sessions 13636d10, 63b7a1be, f7c6a086.
  sug: Add to CLAUDE.md: "Before reporting any feature that touches uploads,
       logs, or server endpoints as complete, verify the full round-trip..."
```

## Bugs found

| # | Severity | Where | What | Why it matters |
| --- | --- | --- | --- | --- |
| 1 | High | `analyzer/chunker.ts` | `pickStrategy` thresholds (≤20 full / ≤50 hybrid) cause "Prompt is too long" on a 12-session project with verbose tool outputs | Scenario A failed initially. Fixed during this session: lowered to ≤8 / ≤30 and added per-message text truncation at 2000 chars. |
| 2 | Medium | Patch rendering | Markdown apply strips the blank line between `## Heading` and the first paragraph | Visual regression in `CLAUDE.md` — the diff shows lines deleted that shouldn't be |
| 3 | Medium | Patch rendering | Newly inserted bullet rules sometimes get extra blank lines or land outside the section's subsection structure (e.g., `- rule` lands above `### File System` inside `## Safety Rules`) | Output is correct but ugly; future apply-engine work should preserve subsection boundaries |
| 4 | Low | Patch rendering | Final apply output has `\ No newline at end of file` | Minor — easy fix in the renderer |
| 5 | Low | Skills schema | Agent does not always emit `action: "create" \| "update"` even though prompted to | Apply engine has a fallback (`exists ? update : create`) so it works, but the schema isn't honored. Worth tightening the prompt or using zod to validate + retry. |
| 6 | Low | CLI UX | `analyze --apply --dry-run --only patterns` shows "Applied: 0 files (0 ops)" because `--only patterns` skipped the instructions phase | Confusing message — should say "no patches generated (--only patterns)" |
| 7 | Low | `--apply` flow | `analyze --apply --dry-run --only patterns` still incurs an engine call (the patterns phase), so it's not free | Document this; or skip apply when no patch was generated |
| 8 | Low | Top-level await | Inline `tsx -e "..."` scripts using top-level await fail with "cjs output format" error | Wrap in `(async () => { ... })()` or use a `.ts` file |

## Untested in this run

- **Cross-project analysis** — all four scenarios ran on a single project. The cross-project agent call only fires when ≥2 projects are passed, so that code path remains unvalidated against real data. (The wiring is typecheck-clean and the prompt is in [`src/analyzer/prompts.ts`](src/analyzer/prompts.ts), but quality of cross-project recommendations hasn't been judged.)
- **Conflict detection during `apply`** — only fully tested on a CLAUDE.md that hadn't been touched since the last analysis. The "user edited the file between applies" path is stubbed.
- **`share import --apply`** — only previewed (no actual write). The merge strategies (`union` / `replace` / `interactive` / `theirs` / `ours`) work in code but haven't been exercised against a real, pre-existing CLAUDE.md.
- **Codex on Codex source full pipeline** — Codex engine was tested on Claude source (Scenario B). The Codex engine + Codex source combination ran in earlier `--only patterns` smoke tests but not full pipeline.

## Cost / latency

Rough numbers from the runs:

| Scenario | Phases | Wall clock | Engine calls | Notes |
| --- | --- | --- | --- | --- |
| A (Claude × Claude) | patterns + instr + skills + feedback | ~3 min | 4 | Patterns phase is the longest (largest input) |
| B (Codex × Claude source) | same | ~5 min | 4 | Codex CLI is somewhat slower per call |
| C (share export) | anonymize only | <2 sec | 0 | Regex-only, no agent review |
| D (apply dry-run) | apply only | <2 sec | 0 | Pure local |

A full multi-project run on 3 projects would be ~12 engine calls + 1 cross-project + 1 feedback ≈ 14 calls, estimated ~$2–4 at Sonnet 4.6 prices.

## Quality gates met

- ✅ All recommendations cite specific session IDs and occurrence counts
- ✅ Confidence calibration matches spec ("≥ 5 sessions, explicit statement" → high)
- ✅ Rules are imperative-mood with trigger words ("When…", "Before…", "After…")
- ✅ Skill files include valid frontmatter and ordered steps
- ✅ Anonymizer flags real project-identifying terms rather than blindly redacting
- ✅ Apply engine never writes without explicit confirmation (or `--auto` + high-confidence)

## Recommendations (next pass)

| Priority | Item |
| --- | --- |
| P0 | Fix patch-rendering blank-line regression (bug #2) — most visible UX issue |
| P0 | Add zod validation + retry for skill records to enforce the `action` field (bug #5) |
| P1 | Run a real 2-project analyze to validate cross-project pipeline against real data |
| P1 | Tighten `--only` UX so combined with `--apply --dry-run` it doesn't produce misleading summaries (bugs #6, #7) |
| P2 | Test `share import --apply` against a real pre-existing CLAUDE.md (with deliberately overlapping rules) to validate merge strategies |
| P2 | Add a `--max-sessions <n>` flag so users can cap input size when they want predictable cost |

## Conclusion

The pipeline produces useful output. The recommendations from a 12-session run on a real project (VoiceStream) included things the developer genuinely had told the assistant repeatedly and never codified — the precise use case the tool was designed for. The bugs found are formatting/UX issues, not correctness issues. Worth shipping v0.2 after fixing #2 and #5.

---

Run artifacts (gitignored, on the test machine):

```text
/tmp/e2e-out/
├── A-voicestream/                  # Scenario A — Claude × Claude full pipeline
├── B-codex-engine/                 # Scenario B — Codex × Claude full pipeline
├── voicestream.ccpack.json         # Scenario C — exported pack
└── voicestream.ccpack.anonymize-report.json
```
