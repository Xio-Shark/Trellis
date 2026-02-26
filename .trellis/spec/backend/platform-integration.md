# Platform Integration Guide

How to add support for a new AI CLI platform (like Claude Code, Cursor, Gemini CLI, OpenCode, iFlow, Codex, Kilo, Kiro).

---

## Architecture

Platform support uses a **centralized registry pattern** (similar to Turborepo's package manager support):

- **Data registry**: `src/types/ai-tools.ts` — `AI_TOOLS` record with all platform metadata
- **Function registry**: `src/configurators/index.ts` — `PLATFORM_FUNCTIONS` with configure/collectTemplates per platform
- **Shared utilities**: `src/configurators/shared.ts` — `resolvePlaceholders()` used by both init and update paths
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

**Standard pattern** (Python hooks — like Claude, iFlow):

| Directory | Contents |
|-----------|----------|
| `src/templates/{platform}/` | Root directory |
| `src/templates/{platform}/index.ts` | Export functions for commands, agents, hooks, settings |
| `src/templates/{platform}/commands/trellis/` | Slash commands (`.md` files) |
| `src/templates/{platform}/agents/` | Agent definitions (`.md` files) |
| `src/templates/{platform}/hooks/` | Hook scripts (`.py` files) |
| `src/templates/{platform}/settings.json` | Platform settings (may use `{{PYTHON_CMD}}` placeholder) |

**JS plugin pattern** (like OpenCode):

| Directory | Contents |
|-----------|----------|
| `src/templates/{platform}/` | Root directory |
| `src/templates/{platform}/commands/trellis/` | Slash commands (`.md` files) |
| `src/templates/{platform}/plugin/` | JS plugin files |
| `src/templates/{platform}/lib/` | JS library files |
| `src/templates/{platform}/package.json` | Plugin dependencies |

> Note: OpenCode uses JS plugins instead of Python hooks, has no `index.ts` template module, and has no `collectTemplates` — so `trellis update` does not track OpenCode template files. If a new platform uses JS plugins, follow this pattern.

**Skills pattern** (Codex, Kiro):

| Directory | Contents |
|-----------|----------|
| `src/templates/{platform}/` | Root directory |
| `src/templates/{platform}/index.ts` | Export functions for listing skills |
| `src/templates/{platform}/skills/<skill-name>/SKILL.md` | Skill definitions |

> Note: Codex/Kiro use skills (not slash commands). Skill content should use `$<skill-name>` / `/skills` semantics, not `/trellis:*` syntax.

**Commands-only pattern** (Cursor, Kilo):

| Directory | Contents |
|-----------|----------|
| `src/templates/{platform}/` | Root directory |
| `src/templates/{platform}/index.ts` | Export `getAllCommands(): CommandTemplate[]` |
| `src/templates/{platform}/commands/` or `commands/trellis/` | Slash commands (`.md` files) |

> Note: Cursor uses flat prefix naming (`trellis-start.md` → `/trellis-start`). Kilo uses subdirectory namespacing (`commands/trellis/start.md` → `/trellis:start`). No hooks, no agents, no settings.

**TOML commands pattern** (Gemini CLI):

| Directory | Contents |
|-----------|----------|
| `src/templates/{platform}/` | Root directory |
| `src/templates/{platform}/index.ts` | Export `getAllCommands(): CommandTemplate[]` (filter `.toml` not `.md`) |
| `src/templates/{platform}/commands/trellis/` | Slash commands (`.toml` files) |

> Note: Gemini CLI is the first platform using TOML for commands instead of Markdown. TOML format: `description = "..."` + `prompt = """..."""`. Subdirectory namespacing works the same as Claude (`commands/trellis/start.toml` → `/trellis:start`). When creating TOML templates, use triple-quoted strings (`"""`) for multi-line prompts.

**Required commands/skills**: All platforms must include the following (adapted to each platform's format):

| Command | Purpose | Required |
|---------|---------|----------|
| `start` | Session initialization | Yes |
| `finish-work` | Pre-commit checklist | Yes |
| `brainstorm` | Requirements discovery | Yes |
| `break-loop` | Post-debug analysis | Yes |
| `record-session` | Session recording | Yes |
| `before-backend-dev` | Read backend guidelines | Yes |
| `before-frontend-dev` | Read frontend guidelines | Yes |
| `check-backend` | Check backend code quality | Yes |
| `check-frontend` | Check frontend code quality | Yes |
| `check-cross-layer` | Cross-layer verification | Yes |
| `create-command` | Create new slash command | Yes |
| `integrate-skill` | Integrate external skill | Yes |
| `onboard` | Team onboarding guide | Yes |
| `update-spec` | Update code-spec docs | Yes |
| `parallel` | Multi-agent parallel work | Optional (platform capability) |
| `migrate-specs` | Migrate spec versions | Optional |

> **Rule**: When a new command is added to any platform, it must be added to ALL platforms. Check `src/templates/claude/commands/trellis/` as the reference list.

### Step 5: Template Extraction

| File | Change |
|------|--------|
| `src/templates/extract.ts` | Add `get{Platform}TemplatePath()` function + `get{Platform}SourcePath()` deprecated alias |

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
| `src/templates/trellis/scripts/common/registry.py` | Update default platform if needed |
| `src/templates/trellis/scripts/multi_agent/plan.py` | Add to `--platform` choices (only if this platform supports multi-agent runtime) |
| `src/templates/trellis/scripts/multi_agent/start.py` | Add to `--platform` choices (only if this platform supports multi-agent runtime) |
| `src/templates/trellis/scripts/multi_agent/status.py` | Add platform-specific behavior if needed (only if supported) |

> Note: Python scripts run in user projects at runtime — they cannot import from the TS registry and maintain their own registry in `cli_adapter.py`.
>
> Current scope for Codex integration: common scripts + `task.py` context path mapping. Multi-agent runtime (`multi_agent/*.py`) is intentionally out of scope.

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

| Platform | Command Format | File Format | Example |
|----------|---------------|-------------|---------|
| Claude Code | `/trellis:xxx` | Markdown (`.md`) | `/trellis:start` |
| Cursor | `/trellis-xxx` | Markdown (`.md`) | `/trellis-start` |
| OpenCode | `/trellis:xxx` | Markdown (`.md`) | `/trellis:start` |
| iFlow | `/trellis:xxx` | Markdown (`.md`) | `/trellis:start` |
| Gemini CLI | `/trellis:xxx` | TOML (`.toml`) | `/trellis:start` |
| Kilo | `/trellis:xxx` | Markdown (`.md`) | `/trellis:start` |
| Codex | `$<skill-name>` / `/skills` | Markdown (`SKILL.md`) | `$start` |
| Kiro | `$<skill-name>` / `/skills` | Markdown (`SKILL.md`) | `$start` |

When creating platform templates, ensure references match the platform's interaction format and file format.

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

### iFlow getAllCommands() reads wrong directory level (known gap)

**Symptom**: `trellis update` tracks zero iFlow commands — commands are correctly copied during `init` but not tracked for update diffs.

**Cause**: iFlow `getAllCommands()` calls `listFiles("commands")` which returns `["trellis"]` (a directory, not `.md` files). Claude's version correctly reads `listFiles("commands/trellis")`.

**Impact**: Low — iFlow commands are still correctly installed during `init` (recursive directory copy). They just won't be updated by `trellis update` if templates change.

---

## Reference PRs

| PR | Platform | Pattern | Notes |
|----|----------|---------|-------|
| #22 | iFlow CLI | Standard (hooks + agents) | Full platform with Python hooks |
| feat/gemini branch | Gemini CLI | TOML commands-only | First non-Markdown command format, Cursor-level minimal |
