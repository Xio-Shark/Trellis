# Trellis Brainstorm

Use during Phase 1 planning to turn the request into clear requirements and artifacts.

## Ground Rules

- A request to build, fix, or "go ahead" is not approval to leave planning — implementation waits for `task.py start` after the planning summary is approved.
- Answer questions from the repository first (code, tests, configs, docs, task history). Ask the user only for product intent, scope, risk, or acceptance decisions the repo can't answer.
- One question per message: the decision needed, your recommendation, the trade-off.

## Preconditions

If no task exists yet:

```bash
TASK_DIR=$({{PYTHON_CMD}} ./.trellis/scripts/task.py create "<short task title>" --description "<one-line summary>" --slug <slug>)
```

Title and `--description` must both be non-empty — `create` rejects blanks. `--slug` gets the `MM-DD-` prefix automatically. `create` writes a starter `prd.md` — keep it updated as understanding grows.

## Flow

1. Capture the request and known facts in `prd.md`.
2. Inspect repo evidence before asking anything.
3. If a user-owned decision remains, ask the single highest-value question, then stop.
4. After each answer, update `prd.md` and repeat.
5. When no decision remains: complex tasks get `design.md` + `implement.md`.
6. Run the requirement convergence gate, then the PRD convergence pass.
7. Present the final summary — goal, in scope, out of scope, acceptance criteria, key decisions, risks — and stop. Only a later explicit approval authorizes `task.py start`.

## Artifacts

- `prd.md` — goal, requirements, acceptance criteria, out-of-scope, blocking open questions
- `design.md` (complex) — boundaries, contracts, data flow, trade-offs, rollback
- `implement.md` (complex) — ordered checklist, validation commands, risky points
- Sub-agent-dispatch tasks have real curated entries in both `implement.jsonl` and `check.jsonl`; seed-only manifests are not ready. Inline platforms skip this.

## Parent + Child Split

When one request has several independently verifiable deliverables:

1. Create a parent + children (`task.py create ... --parent <dir>`)
2. Per child pair: shared files/types/tests → add a `depends_on` edge or merge; otherwise parallel
3. Dual-write each child: `depends_on` / `isolation` in `task.json` + a `## Dependencies` section in `prd.md`
4. `task.py ready <parent>` lists the ready set — dispatch after human review

Tree position is ownership, not ordering. See `.trellis/spec/guides/parallel-decoupled-tasks.md`.

## PRD Convergence Pass

Before the final summary, rewrite `prd.md` once into its final structure — losslessly:

- Fold temporary brainstorm sections such as `What I already know`, `Assumptions`, and resolved `Open Questions` into Goal / Requirements / Acceptance Criteria.
- Preserve every file:line anchor, decision, constraint, requirement ID, and acceptance-criteria mapping.
- Remove resolved open questions; no unresolved temporary brainstorm sections, no duplicate facts across sections.

## Done Means

- `prd.md` has testable acceptance criteria and no unresolved blocking questions
- Complex tasks have `design.md` + `implement.md`; sub-agent tasks have curated jsonl
- The user explicitly approved the final summary
