# Directory Structure

> How backend/CLI code is organized in this project.

---

## Overview

This project is a **TypeScript CLI tool** using ES modules. The source code follows a **dogfooding architecture** - Trellis uses its own configuration files (`.cursor/`, `.claude/`, `.trellis/`) as templates for new projects.

---

## Directory Layout

```
src/
├── cli/                 # CLI entry point and argument parsing
│   └── index.ts         # Main CLI entry (Commander.js setup)
├── commands/            # Command implementations
│   └── init.ts          # Each command in its own file
├── configurators/       # Configuration generators
│   ├── index.ts         # Platform registry (PLATFORM_FUNCTIONS, derived helpers)
│   ├── shared.ts        # Shared utilities (resolvePlaceholders, writeSkills, writeAgents, writeSharedHooks)
│   ├── antigravity.ts   # Antigravity configurator
│   ├── claude.ts        # Claude Code configurator
│   ├── codebuddy.ts     # CodeBuddy configurator
│   ├── codex.ts         # Codex configurator
│   ├── copilot.ts       # Copilot configurator
│   ├── cursor.ts        # Cursor configurator
│   ├── droid.ts         # Droid configurator
│   ├── gemini.ts        # Gemini CLI configurator
│   ├── kilo.ts          # Kilo configurator
│   ├── kiro.ts          # Kiro configurator
│   ├── opencode.ts      # OpenCode configurator
│   ├── qoder.ts         # Qoder configurator
│   ├── windsurf.ts      # Windsurf configurator
│   └── workflow.ts      # Creates .trellis/ structure
├── constants/           # Shared constants and paths
│   └── paths.ts         # Path constants (centralized)
├── templates/           # Template utilities and platform templates
│   ├── template-utils.ts # createTemplateReader() factory — eliminates boilerplate
│   ├── extract.ts       # Template extraction utilities (.trellis/ files)
│   ├── common/          # Single source of truth for commands + skills
│   │   ├── commands/    # Slash commands (start.md, finish-work.md)
│   │   ├── skills/      # Auto-triggered skills (before-dev, brainstorm, check, break-loop, update-spec)
│   │   └── index.ts     # getCommandTemplates(), getSkillTemplates()
│   ├── shared-hooks/    # Platform-independent Python hook scripts
│   │   ├── index.ts     # getSharedHookScripts()
│   │   ├── session-start.py
│   │   ├── inject-subagent-context.py
│   │   └── statusline.py
│   ├── claude/          # Claude Code templates (agents, hooks, settings)
│   ├── codebuddy/       # CodeBuddy templates (agents, settings)
│   ├── codex/           # Codex templates (agents, hooks.json)
│   ├── copilot/         # Copilot templates (prompts, hooks, hooks.json)
│   ├── cursor/          # Cursor templates (agents, hooks.json)
│   ├── droid/           # Droid templates (droids, settings)
│   ├── gemini/          # Gemini templates (agents, settings)
│   ├── kiro/            # Kiro templates (agents as JSON)
│   ├── opencode/        # OpenCode templates (agents, plugin, lib)
│   ├── qoder/           # Qoder templates (agents, settings)
│   ├── markdown/        # Generic markdown templates
│   │   ├── spec/        # Spec templates (*.md.txt)
│   │   ├── agents.md    # Project root file template
│   │   └── index.ts     # Template exports
│   └── trellis/         # .trellis/ workflow templates (scripts, workflow.md)
├── types/               # TypeScript type definitions
│   └── ai-tools.ts      # AI tool types and registry
├── utils/               # Shared utility functions
│   ├── compare-versions.ts # Semver comparison with prerelease support
│   ├── file-writer.ts   # File writing with conflict handling
│   ├── project-detector.ts # Project type detection
│   ├── template-fetcher.ts # Remote template download from GitHub
│   └── template-hash.ts # Template hash tracking for update detection
└── index.ts             # Package entry point (exports public API)
```

### Dogfooding Directories (Project Root)

These directories are copied to `dist/` during build and used as templates:

```
.cursor/                 # Cursor configuration (dogfooded)
├── commands/            # Slash commands for Cursor
│   ├── start.md
│   ├── finish-work.md
│   └── ...

.claude/                 # Claude Code configuration (dogfooded)
├── commands/            # Slash commands
├── agents/              # Multi-agent pipeline agents
├── hooks/               # Context injection hooks
└── settings.json        # Hook configuration

.trellis/                # Trellis workflow (partially dogfooded)
├── scripts/             # Python scripts (dogfooded)
│   ├── common/          # Shared utilities (paths.py, developer.py, cli_adapter.py, etc.)
│   ├── hooks/           # Lifecycle hook scripts (project-specific, NOT dogfooded)
│   └── *.py             # Main scripts (task.py, get_context.py, etc.)
├── workspace/           # Developer progress tracking
│   └── index.md         # Index template (dogfooded)
├── spec/                # Project guidelines (NOT dogfooded)
│   ├── cli/             # CLI package specs (backend/, unit-test/)
│   ├── docs-site/       # Docs package specs (docs/)
│   └── guides/          # Thinking guides
├── workflow.md          # Workflow documentation (dogfooded)
└── .gitignore           # Git ignore rules (dogfooded)
```

---

## Dogfooding Architecture

### What is Dogfooded

Files that are copied directly from Trellis project to user projects:

| Source | Destination | Description |
|--------|-------------|-------------|
| `.cursor/` | `.cursor/` | Entire directory copied |
| `.claude/` | `.claude/` | Entire directory copied |
| `.trellis/scripts/` | `.trellis/scripts/` | All scripts copied |
| `.trellis/workflow.md` | `.trellis/workflow.md` | Direct copy |
| `.trellis/.gitignore` | `.trellis/.gitignore` | Direct copy |
| `.trellis/workspace/index.md` | `.trellis/workspace/index.md` | Direct copy |

### What is NOT Dogfooded

Files that use generic templates (in `src/templates/`):

| Template Source | Destination | Reason |
|----------------|-------------|--------|
| `src/templates/markdown/spec/**/*.md.txt` | `.trellis/spec/**/*.md` | User fills with project-specific content |
| `src/templates/markdown/agents.md` | `AGENTS.md` | Project root file |

### Build Process

```bash
# scripts/copy-templates.js copies dogfooding sources to dist/
pnpm build

# Result:
dist/
├── .cursor/           # From project root .cursor/
├── .claude/           # From project root .claude/
├── .trellis/          # From project root .trellis/ (filtered)
│   ├── scripts/       # All scripts (no multi_agent/)
│   ├── workspace/
│   │   └── index.md   # Only index.md, no developer subdirs
│   ├── workflow.md
│   └── .gitignore
└── templates/         # From src/templates/ (no .ts files)
    ├── common/        # Shared command + skill templates
    ├── shared-hooks/  # Platform-independent hook scripts
    ├── claude/        # Claude-specific templates
    ├── {platform}/    # Other platform templates
    └── markdown/
        └── spec/      # Generic spec templates
```

---

## Module Organization

### Layer Responsibilities

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| CLI | `cli/` | Parse arguments, display help, call commands |
| Commands | `commands/` | Implement CLI commands, orchestrate actions |
| Configurators | `configurators/` | Copy/generate configuration for tools |
| Templates | `templates/` | Extract template content, provide utilities |
| Types | `types/` | TypeScript type definitions |
| Utils | `utils/` | Reusable utility functions |
| Constants | `constants/` | Shared constants (paths, names) |

### Configurator Pattern

Configurators use `cpSync` for direct directory copy (dogfooding):

```typescript
// configurators/cursor.ts
export async function configureCursor(cwd: string): Promise<void> {
  const sourcePath = getCursorSourcePath(); // dist/.cursor/ or .cursor/
  const destPath = path.join(cwd, ".cursor");
  cpSync(sourcePath, destPath, { recursive: true });
}
```

### Template Extraction

`extract.ts` provides utilities for reading dogfooded files:

```typescript
// Get path to .trellis/ (works in dev and production)
getTrellisSourcePath(): string

// Read file from .trellis/
readTrellisFile(relativePath: string): string

// Copy directory from .trellis/ with executable scripts
copyTrellisDir(srcRelativePath: string, destPath: string, options?: { executable?: boolean }): void
```

---

## Naming Conventions

### Files and Directories

| Convention | Example | Usage |
|------------|---------|-------|
| `kebab-case` | `file-writer.ts` | All TypeScript files |
| `kebab-case` | `multi-agent/` | All directories |
| `*.ts` | `init.ts` | TypeScript source files |
| `*.md.txt` | `index.md.txt` | Template files for markdown |

### Why `.txt` Extension for Templates

Templates use `.txt` extension to:
- Prevent IDE markdown preview from rendering templates
- Make clear these are template sources, not actual docs
- Avoid confusion with actual markdown files

---

## Monorepo Detection (`project-detector.ts`)

### `detectMonorepo(cwd)` Flow

Detects monorepo workspace configuration and enumerates packages. Returns `DetectedPackage[]` or `null`.

**Return value semantics**:

| Return | Meaning |
|--------|---------|
| `null` | Not a monorepo (no workspace config or `.gitmodules` found) |
| `[]` (empty array) | Monorepo config exists (e.g., `pnpm-workspace.yaml`) but no packages match on disk |
| `[...]` (populated array) | Monorepo with detected packages |

**Detection priority** (checked in order, results merged):

1. `.gitmodules` — parsed first to build a submodule path set
2. `pnpm-workspace.yaml` — `packages:` list
3. `package.json` `workspaces` — array or `{packages: [...]}` (npm/yarn/bun)
4. `Cargo.toml` `[workspace]` — `members` minus `exclude`
5. `go.work` — `use` directives (block and single-line forms)
6. `pyproject.toml` `[tool.uv.workspace]` — `members` list

All workspace managers' glob patterns are expanded via `expandWorkspaceGlobs()`, and results are deduplicated by normalized path.

### `DetectedPackage` Interface

```typescript
interface DetectedPackage {
  name: string;         // From readPackageName() fallback chain
  path: string;         // Normalized relative path (no ./ or trailing /)
  type: ProjectType;    // Detected via detectProjectType() on the package dir
  isSubmodule: boolean; // Whether the path appears in .gitmodules
}
```

### `expandWorkspaceGlobs()` Limitations

- Only supports `*` as a **full path segment** wildcard (e.g., `packages/*`, `crates/*/subcrate`)
- Does **not** support `**` (recursive globbing), `?`, or character classes `[abc]`
- Segments that are not exactly `*` are treated as literal path components
- Dotfiles (directories starting with `.`) are excluded from wildcard matches
- Supports `!` prefix for exclusion patterns (e.g., `!packages/internal`)

### `readPackageName()` Fallback Chain

Reads the package name from config files in priority order, falling back to the directory basename:

1. `package.json` → `name` field
2. `Cargo.toml` → `[package]` `name`
3. `go.mod` → `module` directive (last path segment)
4. `pyproject.toml` → `[project]` `name`
5. Fallback: `path.basename(pkgPath)`

### `.gitmodules` Auto-Detection

When `.gitmodules` exists, its entries are parsed and:

- Paths are added to the submodule lookup set
- If no workspace manager is detected, submodule-only repos still return a non-null result (each submodule becomes a `DetectedPackage` with `isSubmodule: true`)
- If workspace managers are also detected, submodule paths are merged: workspace packages at submodule paths get `isSubmodule: true`, and submodule paths not covered by any workspace manager are added as additional packages

---

## Monorepo Init Flow (`init.ts`)

### CLI Flags

| Flag | Behavior |
|------|----------|
| `--monorepo` | Force monorepo mode (error if no config detected) |
| `--no-monorepo` | Skip monorepo detection entirely |
| _(neither)_ | Auto-detect; prompt user to confirm if packages found |

### Init Sequence (Monorepo Path)

1. **Detect**: Call `detectMonorepo(cwd)` to find packages
2. **Confirm**: In interactive mode, show detected packages and prompt "Enable monorepo mode?"
3. **Per-package template**: For each package, ask whether to use blank spec or download a remote template (skipped with `-y`)
4. **Create workflow structure**: Call `createWorkflowStructure()` with `packages` array, which creates per-package spec directories (`spec/<name>/backend/`, `spec/<name>/frontend/`, etc.)
5. **Write config**: Call `writeMonorepoConfig()` to patch `config.yaml`

### `writeMonorepoConfig()` Behavior

Non-destructive config.yaml patch:

- **Reads** existing `config.yaml` (no-op if file doesn't exist yet)
- **Skips** if `packages:` key already present (re-init safety)
- **Appends** `packages:` block with each package's `path` and optional `type: submodule`
- **Sets** `default_package:` to the first non-submodule package (fallback to first package)

### Per-Package Spec Directory Creation

For each detected package, `createWorkflowStructure()` creates spec directories based on the package's detected `ProjectType`:

- `backend` → `.trellis/spec/<name>/backend/*.md`
- `frontend` → `.trellis/spec/<name>/frontend/*.md`
- `fullstack` / `unknown` → both backend and frontend directories

Packages that received a remote template download (tracked via `remoteSpecPackages` set) skip blank spec template creation.

---

## DO / DON'T

### DO

- Dogfood from project's own config files when possible
- Use `cpSync` for copying entire directories
- Keep generic templates in `src/templates/markdown/`
- Use `.md.txt` or `.yaml.txt` for template files
- Update dogfooding sources (`.cursor/`, `.claude/`, `.trellis/scripts/`) when making changes
- Always use `python3` explicitly when documenting script invocation (Windows compatibility)

### DON'T

- Don't hardcode file lists - copy entire directories instead
- Don't duplicate content between templates and dogfooding sources
- Don't put project-specific content in generic templates
- Don't use dogfooding for spec/ (users fill these in)

---

## Design Decisions

### Remote Template Download (giget)

**Context**: Need to download GitHub subdirectories for remote template support.

**Options Considered**:
1. `degit` / `tiged` - Simple, but no programmatic API
2. `giget` - TypeScript native, has programmatic API, used by Nuxt/UnJS
3. Manual GitHub API - Too complex

**Decision**: Use `giget` because:
- TypeScript native with programmatic API
- Supports GitHub subdirectory: `gh:user/repo/path/to/subdir`
- Built-in caching for offline support
- Actively maintained by UnJS ecosystem

**Example**:
```typescript
import { downloadTemplate } from "giget";

await downloadTemplate("gh:mindfold-ai/Trellis/marketplace/specs/electron-fullstack", {
  dir: destDir,
  preferOffline: true,
});
```

### Directory Conflict Strategy (skip/overwrite/append)

**Context**: When downloading remote templates, target directory may already exist.

**Decision**: Three strategies with `skip` as default:
- `skip` - Don't download if directory exists (safe default)
- `overwrite` - Delete existing, download fresh
- `append` - Only copy files that don't exist (merge)

**Why**: giget doesn't support append natively, so we:
1. Download to temp directory
2. Walk and copy missing files only
3. Clean up temp directory

**Example**:
```typescript
// append strategy implementation
const tempDir = path.join(os.tmpdir(), `trellis-template-${Date.now()}`);
await downloadTemplate(source, { dir: tempDir });
await copyMissing(tempDir, destDir);  // Only copy non-existing files
await fs.promises.rm(tempDir, { recursive: true });
```

### Extensible Template Type Mapping

**Context**: Currently only `spec` templates, but future needs `skill`, `command`, `full` types.

**Decision**: Use type field + mapping table for extensibility:

```typescript
const INSTALL_PATHS: Record<string, string> = {
  spec: ".trellis/spec",
  skill: ".claude/skills",
  command: ".claude/commands",
  full: ".",  // Entire project root
};

// Usage: auto-detect install path from template type
const destDir = INSTALL_PATHS[template.type] || INSTALL_PATHS.spec;
```

**Extensibility**: To add new template type:
1. Add entry to `INSTALL_PATHS`
2. Add templates to `index.json` with new type
3. No code changes needed for download logic
