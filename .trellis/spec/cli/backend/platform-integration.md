# Platform Integration Guide

How to add support for a new AI CLI platform (like Claude Code, Cursor, Gemini CLI, OpenCode, Codex, Kilo, Kiro, Qoder, CodeBuddy, Copilot, Droid, Windsurf, Antigravity).

---

## Architecture

Platform support uses a **centralized registry pattern** (similar to Turborepo's package manager support):

- **Data registry**: `src/types/ai-tools.ts` — `AI_TOOLS` record with all platform metadata
- **Function registry**: `src/configurators/index.ts` — `PLATFORM_FUNCTIONS` with configure/collectTemplates per platform
- **Shared configurator utilities**: `src/configurators/shared.ts` — `resolvePlaceholders()`, `writeSkills()`, `writeAgents()`, `writeSharedHooks()`, `resolveAllAsSkills()`, `resolveCommands()`, `resolveSkills()`, `wrapWithSkillFrontmatter()`
- **Shared template utilities**: `src/templates/template-utils.ts` — `createTemplateReader()` factory that eliminates boilerplate across platform template modules
- **Shared hooks**: `src/templates/shared-hooks/` — platform-independent Python hook scripts (session-start, inject-subagent-context, statusline) written as-is to any platform's hooks directory
- **Common templates**: `src/templates/common/` — single source of truth for commands (start, finish-work) and skills (before-dev, brainstorm, check, break-loop, update-spec) with `{{placeholder}}` resolution per platform
- **Shared utilities**: `src/utils/compare-versions.ts` — `compareVersions()` with full prerelease support (used by cli, update, migrations)
- **Derived helpers**: `ALL_MANAGED_DIRS`, `getConfiguredPlatforms()`, etc. — consumed by update, init, hash tracking

All lists (backup dirs, template dirs, platform detection, cleanup whitelist) are **derived from the registry automatically**. No scattered hardcoded lists.

---

## Checklist: Adding a New Platform

When adding a new platform `{platform}`, update the following:

### Step 1: Type Definitions (data registry)

| File | Change |
|------|--------|
| `src/types/ai-tools.ts` | Add to `AITool` union type |
| `src/types/ai-tools.ts` | Add to `CliFlag` union type |
| `src/types/ai-tools.ts` | Add to `TemplateDir` union type |
| `src/types/ai-tools.ts` | Add entry to `AI_TOOLS` record (name, configDir, cliFlag, defaultChecked, hasPythonHooks, templateDirs) |

**This single entry automatically propagates to**: `BACKUP_DIRS`, `TEMPLATE_DIRS`, `getConfiguredPlatforms()`, `cleanupEmptyDirs()`, `initializeHashes()`, init `TOOLS[]` prompt, Windows detection.

### Step 2: CLI Flag

| File | Change |
|------|--------|
| `src/cli/index.ts` | Add `--{platform}` option |
| `src/commands/init.ts` | Add `{platform}?: boolean` to `InitOptions` interface |

> Note: Commander.js options and TypeScript interfaces require static declarations — cannot be derived from registry. A compile-time assertion `_AssertCliFlagsInOptions` in `init.ts` will catch missing `InitOptions` fields — you'll get a build error if `CliFlag` has a value not present in `InitOptions`.

### Step 3: Configurator (function registry)

| File | Change |
|------|--------|
| `src/configurators/{platform}.ts` | Create new configurator (copy from existing, export `configure{Platform}`) |
| `src/configurators/index.ts` | Add entry to `PLATFORM_FUNCTIONS` with `configure` and optional `collectTemplates` |

### Step 4: Templates

> **Key concept**: Most platforms now derive their content from `src/templates/common/` (commands + skills) via `resolvePlaceholders()` in `configurators/shared.ts`. Platform-specific template directories only contain **agents**, **settings/hooks config**, and platform-specific overrides. The `createTemplateReader()` factory from `src/templates/template-utils.ts` eliminates boilerplate in platform `index.ts` files.

**Standard with shared hooks** (Qoder, CodeBuddy, Droid, Cursor, Gemini):

| Directory | Contents |
|-----------|----------|
| `src/templates/{platform}/` | Root directory |
| `src/templates/{platform}/index.ts` | Uses `createTemplateReader(import.meta.url)` — exports agents, settings |
| `src/templates/{platform}/agents/` | Agent definitions (`.md` files — implement, check, research) |
| `src/templates/{platform}/settings.json` | Platform settings (may use `{{PYTHON_CMD}}` placeholder) |

> Note: These platforms use `writeSharedHooks()` from `shared.ts` to copy platform-independent hook scripts from `src/templates/shared-hooks/` into each platform's hooks directory. Commands and skills come from `src/templates/common/` via `resolveCommands()` / `resolveSkills()` / `resolveAllAsSkills()`. The `createTemplateReader()` factory provides `listMdAgents()`, `getSettings()`, etc. without per-platform boilerplate.

**Claude Code pattern** (full hooks + agents + settings):

| Directory | Contents |
|-----------|----------|
| `src/templates/claude/` | Root directory |
| `src/templates/claude/index.ts` | Export functions for agents, hooks, settings |
| `src/templates/claude/agents/` | Agent definitions (`.md` files — implement, check, research) |
| `src/templates/claude/hooks/` | Claude-specific hook scripts (`.py` files) |
| `src/templates/claude/settings.json` | Claude settings (uses `{{PYTHON_CMD}}` placeholder) |

> Note: Claude Code is the reference platform. It has its own hooks directory (not shared-hooks) because Claude hooks have platform-specific integration points. Commands come from `src/templates/common/commands/`.

**JS plugin pattern** (OpenCode):

| Directory | Contents |
|-----------|----------|
| `src/templates/{platform}/` | Root directory |
| `src/templates/{platform}/commands/trellis/` | Slash commands (`.md` files) |
| `src/templates/{platform}/plugin/` | JS plugin files |
| `src/templates/{platform}/lib/` | JS library files |
| `src/templates/{platform}/package.json` | Plugin dependencies |

> Note: OpenCode uses JS plugins instead of Python hooks, has no `index.ts` template module, and has no `collectTemplates` — so `trellis update` does not track OpenCode template files. If a new platform uses JS plugins, follow this pattern.

**Skills pattern** (Codex, Kiro, Qoder):

| Directory | Contents |
|-----------|----------|
| `src/templates/{platform}/` | Root directory |
| `src/templates/{platform}/index.ts` | Uses `createTemplateReader(import.meta.url)` — exports agents |
| `src/templates/{platform}/agents/` | Agent definitions (platform-specific format) |
| `src/templates/{platform}/settings.json` | Platform settings (optional) |

> Note: Codex/Kiro/Qoder use `resolveAllAsSkills()` from `shared.ts` to generate all 7 templates (2 commands + 5 skills) as SKILL.md files with YAML frontmatter. Skills are written via `writeSkills()`.
>
> **Codex has a two-layer directory model:**
>
> | Layer | Install Path | Template Source | Purpose |
> |-------|-------------|-----------------|---------|
> | Shared skills | `.agents/skills/` | Generated from `common/` templates | Cross-platform skills (agentskills.io standard) |
> | Codex config/agents/hooks | `.codex/` | `src/templates/codex/{agents,hooks.json}` | Config, custom agents, SessionStart hook |
>
> **Key rules:**
> - Shared skills in `.agents/skills/` must NOT contain platform-specific references (no `--platform codex`, no `codex exec`)
> - Agent TOML format: `name` + `description` + `developer_instructions` + optional `sandbox_mode` (NOT `[sandbox_read_only]` + `prompt`)
> - Codex hooks require `features.codex_hooks = true` in user config (experimental as of v0.116.0)
> - Platform detection uses `.codex/` only — `.agents/skills/` alone does NOT trigger codex detection
> - `configDir` is `".codex"`, with `supportsAgentSkills: true` to auto-include `.agents/skills` in managed paths

**Kiro JSON agent pattern** (Kiro):

| Directory | Contents |
|-----------|----------|
| `src/templates/kiro/` | Root directory |
| `src/templates/kiro/index.ts` | Uses `createTemplateReader(import.meta.url)` — exports agents via `listJsonAgents()` |
| `src/templates/kiro/agents/` | Agent definitions (`.json` files) |

> Note: Kiro is unique in using JSON format for agent definitions (not Markdown). The `createTemplateReader()` factory provides `listJsonAgents()` specifically for this. Skills are generated from `common/` templates via `resolveAllAsSkills()`.

**Workflows pattern** (Kilo):

| Directory | Contents |
|-----------|----------|
| (no template directory) | Kilo generates from `common/` templates at runtime |

> Note: Kilo uses `resolveCommands()` + `resolveSkills()` to generate workflows and skills. No physical template files needed.

**Workflows pattern** (Antigravity):

| Directory | Contents |
|-----------|----------|
| (no template directory) | Antigravity derives from Codex skills at runtime |

> Note: Antigravity has no physical template files — workflow content is **derived from Codex skills at runtime** via `adaptSkillContentToWorkflow()`. The config dir is `.agent/workflows` (not `.agent/`). Workflows are triggered with `/workflow-name` slash commands. When adding a new Codex skill, Antigravity automatically picks it up.

**Copilot pattern** (prompts + hooks):

| Directory | Contents |
|-----------|----------|
| `src/templates/copilot/` | Root directory |
| `src/templates/copilot/index.ts` | Export functions for prompts, hooks |
| `src/templates/copilot/prompts/` | Prompt files (`.prompt.md`) |
| `src/templates/copilot/hooks/` | Hook scripts (`.py` files) |
| `src/templates/copilot/hooks.json` | Hooks configuration |

> Note: Copilot uses `.prompt.md` format for commands (not plain `.md`). Hooks use `hooks.json` (not `settings.json`).

**Droid pattern** (droids + settings):

| Directory | Contents |
|-----------|----------|
| `src/templates/droid/` | Root directory |
| `src/templates/droid/index.ts` | Uses `createTemplateReader(import.meta.url)` — exports droids, settings |
| `src/templates/droid/droids/` | Droid definitions (`.md` files — implement, check, research) |
| `src/templates/droid/settings.json` | Droid settings |

> Note: Droid uses "droids" terminology instead of "agents" but follows the same pattern. Uses `writeAgents()` with the droids directory.

**Windsurf pattern** (no template directory):

| Directory | Contents |
|-----------|----------|
| (no template directory) | Windsurf generates from `common/` templates + shared hooks at runtime |

> Note: Windsurf uses `resolveCommands()` for workflows and `resolveSkills()` for auto-triggered skills. Shared hooks are written via `writeSharedHooks()`. No platform-specific template files needed.

**Required commands/skills**: All platforms must include the following (adapted to each platform's format). Content comes from `src/templates/common/`:

| Type | Name | Purpose | Required |
|------|------|---------|----------|
| Command | `start` | Session initialization | Yes |
| Command | `finish-work` | Pre-commit checklist | Yes |
| Skill | `before-dev` | Read development guidelines (auto-discovers package specs) | Yes |
| Skill | `brainstorm` | Requirements discovery | Yes |
| Skill | `check` | Check code quality (auto-discovers relevant specs) | Yes |
| Skill | `break-loop` | Post-debug analysis | Yes |
| Skill | `update-spec` | Update code-spec docs | Yes |

> **Rule**: When a new command/skill is added, it is added to `src/templates/common/commands/` or `src/templates/common/skills/` — ALL platforms pick it up automatically via `resolveCommands()` / `resolveSkills()` / `resolveAllAsSkills()`. Check `src/templates/common/` as the reference source.

### Step 5: Template Extraction

| File | Change |
|------|--------|
| `src/templates/extract.ts` | Only needed if platform has a physical template directory. Most new platforms generate from `common/` templates and don't need extraction functions |

> Note: Platforms using `createTemplateReader(import.meta.url)` in their `index.ts` handle their own template reading. The `extract.ts` functions (`getTrellisSourcePath()`, `readTrellisFile()`, `copyTrellisDir()`) are primarily for the `.trellis/` workflow files, not platform templates.

### Step 6: Python Scripts (independent runtime)

> **Warning**: `cli_adapter.py` uses if/elif/else chains with NO exhaustive check. New platforms silently fall through to the `else` branch (Claude defaults). You MUST add explicit branches for **every method** listed below.

| File | Change |
|------|--------|
| `src/templates/trellis/scripts/common/cli_adapter.py` | Add to `Platform` literal type, `config_dir_name` property, `detect_platform()`, `get_cli_adapter()` validation |

**cli_adapter.py methods requiring explicit branches** (do NOT rely on `else` fallthrough):

| Method | What to decide | Example |
|--------|---------------|---------|
| `config_dir_name` | Config directory name | `".gemini"`, `".agent"` |
| `get_trellis_command_path()` | Command file path format | `.toml` vs `.md`, subdirectory vs flat |
| `get_non_interactive_env()` | Non-interactive env var | `{}` if none, or platform-specific |
| `build_run_command()` | CLI command for running agents | `["gemini", prompt]` or raise ValueError |
| `build_resume_command()` | CLI command for resuming sessions | `["gemini", "--resume", id]` or raise ValueError |
| `cli_name` | CLI executable name | `"gemini"`, `"agy"` |
| `detect_platform()` | Directory detection logic | Check `.gemini/` exists |
| `get_commands_path()` | Command directory structure | `commands/trellis/` or `workflows/` |

> Note: Python scripts run in user projects at runtime — they cannot import from the TS registry and maintain their own registry in `cli_adapter.py`.
>
> **Codex-specific CLIAdapter notes:**
> - `config_dir_name` returns `".codex"` (not `".agents"`)
> - `get_agent_path` returns `.toml` for codex (not `.md`)
> - `requires_agent_definition_file` is `False` — Codex auto-discovers agents from `.codex/agents/*.toml`, no `--agent` CLI flag
> - `detect_platform` checks `.codex/` existence (not `.agents/skills/`)
> - **CRITICAL**: Template copy (`src/templates/trellis/scripts/`) must be byte-identical to live copy (`.trellis/scripts/`)

### Step 7: Documentation

| File | Change |
|------|--------|
| `README.md` | Add platform to supported tools list |
| `README_CN.md` | Add platform to supported tools list (Chinese) |

### Step 8: Build Scripts

| File | Change |
|------|--------|
| `scripts/copy-templates.js` | No change needed (copies entire `src/templates/` directory) |

### Step 9: Project Config (Optional)

If Trellis project itself should support the new platform:

| Directory | Contents |
|-----------|----------|
| `.{platform}/` | Project's own config directory |
| `.{platform}/commands/trellis/` | Slash commands |
| `.{platform}/agents/` | Agents |
| `.{platform}/hooks/` | Hooks |
| `.{platform}/settings.json` | Settings |

### Step 10: Gitignore

| File | Change |
|------|--------|
| `.gitignore` | Add local config patterns (e.g., `{platform}.local.json`) |

### Step 11: Tests (MANDATORY)

> **Warning**: Dynamic iteration tests (e.g., `PLATFORM_IDS.forEach`) only verify registry metadata. They do NOT cover platform-specific runtime behavior. You MUST add explicit tests.

| Test File | What to Add |
|-----------|-------------|
| `test/templates/{platform}.test.ts` | **NEW FILE**: Verify `getAllCommands()`/`getAllSkills()`/`getAllWorkflows()` returns expected set, content non-empty, format valid |
| `test/configurators/platforms.test.ts` | Detection test: `getConfiguredPlatforms` finds `.{configDir}`. Configurator test: `configurePlatform` writes expected files, no compiled artifacts |
| `test/commands/init.integration.test.ts` | Init test: `init({ {platform}: true })` creates correct directory. Negative assertions: add `.{configDir}` checks to existing platform tests |
| `test/templates/extract.test.ts` | `get{Platform}TemplatePath()` returns existing dir. `get{Platform}SourcePath()` deprecated alias equals template path |
| `test/regression.test.ts` | Platform registration: `AI_TOOLS.{platform}` exists with correct `configDir`. cli_adapter: `commonCliAdapter` contains `"{platform}"` and `".{configDir}"`. Update `withTracking` list if `collectTemplates` is defined |

---

## What You DON'T Need to Update

These are now **automatically derived** from the registry:

| Previously hardcoded | Now derived from |
|---------------------|------------------|
| `BACKUP_DIRS` in update.ts | `ALL_MANAGED_DIRS` from `configurators/index.ts` |
| `TEMPLATE_DIRS` in template-hash.ts | `ALL_MANAGED_DIRS` from `configurators/index.ts` |
| `getConfiguredPlatforms()` in update.ts | `getConfiguredPlatforms()` from `configurators/index.ts` |
| `cleanupEmptyDirs()` whitelist in update.ts | `isManagedPath()` / `isManagedRootDir()` from `configurators/index.ts` |
| `collectTemplateFiles()` if/else in update.ts | `collectPlatformTemplates()` dispatch loop |
| `TOOLS[]` in init.ts | `getInitToolChoices()` from `configurators/index.ts` |
| Configurator dispatch in init.ts | `configurePlatform()` from `configurators/index.ts` |
| Windows Python detection in init.ts | `getPlatformsWithPythonHooks()` from `configurators/index.ts` |

---

## Command Format by Platform

| Platform | Command Format | File Format | Example (finish-work) |
|----------|---------------|-------------|-----------------------|
| Claude Code | `/trellis:xxx` | Markdown (`.md`) | `/trellis:finish-work` |
| Cursor | `/trellis-xxx` | Markdown (`.md`) | `/trellis-finish-work` |
| OpenCode | `/trellis:xxx` | Markdown (`.md`) | `/trellis:finish-work` |
| Gemini CLI | `/trellis:xxx` | TOML (`.toml`) | `/trellis:finish-work` |
| Kilo | `/<workflow-name>` | Markdown (`.md`) | `/finish-work` |
| Codex | `$<skill-name>` / `/skills` | Markdown (`SKILL.md`) | `$finish-work` |
| Kiro | `$<skill-name>` / `/skills` | Markdown (`SKILL.md`) | `$finish-work` |
| Qoder | `$<skill-name>` / `/skills` | Markdown (`SKILL.md`) | `$finish-work` |
| Antigravity | `/<workflow-name>` | Markdown (`.md`) | `/finish-work` |
| CodeBuddy | `/trellis:xxx` | Markdown (`.md`) | `/trellis:finish-work` |
| Copilot | `/trellis:xxx` | Markdown (`.prompt.md`) | `/trellis:finish-work` |
| Droid | `/trellis:xxx` | Markdown (`.md`) | `/trellis:finish-work` |
| Windsurf | `/trellis-xxx` | Markdown (`.md`) + `SKILL.md` | `/trellis-finish-work` |

When creating platform templates, ensure references match the platform's interaction format and file format.

## Command Set by Platform Capability

Commands emitted by `resolveCommands(ctx)` / `resolveAllAsSkills(ctx)` in `src/configurators/shared.ts`:

| Command | Agent-capable platforms (10) | Agent-less platforms (3) |
|---------|------------------------------|--------------------------|
| `start` | ❌ not emitted (hook/plugin injects workflow overview on session start) | ✅ emitted — manual equivalent of session-start hook |
| `continue` | ✅ emitted | ✅ emitted |
| `finish-work` | ✅ emitted | ✅ emitted |

**Rule**: filter is by `ctx.agentCapable`, not `hasHooks`. `agentCapable` is authoritative because it also correlates with "has a session-start mechanism" (Python hook or JS plugin).

- Agent-capable: `claude-code, cursor, opencode, codex, kiro, gemini, qoder, codebuddy, copilot, droid`
- Agent-less: `kilo, antigravity, windsurf`

## Subagent Context Injection: Hook-based vs Pull-based

Trellis sub-agents (implement / check / research) need task context (`prd.md` + spec files listed in `implement.jsonl` / `check.jsonl`) at startup. There are two delivery modes depending on the platform's hook capabilities:

### Mode A — Hook-inject (6 platforms)

Platform's PreToolUse-equivalent hook can fire on the sub-agent spawn tool AND modify the tool's prompt input. Trellis's `inject-subagent-context.py` (or OpenCode's plugin) reads `prd.md` + the JSONL-referenced spec files and rewrites the sub-agent's initial prompt.

| Platform | Hook event | Mechanism |
|---|---|---|
| Claude Code | `PreToolUse` + matcher `Task`/`Agent` | `updatedInput.prompt` |
| CodeBuddy | `PreToolUse` + matcher `Task` | `modifiedInput.prompt` (same as Claude) |
| Cursor | `preToolUse` + matcher `Task` | `updated_input.prompt` (fixed 2026-04-07) |
| Factory Droid | `PreToolUse` + matcher `Task` | `updatedInput.prompt` |
| Kiro | per-agent `agentSpawn` hook | direct stdout context |
| OpenCode | JS plugin `tool.execute.before` | `args.prompt` mutation |

### Mode B — Pull-based (4 platforms)

Platform's hook either doesn't expose a sub-agent spawn event or can't modify the prompt. Sub-agents must Read context themselves at startup. Trellis injects a "Required: Load Trellis Context First" prelude into each sub-agent definition file.

| Platform | Why hook-inject is unavailable |
|---|---|
| Gemini CLI | `BeforeTool` fires but [#18128](https://github.com/google-gemini/gemini-cli/issues/18128) hides chain-of-thought; reliability margin too thin |
| Qoder | No `Task` tool concept; `SubagentStart` input has no `prompt` field; Context Isolation |
| Codex | `PreToolUse` only fires for Bash; `CollabAgentSpawn` hook unimplemented ([#15486](https://github.com/openai/codex/issues/15486)) |
| Copilot | `preToolUse` doesn't enforce on subagents ([#2392](https://github.com/github/copilot-cli/issues/2392), [#2540](https://github.com/github/copilot-cli/issues/2540)) |

### Implementation

Pull-based prelude is injected by `injectPullBasedPreludeMarkdown()` / `injectPullBasedPreludeToml()` in `src/configurators/shared.ts`. Each pull-based platform's configurator:

1. Calls `writeSharedHooks(dir, { exclude: ["inject-subagent-context.py"] })` — no inject hook installed
2. Calls `detectSubAgentType(name)` → `injectPullBasedPrelude*()` on every sub-agent definition before writing

Hook-inject platforms keep using `writeSharedHooks(dir)` and their hook-config JSON references `inject-subagent-context.py` as before.

### Audit reference

Full reliability audit (per-platform evidence, GitHub issues, Cursor staff confirmations, Claude Code canary test) lives at:
`.trellis/tasks/04-17-subagent-hook-reliability-audit/research/platform-hook-audit.md`

---

## Workflow Step Detail Loading

`.trellis/workflow.md` contains per-phase step detail under `#### X.X` headings, with per-platform variants demarcated by `[Platform Name, ...]` … `[/Platform Name, ...]` blocks.

Load step detail on demand (both commands and hooks use this):

```bash
python3 ./.trellis/scripts/get_context.py --mode phase                                   # Phase Index (no --step)
python3 ./.trellis/scripts/get_context.py --mode phase --step 1.1                        # Step 1.1 (all platforms)
python3 ./.trellis/scripts/get_context.py --mode phase --step 1.2 --platform cursor      # Step 1.2, cursor-filtered
```

Platform markers are filtered by matching `[...]` block membership against the given platform name (case-insensitive; accepts `claude-code` and `Claude Code`). Lines outside any marker block are always kept.

---

## Windows Encoding Fix

All hook scripts that output to stdout must include the Windows encoding fix:

```python
# IMPORTANT: Force stdout to use UTF-8 on Windows
# This fixes UnicodeEncodeError when outputting non-ASCII characters
if sys.platform == "win32":
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(sys.stdout.detach(), encoding="utf-8", errors="replace")  # type: ignore[union-attr]
```

---

## SessionStart Hook: additionalContext Size Constraint

### Constraint

Claude Code truncates `hookSpecificOutput.additionalContext` at **~20 KB**. When exceeded, only a ~2 KB preview is shown and the full payload is written to a fallback file (`tool-results/hook-*-additionalContext.txt`). AI agents do **not** proactively read the fallback file, so any content past the preview is effectively invisible.

Codex has even tighter limits — users report 40-80 KB payloads consuming most of the context window on large projects.

### Size Budget (measured on Trellis dev repo)

| Block | Size | Notes |
|---|---:|---|
| `<session-context>` | 0.1 KB | Fixed |
| `<current-state>` | 2.3 KB | Grows with tasks/git state |
| `<workflow>` | 9.5 KB | TOC + Phase Index + Phase 1/2/3 step bodies. Meta sections (Core Principles / Trellis System / Breadcrumbs) excluded — they are either short prose Readable on demand or consumed by other hooks |
| `<guidelines>` | 4.6 KB | `guides/index.md` inlined + paths-only for other indexes |
| `<task-status>` | 0.2 KB | Fixed |
| `<ready>` | 0.3 KB | Fixed |
| **Total** | **16.7 KB** | **Under 20 KB ✓** |

Historical note: pre-workflow-rewrite (v0.4.0-beta.10) the payload included a 16 KB `<instructions>` block (start.md content). That block was removed — start.md is now only sent as the `/start` command body for agent-less platforms (Kilo/Antigravity/Windsurf); agent-capable platforms get workflow overview via `<workflow>` instead.

### Guidelines: Paths-only vs Inline

Before: every `.trellis/spec/*/index.md` was inlined in `<guidelines>` (10 KB+ on this repo). Main agent rarely uses index content (work is delegated to sub-agents, which get their own specific specs via `{task}/implement.jsonl` / `check.jsonl`).

Now: paths only for most indexes; `guides/index.md` (cross-package thinking guides) stays inlined because it's small and applies broadly. When main agent edits code directly, it Reads the relevant index on demand.

### Design Decision: Inject Instructions, Not Reference Content

**Context**: session-start.py injected both `workflow.md` (~12 KB reference) and `start.md` (~11 KB instructions), totaling ~29 KB on vanilla — always truncated.

**Decision**: Remove `workflow.md` full injection. Keep `start.md` injection because:

1. `start.md` is **imperative** (step-by-step instructions the AI follows) — must be in context to be effective
2. `workflow.md` is **reference** (principles, file structure, best practices) — `start.md` Step 1 tells AI to `cat .trellis/workflow.md`, so it's accessed on-demand
3. Other slash commands (`brainstorm`, `finish-work`, `check`) are not pre-injected — this restores symmetry

**Rule**: When adding content to session-start, prefer pointers over full injection for reference material. Reserve inline injection for actionable instructions the AI must follow immediately.

### Gotcha: `<guidelines>` Is the Next Growth Risk

On the Trellis dev repo (light use), `<guidelines>` is 10.8 KB vs 5.1 KB on vanilla — it grows linearly with spec `index.md` file count. Combined with `<instructions>` (16.1 KB), a project with many spec layers can still exceed 20 KB. Monitor this and consider the same lazy-load pattern for guidelines if it becomes a problem.

---

## Workflow State Injection: Per-Turn Breadcrumb

### Problem

`SessionStart` only fires once per session. In long conversations, Claude's context compression can push the SessionStart message out of recent context, and the AI forgets the active Trellis task — resulting in workflow drift (skips `check`, forgets to `update-spec`, doesn't return to `finish` after user interruptions).

### Solution: `UserPromptSubmit` hook injecting per-turn breadcrumb

A lightweight hook (`shared-hooks/inject-workflow-state.py`) fires on **every user prompt**, emitting a short `<workflow-state>` block reminding the AI of the active task + expected flow. Sub-200-byte payload, no perceptible latency.

### Single Source of Truth: `workflow.md` Tag Blocks

Breadcrumb text lives in `workflow.md` as `[workflow-state:STATUS]...[/workflow-state:STATUS]` blocks (same tag style as existing `[Platform, ...]` blocks). Users who fork the Trellis workflow edit **only the markdown**; the hook script stays untouched.

```markdown
[workflow-state:in_progress]
Flow: implement → check → update-spec → finish
Check conversation history + git status to determine current step; do NOT skip check.
[/workflow-state:in_progress]
```

STATUS matches `task.json.status`. Built-in: `planning` / `in_progress` / `completed`. Custom statuses (including hyphenated like `in-review`) are recognized — STATUS regex is `[A-Za-z0-9_-]+`.

### Fallback Strategy (hook never crashes)

1. `workflow.md` missing → hardcoded defaults for 3 built-in statuses
2. Tag block missing for a status → same hardcoded default
3. Status unknown (no tag, no default) → generic `"Refer to workflow.md for current step."`
4. No active task (`.current-task` missing or empty) → emit `no_task` pseudo-status breadcrumb instead of silent-exit. Header is `Status: no_task`; body nudges AI to load `trellis-brainstorm` + `task.py create` for multi-step work (or answer directly for trivial asks).

### Design Principle: Per-Turn Hooks Must Not Silent-Exit on "Nothing to Say"

A hook whose job is to **re-ground the AI every turn** should always emit *something*. Silent-exit looks cheaper but defeats the whole purpose — the turn where there's "nothing" is often the most important one (e.g. user switches topics, hops into a fresh subject without an active task).

**Wrong** — hook exits silently when `.current-task` is missing:
```python
task = get_active_task(root)
if task is None:
    return 0  # nothing to inject; goodbye
```
Net effect on a "no task" session: AI sees the Next-Action only at SessionStart; after 20 turns of context compression, the guidance is gone and AI forgets to use `trellis-brainstorm` for new multi-step requests.

**Correct** — treat "no task" as its own pseudo-status with a dedicated breadcrumb template:
```python
task = get_active_task(root)
if task is None:
    breadcrumb = build_breadcrumb(task_id=None, status="no_task", templates=...)
else:
    breadcrumb = build_breadcrumb(*task, templates=...)
```

The same rule applies to every other hook that's positioned as "repeated reminder": if the hook isn't emitting, the reminder loop is broken. The only legitimate silent-exit case is when **the hook doesn't own this codebase at all** (e.g. `.trellis/` not found → definitely not a Trellis project → OK to no-op).

### Platform Support Matrix

| Platform | Event | Config File | Notes |
|---|---|---|---|
| Claude Code | `UserPromptSubmit` | `.claude/settings.json` | Auto-distributes via `writeSharedHooks()` |
| Cursor | `beforeSubmitPrompt` | `.cursor/hooks.json` | Auto |
| Qoder | `UserPromptSubmit` | `.qoder/settings.json` | Auto |
| CodeBuddy | `UserPromptSubmit` | `.codebuddy/settings.json` | Auto |
| Droid (Factory) | `UserPromptSubmit` | `.factory/settings.json` | Auto |
| Gemini CLI | `UserPromptSubmit` | `.gemini/settings.json` | Auto |
| Copilot CLI | `userPromptSubmitted` (camelCase) | `.github/copilot/hooks.json` | `bash` + `powershell` dual field |
| Codex | `UserPromptSubmit` | `.codex/hooks.json` | **Requires `features.codex_hooks = true` in user's `~/.codex/config.toml`** — without this flag, hooks never fire |
| OpenCode | `chat.message` (Bun plugin) | `plugins/inject-workflow-state.js` | Equivalent JS implementation |
| Kiro | ⚠️ Not supported | n/a | Kiro's only hook is `agentSpawn` (sub-agent lifecycle). No per-turn main-conversation hook exists; awaiting upstream. Sub-agent context injection still works via shared-hooks `inject-subagent-context.py` |

### CWD Robustness

The hook uses `find_trellis_root()` to walk up from CWD until it finds `.trellis/`, so it works when the terminal is in a subdirectory (monorepo package, etc.) or when sub-agent spawn inherits a drifted CWD.

### Why No State Machine / No Extra `task.json` Fields

After first-principles analysis (see `.trellis/tasks/04-17-workflow-enforcement-v2/prd.md`), we dropped the original design's `current_phase` string / `phase_history` / `checkpoints` / 7 new `task.py` commands / skill tail blocks. The core insight: **workflow.md Phase 1.0/1.1/... is documentation layering, not runtime state**. The existing `task.json.status` (`planning` / `in_progress` / `completed`) is sufficient to express task lifecycle; sub-phase position is inferred by the AI from conversation history + git state.

This keeps state minimal, avoids the "task.json drifts from filesystem reality" class of bugs, and is trivially customizable — users modify one markdown file, not Python/TypeScript.

---

## Common Mistakes

### Forgot to add entry to PLATFORM_FUNCTIONS

**Symptom**: `trellis init` configures the platform, but `trellis update` doesn't track its template files.

**Fix**: Add entry with `collectTemplates` function to `PLATFORM_FUNCTIONS` in `src/configurators/index.ts`.

### Missing platform in cli_adapter.py

**Symptom**: Python scripts fail with "Unsupported platform" error.

**Fix**: Add platform to `Platform` literal type, `config_dir_name` property, and `get_cli_adapter()` validation in `cli_adapter.py`.

### Wrong command format in templates

**Symptom**: Slash commands don't work or show wrong format.

**Fix**: Check platform's command format and update all command references in templates.

### Codex template copied from project `.agents/skills` instead of `src/templates`

**Symptom**: Generated templates accidentally include repo-specific customizations and drift from template source-of-truth.

**Fix**: Always use `src/templates/{platform}/...` as source templates for `init/update`. Do not copy from project runtime directories.

### Codex skill directory exists but `SKILL.md` is missing

**Symptom**: Template loading fails with `ENOENT` when scanning skills.

**Fix**: Keep `src/templates/codex/skills/<skill-name>/SKILL.md` complete; when removing a skill, delete both `SKILL.md` and the directory.

### EXCLUDE_PATTERNS missing `.js` in configurator

**Symptom**: In production builds (`dist/`), `trellis init` copies compiled `index.js` (and `.js.map`, `.d.ts`) into the user's config directory (e.g., `.gemini/index.js`).

**Cause**: The configurator's `EXCLUDE_PATTERNS` doesn't filter out `.js` files. In development (`src/`), only `.ts` files exist so the issue is invisible. In production, `tsc` compiles `index.ts` → `index.js` into `dist/templates/{platform}/`, and `copyDirFiltered` copies it.

**Fix**: Ensure `EXCLUDE_PATTERNS` includes `.js`, `.js.map`, `.d.ts`, `.d.ts.map` — matching the Cursor configurator pattern. The Claude configurator correctly excludes these; copy from there.

**Prevention**: When creating a new configurator, copy the full `EXCLUDE_PATTERNS` from an existing one (e.g., `cursor.ts`), don't write from scratch.

### Missing CLI flag or InitOptions field

**Symptom**: `trellis init --{platform}` doesn't work.

**Fix**: Add `--{platform}` option in `src/cli/index.ts` and `{platform}?: boolean` in `InitOptions` in `src/commands/init.ts`. These are static declarations that cannot be derived from the registry.

### Template placeholder not resolved in collectTemplates

**Symptom**: `trellis update` auto-updates platform files on every run, even when nothing changed. The update summary shows hooks/settings as "changed".

**Cause**: `configurePlatform()` resolves `{{PYTHON_CMD}}` to `python3`/`python` when writing files during init, but `collectPlatformTemplates()` returns raw templates with `{{PYTHON_CMD}}` unresolved. The hash comparison sees them as different.

**Fix**: Apply `resolvePlaceholders()` (from `configurators/shared.ts`) in the `collectTemplates` lambda in `PLATFORM_FUNCTIONS`. Any new placeholder added to templates must be resolved in **both** `configure()` and `collectTemplates()`.

### Template listed in update but not created by init

**Symptom**: `trellis update` always detects a "new file" to add, even on a freshly initialized project with the same version.

**Cause**: `collectTemplateFiles()` in `update.ts` lists a file that `createSpecTemplates()` / `createWorkflowStructure()` in init never creates. The two template lists are out of sync.

**Fix**: Ensure every file listed in `collectTemplateFiles()` is actually created during `init`. If a file is project-specific (not a user template), do not include it in the update template list.

### Project-type-conditional content not gated in init or update

**Symptom**: Pure backend project gets empty frontend spec templates after `trellis init`. After user deletes the unwanted `spec/frontend/` dir, `trellis update` recreates it.

**Cause (init)**: `createSpecTemplates()` in `workflow.ts` received `projectType` but ignored it (parameter named `_projectType`). All project types got both backend and frontend spec dirs.

**Cause (update)**: `collectTemplateFiles()` in `update.ts` unconditionally included all 13 backend + frontend spec files in the template map, without checking whether `spec/backend/` or `spec/frontend/` actually existed on disk.

**Fix (init)**: Use `projectType` to conditionally create spec dirs:
- `"backend"` → guides + backend only
- `"frontend"` → guides + frontend only
- `"fullstack"` / `"unknown"` → guides + both

**Fix (update)**: Wrap backend/frontend spec file blocks in `fs.existsSync()` checks (same pattern as `getConfiguredPlatforms()` for platform dirs).

**Rule**: When init creates content conditionally based on project type, update must check for directory existence before including files in its template map. The two paths must agree.

### PRD assumed platform capabilities without research

**Symptom**: Implementation builds the wrong abstraction (e.g., commands instead of skills, or vice versa). Requires major rework after discovery.

**Cause**: PRD was written based on assumptions about how a platform works (e.g., "Trae uses commands like Kilo") without verifying against official documentation or GitHub repos.

**Fix**: Before writing the PRD for a new platform, research the platform's actual extension mechanism:
- Check official docs for supported formats (skills, commands, rules, workflows)
- Check the platform's GitHub repo for directory structure conventions
- Verify how users invoke extensions (slash command, AI-automatic matching, manual mention)

**Prevention**: Add a "Research" step before PRD finalization. The PRD should cite sources for platform capability claims.

### Updated command/skill content in platform template instead of common/

**Symptom**: After updating a command in one platform's template, other platforms still use old content.

**Cause**: Since v0.5.0, command and skill content lives in `src/templates/common/` as the single source of truth. Editing platform-specific copies creates drift.

**Fix**: Always edit templates in `src/templates/common/commands/` or `src/templates/common/skills/`. All platforms derive their content from there via `resolveCommands()` / `resolveSkills()` / `resolveAllAsSkills()`.

### Stale platform references in copied templates

**Symptom**: A Qoder skill references "Claude Code" syntax or a Kiro-specific invocation pattern.

**Cause**: When creating agent templates for a new platform by copying from an existing one, platform-specific references (command syntax, platform names, invocation instructions) weren't updated.

**Fix**: After copying agent templates, search-and-replace all references to the source platform. Check for:
- Platform name mentions (e.g., "Claude Code", "Kiro")
- Command invocation syntax (e.g., `/trellis:xxx` vs `$skill-name`)
- Config directory references (e.g., `.claude/` vs `.qoder/`)

### Forgot to use shared hooks

**Symptom**: Platform's hooks directory contains duplicated Python scripts instead of using `writeSharedHooks()`.

**Cause**: When adding a new agent-capable platform, developer manually copied hook scripts from another platform instead of calling `writeSharedHooks(hooksDir)` from `shared.ts`.

**Fix**: Use `writeSharedHooks()` which copies platform-independent scripts from `src/templates/shared-hooks/`. Only create platform-specific hook files when the platform has unique hook integration points (e.g., Claude Code).

### Hardcoded JSONL fallback paths

**Symptom**: Agent definitions reference JSONL files that don't exist (e.g., `debug.jsonl`, `plan.jsonl`).

**Cause**: Only `implement.jsonl` and `check.jsonl` exist as task JSONL files. Agent templates were copied from older versions that referenced removed JSONL types.

**Fix**: Ensure agent `.md` definitions only reference `implement.jsonl` and `check.jsonl`. The debug, plan, and dispatch agents have been removed.

### `__pycache__` in template hooks directory causes EISDIR crash

**Symptom**: Tests fail with `EISDIR: illegal operation on a directory, read` in `getAllHooks()` at `src/templates/claude/index.ts`.

**Cause**: Running a Python hook locally (e.g., `python3 session-start.py` for testing) creates `__pycache__/` inside `src/templates/{platform}/hooks/`. `listFiles("hooks")` returns `__pycache__` as an entry, then `readFileSync("hooks/__pycache__")` fails because it's a directory.

**Fix**: `rm -rf src/templates/*/hooks/__pycache__`. Consider adding `__pycache__` to `.gitignore` or filtering directories in `listFiles()`.

**Prevention**: Don't run Python hooks directly from `src/templates/` during development. Use `/tmp` copies or the installed project copy instead.

---

## Reference PRs

| PR | Platform | Pattern | Notes |
|----|----------|---------|-------|
| feat/gemini branch | Gemini CLI | Agents + shared hooks | First non-Markdown command format (TOML settings) |
| main | Antigravity | Workflows (derived from Codex) | No physical templates — runtime adaptation from Codex skills |
| #71 | Qoder | Skills (like Codex/Kiro) | Skills with YAML frontmatter; Trae was dropped (IDE-only, no deterministic invocation trigger) |
| feat/v0.5.0-beta | All 13 platforms | Unified template architecture | Common templates + shared hooks + `createTemplateReader()` factory |
