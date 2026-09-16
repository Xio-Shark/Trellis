# Development Workflow

> Trellis keeps work on disk: task artifacts under `.trellis/tasks/`, project
> guidelines under `.trellis/spec/`, session journals under `.trellis/workspace/`.
> Chat gets compacted; files don't.

---

## Core Principles

1. **Plan before code** — non-trivial work gets a task directory and a `prd.md` first
2. **Persist to files** — research, decisions, and lessons go to files, not just chat
3. **One task at a time** — parallel work is expressed as child tasks, not parallel edits
4. **Record promptly** — update the journal and spec while the context is fresh

---

## Trellis System

### Developer Identity

```bash
python3 ./.trellis/scripts/init_developer.py <your-name>   # first time only
```

Creates `.trellis/.developer` (gitignored) + `.trellis/workspace/<your-name>/`.

### Spec — project coding guidelines

`.trellis/spec/` holds coding guidelines organized by package and layer.

- `.trellis/spec/<package>/<layer>/index.md` — entry point; links to the topic files that matter
- `.trellis/spec/guides/` — cross-cutting thinking guides

Update spec when you find a new pattern, a convention, or a bug worth preventing.

### Task System

Every task is a directory `.trellis/tasks/{MM-DD-name}/` holding `task.json`, `prd.md`, optional `design.md` / `implement.md` / `research/`, and context manifests (`implement.jsonl`, `check.jsonl`) for sub-agent-capable platforms.

```bash
python3 ./.trellis/scripts/task.py create "<title>" [--slug <name>] [--parent <dir>]
python3 ./.trellis/scripts/task.py start <name>          # set active task (planning → in_progress)
python3 ./.trellis/scripts/task.py current --source      # show active task
python3 ./.trellis/scripts/task.py finish                # clear the active-task pointer
python3 ./.trellis/scripts/task.py archive <name>        # mark completed, move to archive/
python3 ./.trellis/scripts/task.py list [--mine] [--status <s>]

python3 ./.trellis/scripts/task.py add-context <dir> implement|check <path> [reason]
python3 ./.trellis/scripts/task.py ready <parent>        # parallel deps: ready / blocked children
python3 ./.trellis/scripts/task.py drift <parent>        # json vs ## Dependencies mismatch
python3 ./.trellis/scripts/task.py dispatch-ready <parent> [--yes] [--integrate]
python3 ./.trellis/scripts/task.py integrate <parent> [--dry-run]
python3 ./.trellis/scripts/task.py --help                # authoritative full list
```

`create` auto-sets the per-session active-task pointer when session identity is available; `start` flips status to `in_progress`; `finish` clears the pointer; `archive` writes `status=completed` and moves the directory. State lives under `.trellis/.runtime/sessions/`.

### Workspace Journal

```bash
python3 ./.trellis/scripts/add_session.py --title "Title" --commit "<hash>" --summary "..."
```

Appends the session to `.trellis/workspace/<dev>/journal-N.md` (rotates at `max_journal_lines`, default 2000) and updates the index.

### Context Script

```bash
python3 ./.trellis/scripts/get_context.py                              # full session context
python3 ./.trellis/scripts/get_context.py --mode packages              # packages + spec layers
python3 ./.trellis/scripts/get_context.py --mode phase [--step <X.Y>]  # phase index / step detail
```

---

## Phase Index

```
Phase 1: Plan    → task directory + planning artifacts
Phase 2: Execute → implement, then quality check
Phase 3: Finish  → spec update, commit, journal
```

### Request Triage

- Small request / simple conversation: ask whether this turn needs a Trellis task. If not, just do the work.
- Complex request: ask whether to create a task and plan first. If not, clarify scope or suggest a smaller split.
- Consent to create a task is not approval to implement — planning artifacts come first.

### Planning Artifacts

- `prd.md` — requirements and acceptance criteria. Every task.
- `design.md` / `implement.md` — technical design and execution plan. Complex tasks.
- `implement.jsonl` / `check.jsonl` — spec/research manifests injected into sub-agents. Sub-agent platforms.
- Lightweight tasks may be PRD-only; complex tasks need all three artifacts before `task.py start`.

### Parent / Child Task Trees

Use a parent task when one request contains several independently verifiable deliverables. The parent owns the source requirements and the final integration review; children own the deliverables.

Tree ≠ dependency graph. Sibling ordering and parallel waves use `task.json` fields on each child — `depends_on` (sibling directory names) and `isolation` (`worktree` for code changes, `shared` ok for docs/readonly) — dual-written as a `## Dependencies` section in the child's `prd.md` / `implement.md`.

```bash
python3 ./.trellis/scripts/task.py create "<title>" --slug <name> --parent <parent-dir>
python3 ./.trellis/scripts/task.py add-subtask <parent> <child>
python3 ./.trellis/scripts/task.py ready <parent-dir>
```

Review the ready set (`task.py ready <parent>`), dispatch ready children (`dispatch-ready --yes`, concurrency ≤ `parallel.max_concurrency`), then `task.py integrate <parent>` to merge. Do not start the parent just because children exist — start the child that owns the next independently verifiable deliverable.

<!-- Per-turn breadcrumb: no active task (before Phase 1) -->

[workflow-state:no_task]
No active task. Classify the request first: small/simple → ask whether this turn needs a Trellis task (if no, skip Trellis); complex → ask whether to create a task and enter planning.
[/workflow-state:no_task]

### Phase 1: Plan
- 1.0 Create task `[required · once]`
- 1.1 Requirement exploration `[required · repeatable]` (`prd.md`; complex tasks also `design.md` + `implement.md`)
- 1.2 Research `[optional · repeatable]` (persist to `research/`)
- 1.3 Configure context `[required · once]` (sub-agent platforms only; inline platforms skip)
- 1.4 Activate task `[required · once]` (`task.py start` after artifact review)
- 1.5 Completion criteria

[workflow-state:planning]
Stay in planning (`trellis-brainstorm`). Lightweight: `prd.md` can be enough. Complex: finish `prd.md`, `design.md`, and `implement.md`; ask for review before `task.py start`.
Multi-deliverable scope: consider a parent task plus independently verifiable child tasks; sibling order via `depends_on` / `isolation` in task.json — tree position alone is not a dependency.
Sub-agent mode: curate `implement.jsonl` and `check.jsonl` as spec/research manifests before start.
[/workflow-state:planning]

[workflow-state:planning-inline]
Stay in planning (`trellis-brainstorm`). Lightweight: `prd.md` can be enough. Complex: finish `prd.md`, `design.md`, and `implement.md`; ask for review before `task.py start`.
Multi-deliverable scope: consider a parent task plus independently verifiable child tasks; sibling order via `depends_on` / `isolation` in task.json — tree position alone is not a dependency.
Inline mode: skip jsonl curation; Phase 2 loads context via `trellis-before-dev`.
[/workflow-state:planning-inline]

### Phase 2: Execute
- 2.1 Implement `[required · repeatable]`
- 2.2 Quality check `[required · repeatable]`
- 2.3 Rollback `[on demand]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Reasonix, Trae, Grok]
Dispatch `trellis-implement` → `trellis-check` sub-agents. Sub-agent dispatch protocol applies to all platforms and all sub-agents (including `trellis-research`): every dispatch prompt starts with `Active task: <task path from task.py current>` — critical on class-2 platforms (codex, copilot, gemini, qoder, etc.) where sub-agents can't see the session pointer otherwise.
[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Reasonix, Trae, Grok]

[codex-inline, Kilo, Antigravity, Devin]
Work in the main session: `trellis-before-dev` → edit → `trellis-check`.
[/codex-inline, Kilo, Antigravity, Devin]

[workflow-state:in_progress]
Flow: `trellis-implement` → `trellis-check` → `trellis-update-spec` → commit (Phase 3.4) → `/trellis:finish-work`. `trellis-implement` / `trellis-research` / `trellis-check` are sub-agent types (Task/Agent tool, not skills); `trellis-update-spec` is a skill.
Main-session default: dispatch implement/check sub-agents. Sub-agent self-exemption: if already running as `trellis-implement`, do NOT spawn another `trellis-implement` or `trellis-check`; if already running as `trellis-check`, do NOT spawn another `trellis-check` or `trellis-implement` — dispatch is main session only.
On class-2 platforms (codex, copilot, gemini, qoder, etc.) the dispatch prompt starts with `Active task: <task path>`. Read context: jsonl entries → `prd.md` → `design.md` / `implement.md` if present.
[/workflow-state:in_progress]

[workflow-state:in_progress-inline]
Flow: `trellis-before-dev` → edit → `trellis-check` → `trellis-update-spec` → commit (Phase 3.4) → `/trellis:finish-work`.
Do not dispatch implement/check sub-agents in inline mode. Read `prd.md` → `design.md` / `implement.md` if present, plus relevant spec.
[/workflow-state:in_progress-inline]

### Phase 3: Finish
- 3.2 Debug retrospective `[on demand]`
- 3.3 Spec update `[required · once]`
- 3.4 Commit changes `[required · once]`
- 3.5 Wrap-up (`/trellis:finish-work`)

[workflow-state:completed]
Code committed. Run `/trellis:finish-work`.
[/workflow-state:completed]

### Rules

1. Run steps in order inside each phase; `[required]` steps can't be skipped
2. `[once]` steps are done if their output already exists — don't re-run
3. Phases can roll back (a defective `prd.md` → fix it in Plan, then re-enter Execute)
4. Artifact presence informs the next step: missing `design.md` / `implement.md` is valid for lightweight tasks, incomplete for complex ones

### Loading Step Detail

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>
# e.g. python3 ./.trellis/scripts/get_context.py --mode phase --step 1.1
```

---

## Phase 1: Plan

Goal: turn the request into reviewed planning artifacts.

#### 1.0 Create task `[required · once]`

```bash
python3 ./.trellis/scripts/task.py create "<task title>" --slug <name>
```

`--slug` is the name only — `create` adds the `MM-DD-` prefix. Creates the task directory with `task.json` (status `planning`) and a starter `prd.md`, and auto-targets it when session identity is available. Skip if `task.py current` already points at this work. Do not run `start` yet — that flips status before artifacts are reviewed.

#### 1.1 Requirement exploration `[required · repeatable]`

Load `trellis-brainstorm` and explore requirements with the user: prefer repo evidence over asking, one question at a time, update `prd.md` as answers land. Complex tasks also produce `design.md` and `implement.md`.

When considering a parent/child split:
- Parent tasks own source requirements and the final integration review. Child tasks own actual deliverables that can be planned, implemented, checked, and archived independently.
- Tree ≠ dependency graph — sibling order is `depends_on` + `isolation` in each child `task.json`, dual-written as `## Dependencies` in its artifacts.
- Two children sharing files/types/tests → add an edge or merge; otherwise they can run in parallel.
- Do not start the parent unless it has direct implementation work.

#### 1.2 Research `[optional · repeatable]`

Write findings to `{TASK_DIR}/research/` — one file per topic. Conversations get compacted; files don't.

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Reasonix, Trae, Grok]

Dispatch a `trellis-research` sub-agent; its output must be persisted under `research/`.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Reasonix, Trae, Grok]

[codex-inline, Kilo, Antigravity, Devin]

Research in the main session directly and write findings into `research/`.

[/codex-inline, Kilo, Antigravity, Devin]

#### 1.3 Configure context `[required · once]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Reasonix, Trae, Grok]

Curate `implement.jsonl` and `check.jsonl` — one `{"file": "<path>", "reason": "..."}` per line, paths repo-root relative:

- **In**: `.trellis/spec/...` indexes/guidelines and `{TASK_DIR}/research/*.md` the Phase 2 sub-agents need
- **Out**: code files and files you're about to modify — sub-agents read those themselves
- `implement.jsonl` → what the implement agent needs to write code; `check.jsonl` → what the check agent needs to review

Discover spec layers with `get_context.py --mode packages`. Ready gate: both `implement.jsonl` and `check.jsonl` must contain at least one real `{"file": "...", "reason": "..."}` entry before `task.py start`. The seeded `_example` row doesn't count.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Reasonix, Trae, Grok]

[codex-inline, Kilo, Antigravity, Devin]

Skip — Phase 2 loads context through `trellis-before-dev`.

[/codex-inline, Kilo, Antigravity, Devin]

#### 1.4 Activate task `[required · once]`

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

Runs after artifact review and flips status to `in_progress`. If it fails with a session-identity message, set `TRELLIS_CONTEXT_ID` (or follow the printed hint) and retry. Runtime consumers tolerate missing or seed-only manifests for compatibility, but that tolerance is not a planning-ready state.

#### 1.5 Completion criteria

- `prd.md` exists; complex tasks also have `design.md` + `implement.md`
- Sub-agent platforms: `implement.jsonl` and `check.jsonl` each contain at least one real curated entry (seed row does not count)
- The user confirmed the task should enter implementation; `task.py start` ran

---

## Phase 2: Execute

Goal: turn reviewed artifacts into code that passes quality checks.

#### 2.1 Implement `[required · repeatable]`

[Claude Code, Cursor, OpenCode, CodeBuddy, Droid, Pi, Oh My Pi]

Dispatch `trellis-implement`: implement the reviewed artifacts, consult `research/`, finish with project lint + type-check. **Dispatch prompt guard**: the spawned agent is already the `trellis-implement` sub-agent and must implement directly — not spawn another `trellis-implement` / `trellis-check`.

The platform hook/plugin auto-handles:
- Reads `implement.jsonl` and injects the referenced spec/research files into the agent prompt
- Injects `prd.md`, `design.md` if present, and `implement.md` if present

[/Claude Code, Cursor, OpenCode, CodeBuddy, Droid, Pi, Oh My Pi]

[codex-sub-agent, Gemini, Qoder, Copilot, ZCode, Reasonix, Trae, Grok]

Dispatch `trellis-implement`: implement the reviewed artifacts, consult `research/`, finish with project lint + type-check. **Dispatch prompt guard**: the prompt starts with `Active task: <task path>`; the spawned agent is already the `trellis-implement` sub-agent and must not spawn another `trellis-implement` / `trellis-check`.

The pull-based sub-agent definition auto-handles the context load requirement:
- Resolves the active task with `task.py current --source`, then reads `prd.md`, `design.md` if present, and `implement.md` if present
- Reads `implement.jsonl` and loads each referenced spec/research file before coding

[/codex-sub-agent, Gemini, Qoder, Copilot, ZCode, Reasonix, Trae, Grok]

[Kiro]

Dispatch `trellis-implement` with the same prompt guard; the platform prelude auto-handles context — reads `implement.jsonl` and injects the referenced spec/research files plus the task artifacts.

[/Kiro]

[codex-inline, Kilo, Antigravity, Devin]

1. Load `trellis-before-dev` for project guidelines
2. Read `{TASK_DIR}/prd.md` → `design.md` / `implement.md` if present → `research/`
3. Implement per the reviewed artifacts; run project lint + type-check

[/codex-inline, Kilo, Antigravity, Devin]

#### 2.2 Quality check `[required · repeatable]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Reasonix, Trae, Grok]

Dispatch `trellis-check`: review the diff against specs and task artifacts, fix findings directly, ensure lint + type-check pass. **Dispatch prompt guard**: the spawned agent is already the `trellis-check` sub-agent and must review/fix directly — not spawn another `trellis-check` / `trellis-implement`.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Reasonix, Trae, Grok]

[codex-inline, Kilo, Antigravity, Devin]

Load `trellis-check` and verify: spec compliance, lint / type-check / tests, cross-layer consistency when the change spans layers. Fix → re-check until green.

[/codex-inline, Kilo, Antigravity, Devin]

The last 2.2 pass before commit is full-scope: list affected packages via `get_context.py --mode packages` and run each spec index's Quality Check.

#### 2.3 Rollback `[on demand]`

- Check reveals a `prd.md` defect → fix it in Plan, redo 2.1
- Implementation went wrong → revert, redo 2.1
- Missing knowledge → research into `research/`, resume

---

## Phase 3: Finish

Goal: verify, capture lessons, record the work.

#### 3.2 Debug retrospective `[on demand]`

If the task needed repeated debugging of the same issue, load `trellis-break-loop`: classify the root cause, explain why earlier fixes failed, write the prevention into spec.

#### 3.3 Spec update `[required · once]`

Load `trellis-update-spec` and decide whether this task produced knowledge worth keeping — new patterns, conventions, pitfalls, technical decisions. "Nothing to update" is fine if it's a deliberate conclusion.

#### 3.4 Commit changes `[required · once]`

1. `git status --porcelain` — snapshot dirty paths; clean tree → skip to 3.5
2. `git log --oneline -5` — match the repo's commit style (prefix, language, length)
3. Group the files you edited this session into logical commits; list unrecognized dirty files separately — never silently include them
4. Present the batched plan once; on confirmation run `git add` + `git commit` per batch. No `--amend`, no push.
5. On rejection → stop; the user commits by hand.

#### 3.5 Wrap-up reminder

Point the user at `/trellis:finish-work` to archive the task and record the session journal.

---

## Customizing Trellis

All customization happens by editing this file; the scripts are parsers only.

- Step detail lives in `#### X.Y` sections; per-turn breadcrumb text lives in `[workflow-state:STATUS]` blocks (`STATUS` charset `[A-Za-z0-9_-]+`; `planning` / `in_progress` have `-inline` variants for codex inline mode). A missing tag degrades to a generic prompt.
- `[Platform, ...] ... [/Platform, ...]` blocks are shown only to the listed platforms.
- Task lifecycle hooks are `task.json` `hooks.after_create / after_start / after_finish / after_archive` shell commands.
- In a Trellis checkout, run `trellis update` after editing to propagate the change to user projects.
