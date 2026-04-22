# Script Conventions

> Standards for Python scripts in the `.trellis/scripts/` directory.

---

## Overview

All workflow scripts target **Python 3.9+** for cross-platform compatibility (matches macOS system `python3`; covers Ubuntu 22.04 LTS and newer). Scripts use only the standard library (no external dependencies). PEP 604 union annotations (`str | None`) are allowed only when the file declares `from __future__ import annotations` — see the Cross-Platform Compatibility section below.

---

## Directory Structure

```
.trellis/scripts/
├── __init__.py           # Package init
├── common/               # Shared modules
│   ├── __init__.py       # Windows encoding fix (centralized)
│   ├── paths.py          # Path constants and functions
│   ├── developer.py      # Developer identity management
│   ├── io.py             # read_json / write_json
│   ├── log.py            # Colors class + log_info/log_error/log_warn/log_success
│   ├── git.py            # run_git() — git command wrapper
│   ├── types.py          # TaskData (TypedDict), TaskInfo (dataclass), AgentRecord
│   ├── tasks.py          # load_task(), iter_active_tasks() — typed task access
│   ├── task_utils.py     # resolve_task_dir(), run_task_hooks()
│   ├── task_store.py     # Task CRUD (create, archive, set-branch, etc.)
│   ├── task_context.py   # JSONL context management (init-context, add-context)
│   ├── task_queue.py     # Task queue CRUD
│   ├── config.py         # Config reader (config.yaml, hooks)
│   ├── cli_adapter.py    # Multi-platform CLI abstraction
│   ├── git_context.py    # Entry shim → session_context + packages_context
│   ├── session_context.py    # Session context generation (text/json/record)
│   └── packages_context.py  # Package discovery and context
├── hooks/                # Lifecycle hook scripts (project-specific)
│   └── linear_sync.py    # Example: sync tasks to Linear
├── task.py               # Entry shim → task_store + task_context
├── get_context.py        # Session context retrieval
├── init_developer.py     # Developer initialization
├── get_developer.py      # Get current developer
└── add_session.py        # Session recording
```

---

## Script Types

### Library Modules (`common/*.py`)

Shared utilities imported by other scripts. **Never run directly.**

Three tiers:

| Tier | Modules | Role |
|------|---------|------|
| **Foundation** | `io.py`, `log.py`, `git.py`, `paths.py` | Zero internal deps, used by everything |
| **Domain** | `types.py`, `tasks.py`, `task_store.py`, `task_context.py`, `task_utils.py` | Task data model and operations |
| **Infra** | `config.py`, `cli_adapter.py` | Platform abstraction and config |
| **Context** | `session_context.py`, `packages_context.py`, `git_context.py` (shim) | Output generation |

### Entry Scripts (`*.py`)

CLI tools that users run directly. Include docstring with usage.

```python
#!/usr/bin/env python3
"""Short description.

Usage:
    python3 script.py <command> [options]
"""

from __future__ import annotations

import argparse
import sys

from common.paths import get_repo_root

def main() -> int:
    parser = argparse.ArgumentParser(...)
    args = parser.parse_args()
    # ... dispatch
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

---

## Coding Standards

### Type Hints

Use modern type hints (Python 3.10+ syntax):

```python
# Good
def get_tasks(status: str | None = None) -> list[dict]:
    ...

def read_json(path: Path) -> dict | None:
    ...

# Bad - old style
from typing import Optional, List, Dict
def get_tasks(status: Optional[str] = None) -> List[Dict]:
    ...
```

### Path Handling

Always use `pathlib.Path`:

```python
# Good
from pathlib import Path

def read_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")

config_path = repo_root / DIR_WORKFLOW / "config.json"

# Bad - string concatenation
config_path = repo_root + "/" + DIR_WORKFLOW + "/config.json"
```

### JSON Operations

Use helper functions for consistent error handling:

```python
import json
from pathlib import Path


def read_json(path: Path) -> dict | None:
    """Read JSON file, return None on error."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def write_json(path: Path, data: dict) -> bool:
    """Write JSON file, return success status."""
    try:
        path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )
        return True
    except Exception:
        return False
```

### Subprocess Execution

```python
import subprocess
from pathlib import Path


def run_command(
    cmd: list[str],
    cwd: Path | None = None
) -> tuple[int, str, str]:
    """Run command and return (returncode, stdout, stderr)."""
    result = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True
    )
    return result.returncode, result.stdout, result.stderr
```

---

## Shared Module API Reference

### `common/io.py` — JSON File I/O

The single source of truth for all JSON file operations. Replaces 8 duplicated `_read_json_file` and 5 duplicated `_write_json_file` functions.

| Function | Signature | Returns | Error Behavior |
|----------|-----------|---------|----------------|
| `read_json` | `(path: Path) -> dict \| None` | Parsed dict, or `None` | Returns `None` on `FileNotFoundError`, `JSONDecodeError`, `OSError` |
| `write_json` | `(path: Path, data: dict) -> bool` | `True` on success | Returns `False` on `OSError`, `IOError` |

**Contracts**:
- Always uses `encoding="utf-8"` and `ensure_ascii=False`
- `write_json` outputs with `indent=2` (pretty-printed)
- Callers must check return value — no exceptions are raised

### `common/log.py` — Terminal Output

| Export | Type | Description |
|--------|------|-------------|
| `Colors` | class | ANSI codes: `RED`, `GREEN`, `YELLOW`, `BLUE`, `CYAN`, `DIM`, `NC` |
| `colored(text, color)` | function | Wrap text with color + reset |
| `log_info(msg)` | function | `[INFO]` prefix (blue) |
| `log_success(msg)` | function | `[SUCCESS]` prefix (green) |
| `log_warn(msg)` | function | `[WARN]` prefix (yellow) |
| `log_error(msg)` | function | `[ERROR]` prefix (red) |

All `log_*` functions print to **stdout** (not stderr). Use `print(..., file=sys.stderr)` for stderr output.

### `common/git.py` — Git Command Wrapper

```python
def run_git(args: list[str], cwd: Path | None = None) -> tuple[int, str, str]
```

- Prepends `git -c i18n.logOutputEncoding=UTF-8` to all commands (cross-platform UTF-8)
- Uses `encoding="utf-8", errors="replace"` for subprocess output
- Returns `(1, "", error_message)` on exception (never raises)
- Backward-compatible alias in `git_context.py`: `_run_git_command = run_git`

### `common/types.py` — Typed Data Model

#### Design Decision: TypedDict for Reads, Raw Dict for Writes

**Context**: task.json may contain fields not defined in our TypedDict (e.g., user-added custom fields). If we serialize a TypedDict/dataclass back to JSON, unknown fields are silently dropped.

**Decision**: Two-layer type system:

| Type | Kind | Purpose | Includes unknown fields? |
|------|------|---------|--------------------------|
| `TaskData` | `TypedDict(total=False)` | Type hints when reading task.json | N/A (annotation only) |
| `TaskInfo` | `dataclass(frozen=True)` | Immutable view for business logic | Yes, via `.raw` dict |

**Write-back rule**: Always modify `task_info.raw` (the original dict) and pass it to `write_json()`. Never construct a new dict from TaskInfo fields.

```python
# GOOD — modify original dict, preserve unknown fields
data = read_json(task_json)
data["status"] = "completed"
write_json(task_json, data)

# BAD — would lose any fields not in TaskData
write_json(task_json, {"title": info.title, "status": "completed"})
```

#### `TaskInfo` Fields

| Field | Type | Source |
|-------|------|--------|
| `dir_name` | `str` | Directory name (e.g., `"03-12-refactor"`) |
| `directory` | `Path` | Absolute path to task dir |
| `title` | `str` | `data["title"]` or `data["name"]` or `"unknown"` |
| `status` | `str` | `data["status"]` (default `"unknown"`) |
| `assignee` | `str` | `data["assignee"]` (default `""`) |
| `priority` | `str` | `data["priority"]` (default `"P2"`) |
| `children` | `tuple[str, ...]` | Immutable copy of `data["children"]` |
| `parent` | `str \| None` | Parent task dir name |
| `package` | `str \| None` | Associated package |
| `raw` | `dict` | Original dict for writes and uncommon fields |

Properties: `.name`, `.description`, `.branch`, `.meta` — delegate to `raw`.

### `common/tasks.py` — Task Data Access Layer

Replaces 9 scattered task iteration patterns with a single typed API.

| Function | Signature | Description |
|----------|-----------|-------------|
| `load_task` | `(task_dir: Path) -> TaskInfo \| None` | Load one task; `None` if no valid task.json |
| `iter_active_tasks` | `(tasks_dir: Path) -> Iterator[TaskInfo]` | All non-archived tasks, **sorted by dir name** |
| `get_all_statuses` | `(tasks_dir: Path) -> dict[str, str]` | `{dir_name: status}` map for progress display |
| `children_progress` | `(children, all_statuses) -> str` | Format `" [2/3 done]"` or `""` |

**Sorting guarantee**: `iter_active_tasks` uses `sorted(tasks_dir.iterdir())` — same order as the filesystem `ls` output. This is frozen behavior; changing the sort would break display consistency.

---

## Cross-Platform Compatibility

### CRITICAL: Windows stdio Encoding (stdout + stdin)

On Windows, Python's stdout AND stdin default to the system code page (e.g., GBK/CP936 in China, CP1252 in Western locales). This causes:
- `UnicodeEncodeError` when **printing** non-ASCII characters (stdout)
- `UnicodeDecodeError` when **reading piped** UTF-8 content (stdin), e.g. Chinese text via `cat << EOF | python3 script.py`

**The Problem Chain (stdout)**:

```
Windows code page = GBK (936)
    ↓
Python stdout defaults to GBK encoding
    ↓
Subprocess output contains special chars → replaced with \ufffd (replacement char)
    ↓
json.dumps(ensure_ascii=False) → print()
    ↓
GBK cannot encode \ufffd → UnicodeEncodeError: 'gbk' codec can't encode character
```

**The Problem Chain (stdin)**:

```
AI agent pipes UTF-8 content via heredoc: cat << 'EOF' | python3 add_session.py ...
    ↓
Python stdin defaults to GBK encoding (PowerShell default code page)
    ↓
sys.stdin.read() decodes bytes as GBK, not UTF-8
    ↓
Chinese text garbled or UnicodeDecodeError
```

**Root Cause**: Even if you set `PYTHONIOENCODING` in subprocess calls, the **parent process's stdio** still uses the system code page.

---

#### GOOD: Centralize encoding fix in `common/__init__.py`

All stdio encoding is handled in one place. Scripts that `from common import ...` automatically get the fix:

```python
# common/__init__.py
import io
import sys

def _configure_stream(stream):
    """Configure a stream for UTF-8 encoding on Windows."""
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")
        return stream
    elif hasattr(stream, "detach"):
        return io.TextIOWrapper(stream.detach(), encoding="utf-8", errors="replace")
    return stream

if sys.platform == "win32":
    sys.stdout = _configure_stream(sys.stdout)
    sys.stderr = _configure_stream(sys.stderr)
    sys.stdin = _configure_stream(sys.stdin)    # Don't forget stdin!
```

---

#### DON'T: Inline encoding code in individual scripts

```python
# BAD - Duplicated in every script, easy to forget stdin
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    # Forgot stdin! Piped Chinese text will break.
```

**Why this is bad**:
1. **Easy to forget streams**: stdout was fixed but stdin was missed in multiple scripts, causing real user bugs
2. **Duplicated code**: Same logic copy-pasted across `add_session.py`, `git_context.py`, etc.
3. **Inconsistent coverage**: Some scripts fix stdout only, others fix stdout+stderr, none fixed stdin

**Real-world failure**: Users on Windows reported garbled Chinese text when using `cat << EOF | python3 add_session.py`. Root cause: stdin was never reconfigured to UTF-8.

---

#### Summary

| Method | Works? | Reason |
|--------|--------|--------|
| `common/__init__.py` centralized fix | ✅ Yes | All streams, all scripts, one place |
| `sys.stdout.reconfigure(encoding="utf-8")` | ⚠️ Partial | Only stdout; easy to forget stdin/stderr |
| `io.TextIOWrapper(sys.stdout.buffer, ...)` | ❌ No | Creates wrapper, doesn't fix underlying encoding |
| `PYTHONIOENCODING=utf-8` env var | ⚠️ Partial | Only works if set **before** Python starts |

### CRITICAL: PEP 604 Annotations Require `from __future__ import annotations`

Any distributed Python template file (`templates/**/*.py` — both hooks and scripts) that uses PEP 604 union syntax (`str | None`, `dict | None`, etc.) in annotations **must** start with:

```python
from __future__ import annotations
```

immediately after the module docstring.

**Why it matters**: The `{{PYTHON_CMD}}` placeholder resolves to literal `python3` on macOS/Linux. `trellis init` soft-warns if Python < 3.10 but does not block, and hooks are invoked by the host AI CLI (Claude Code, Cursor, enterprise-forked CC distributions, etc.) in a subprocess whose **PATH may differ from the user's shell PATH**. Concrete failure mode observed in the field:

- User's terminal `python3 --version` → 3.11.12 (homebrew / pyenv)
- The AI CLI's hook subprocess inherits a minimal PATH (no `/opt/homebrew/bin`), so `python3` resolves to `/usr/bin/python3` → macOS system 3.9
- `def f(x: str | None)` evaluates `str | None` at def-time on 3.9 → `TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'`
- Hook crashes silently; user sees `SessionStart hook error` in debug log with no actionable hint

`from __future__ import annotations` makes all annotations lazy strings (PEP 563), so PEP 604 syntax in annotations works on Python 3.7+. Runtime union usage (e.g. `isinstance(x, int | str)`) is **not** rescued by this import — avoid it in distributed templates.

**Real-world incident**: `shared-hooks/session-start.py` and `shared-hooks/inject-subagent-context.py` lacked this import while `statusline.py` and the copilot/codex copies had it. The inconsistency went undetected until a user on an enterprise-forked Claude Code distribution hit the PEP 604 crash on SessionStart. Fix commit: `7e58432` (2026-04).

#### DO

```python
#!/usr/bin/env python3
"""Hook description."""
from __future__ import annotations

import sys
from pathlib import Path

def handler(x: str | None) -> dict | None:  # lazy annotation — safe on 3.9
    ...
```

#### DON'T

```python
# BAD — annotations evaluated eagerly, crashes on Python < 3.10
def handler(x: str | None) -> dict | None:
    ...
```

```python
# BAD — __future__ import does NOT rescue runtime union
def check(x):
    if isinstance(x, int | str):  # still crashes on 3.9
        ...
```

#### Audit Check

Run this before releasing any change that adds a new `.py` file to `templates/`:

```bash
cd packages/cli/src/templates
for f in $(find . -name "*.py"); do
    if grep -qE '^[^#]*: [A-Za-z_].*\|.*(None|[A-Z])|->.*\|' "$f" \
       && ! grep -q "from __future__ import annotations" "$f"; then
        echo "MISSING: $f"
    fi
done
```

Exit with 0 matches means all PEP 604 users have the future import.

---

### CRITICAL: Always Use `python3` Explicitly

Windows does not support shebang (`#!/usr/bin/env python3`). Always document invocation with explicit `python3`:

```python
# In docstrings
"""
Usage:
    python3 task.py create "My Task"
    python3 task.py list --mine
"""

# In error messages
print("Usage: python3 task.py <command>")
print("Run: python3 ./.trellis/scripts/init_developer.py <name>")

# In help text
print("Next steps:")
print("  python3 task.py start <dir>")
```

### Path Separators

Use `pathlib.Path` - it handles separators automatically:

```python
# Good - works on all platforms
path = Path(".trellis") / "scripts" / "task.py"

# Bad - Unix-only
path = ".trellis/scripts/task.py"
```

---

## Task Lifecycle Hooks

### Scope / Trigger

Task lifecycle events (`after_create`, `after_start`, `after_finish`, `after_archive`) execute user-defined shell commands configured in `config.yaml`.

### Signatures

```python
# config.py — read hook commands from config
def get_hooks(event: str, repo_root: Path | None = None) -> list[str]

# task.py — execute hooks (never blocks main operation)
def _run_hooks(event: str, task_json_path: Path, repo_root: Path) -> None
```

### Contracts

**Config format** (`config.yaml`):
```yaml
hooks:
  after_create:
    - "python3 .trellis/scripts/hooks/my_hook.py create"
  after_start:
    - "python3 .trellis/scripts/hooks/my_hook.py start"
  after_archive:
    - "python3 .trellis/scripts/hooks/my_hook.py archive"
```

**Environment variables passed to hooks**:

| Key | Type | Description |
|-----|------|-------------|
| `TASK_JSON_PATH` | Absolute path string | Path to the task's `task.json` |

- `cwd` is set to `repo_root`
- Hooks inherit the parent process environment + `TASK_JSON_PATH`

### Subprocess Execution

```python
import os
import subprocess

env = {**os.environ, "TASK_JSON_PATH": str(task_json_path)}

result = subprocess.run(
    cmd,
    shell=True,
    cwd=repo_root,
    env=env,
    capture_output=True,
    text=True,
    encoding="utf-8",    # REQUIRED: cross-platform
    errors="replace",    # REQUIRED: cross-platform
)
```

### Validation & Error Matrix

| Condition | Behavior |
|-----------|----------|
| No `hooks` key in config | No-op (empty list) |
| `hooks` is not a dict | No-op (empty list) |
| Event key missing | No-op (empty list) |
| Hook command exits non-zero | `[WARN]` to stderr, continues to next hook |
| Hook command throws exception | `[WARN]` to stderr, continues to next hook |
| `linearis` not installed | Hook fails with warning, task operation succeeds |

### Wrong vs Correct

#### Wrong — blocking on hook failure
```python
result = subprocess.run(cmd, shell=True, check=True)  # Raises on failure!
```

#### Correct — warn and continue
```python
try:
    result = subprocess.run(cmd, shell=True, ...)
    if result.returncode != 0:
        print(f"[WARN] Hook failed: {cmd}", file=sys.stderr)
except Exception as e:
    print(f"[WARN] Hook error: {cmd} — {e}", file=sys.stderr)
```

### Hook Script Pattern

Hook scripts that need project-specific config (API keys, user IDs) should:
1. Store config in a **gitignored** local file (e.g., `.trellis/hooks.local.json`)
2. Read config at startup, fail with clear message if missing
3. Keep the script itself committable (no hardcoded secrets)

```python
# .trellis/scripts/hooks/my_hook.py — committable, no secrets
CONFIG = _load_config()  # reads from .trellis/hooks.local.json (gitignored)
TEAM = CONFIG.get("linear", {}).get("team", "")
```

---

## Auto-Commit Pattern

Scripts that modify `.trellis/` tracked files should auto-commit their changes to keep the workspace clean. Use a `--no-commit` flag for opt-out.

### Convention: Auto-Commit After Mutation

```python
def _auto_commit(scope: str, message: str, repo_root: Path) -> None:
    """Stage and commit changes in a specific .trellis/ subdirectory."""
    subprocess.run(["git", "add", "-A", scope], cwd=repo_root, capture_output=True)
    # Check if there are staged changes
    result = subprocess.run(
        ["git", "diff", "--cached", "--quiet", "--", scope],
        cwd=repo_root,
    )
    if result.returncode == 0:
        print("[OK] No changes to commit.", file=sys.stderr)
        return
    commit_result = subprocess.run(
        ["git", "commit", "-m", message],
        cwd=repo_root, capture_output=True, text=True,
    )
    if commit_result.returncode == 0:
        print(f"[OK] Auto-committed: {message}", file=sys.stderr)
    else:
        print(f"[WARN] Auto-commit failed: {commit_result.stderr.strip()}", file=sys.stderr)
```

**Scripts using this pattern**:
- `add_session.py` — commits `.trellis/workspace` + `.trellis/tasks` after recording a session
- `task.py archive` — commits `.trellis/tasks` after archiving a task

**Always add `--no-commit` flag** for scripts that auto-commit, so users can opt out.

---

## CLI Mode Extension Pattern

### Design Decision: `--mode` for Context-Dependent Output

When a script needs different output for different use cases, use `--mode` (not separate scripts or additional flags).

**Example**: `get_context.py` serves two modes:
- `--mode default` — full session context (DEVELOPER, GIT STATUS, RECENT COMMITS, CURRENT TASK, ACTIVE TASKS, MY TASKS, JOURNAL, PATHS)
- `--mode record` — focused output for record-session (MY ACTIVE TASKS first with emphasis, GIT STATUS, RECENT COMMITS, CURRENT TASK)

```python
parser.add_argument(
    "--mode", "-m",
    choices=["default", "record"],
    default="default",
    help="Output mode: default (full context) or record (for record-session)",
)
```

**When to add a new mode** (not a new script):
- Output is a subset/reordering of the same data
- The underlying data sources are shared
- The difference is in presentation, not in data fetching

---

## Parsing Structured Command Output

### CRITICAL: Preserve Semantic Whitespace

Many CLI tools encode status information in leading/trailing whitespace characters. **Never blindly `.strip()` before parsing.**

**Example — `git submodule status` output format**:

```
 abc1234 path/to/submodule (v1.0)     ← space prefix = initialized
-def5678 path/to/other (v2.0)         ← minus prefix = not initialized
+ghi9012 path/to/modified (v3.0)      ← plus prefix = modified (out of sync)
```

```python
# BAD — .strip() removes the leading space that means "initialized"
status_line = status_out.strip()
prefix = status_line[0]  # Reads commit hash char, not status prefix!

# GOOD — parse the raw line, then strip individual fields
raw_line = status_out.rstrip("\n")  # Only remove trailing newline
if not raw_line:
    continue
prefix = raw_line[0]               # ' ', '-', or '+'
rest = raw_line[1:].strip()        # Now safe to strip the rest
commit_hash = rest.split()[0]
```

**General rule**: When a command's output uses positional formatting (columns, prefixes, fixed-width fields), parse the structure first, then clean up individual values.

**Other commands with semantic whitespace**:
- `git status --porcelain` — two-char status prefix (`XY`)
- `git diff --name-status` — tab-separated with status prefix
- `docker ps --format` — column-aligned output

---

## Monorepo Config API (`common/config.py`)

### Config Functions

| Function | Return | Purpose |
|----------|--------|---------|
| `is_monorepo(repo_root)` | `bool` | Whether `packages:` exists in config.yaml |
| `get_packages(repo_root)` | `dict[str, dict] \| None` | All packages from config.yaml (`{name: {path, type?}}`) |
| `get_default_package(repo_root)` | `str \| None` | The `default_package` from config.yaml |
| `get_submodule_packages(repo_root)` | `dict[str, str]` | Packages with `type: submodule` (`{name: path}`) |
| `get_spec_base(package, repo_root)` | `str` | `"spec"` (single-repo) or `"spec/<package>"` (monorepo) |
| `validate_package(package, repo_root)` | `bool` | Whether package exists in config (always `True` for single-repo) |
| `resolve_package(task_pkg, repo_root)` | `str \| None` | Resolve package: task → default → None |
| `get_spec_scope(repo_root)` | `str \| list \| None` | The `session.spec_scope` config value |
| `get_hooks(event, repo_root)` | `list[str]` | Hook commands for lifecycle event |

### Config.yaml Schema

```yaml
# Auto-detected monorepo packages (written by trellis init)
packages:
  cli:
    path: packages/cli
  docs-site:
    path: docs-site
    type: submodule       # optional, marks git submodule
default_package: cli      # first non-submodule package

# Session behavior
session:
  spec_scope: active_task  # or ["cli", "docs-site"] or omit for full scan

# Update behavior
update:
  skip:
    - .claude/commands/trellis/my-custom.md

# Lifecycle hooks
hooks:
  after_create:
    - "python3 .trellis/scripts/hooks/my_hook.py create"
```

### Task → Package Binding Contract

**Rule**: The `package` field on a task is **bound at `task create` time and frozen into `task.json.package`**. Downstream scripts read that field; they do **not** re-resolve package from path, cwd, or runtime context.

**Why it matters**: Once a task exists, changing `default_package` in `config.yaml` will not retroactively rebind existing tasks. Path-based inference is not implemented anywhere in the script layer — callers (human or AI) must pass `--package` explicitly if they want non-default binding.

**Resolution order at `task create`** (`common/task_store.py:cmd_create`):

| Priority | Source | Behavior on invalid value |
|---|---|---|
| 1 | CLI `--package <pkg>` (explicit) | **Fail-fast**: print available packages, exit 1 |
| 2 | `default_package` (config.yaml) | Warn to stderr, fall through to `None` |
| 3 | `None` | Task stored with `package: null` (allowed; spec scope falls back to full scan) |

Single-repo mode (`packages:` absent from config): `--package` triggers a stderr warning and is silently ignored; stored `package` is always `None`.

**Resolution order at read-time** (any script reading an existing task):

| Priority | Source |
|---|---|
| 1 | `task.json.package` (the frozen binding) |
| 2 | `resolve_package(task_package=..., repo_root=...)` — falls back to `default_package` if `task.json.package` is missing/invalid |

Do **not** re-infer package from cwd, worktree path, or git remote. If the task is mis-bound, fix the stored field, do not wrap reads in path logic.

**Spec scope is a separate layer** (`common/packages_context.py:_resolve_scope_set`). It consumes `task.package` but also has its own config surface `session.spec_scope`:

| `session.spec_scope` value | Behavior |
|---|---|
| omitted / `null` | Full scan — all packages in `spec_scope` |
| `"active_task"` | Use current task's `package`; fall back to `default_package` if missing |
| `list[str]` | Use the explicit list; invalid entries fall back to task / default |

### Wrong vs Correct

#### Wrong — re-inferring package at read-time

```python
# DON'T: re-derive package from cwd
def get_task_package(task_dir: Path) -> str | None:
    cwd = Path.cwd()
    for name, cfg in get_packages(repo_root).items():
        if cwd.is_relative_to(repo_root / cfg["path"]):
            return name
    return get_default_package(repo_root)
```

Why wrong: silently diverges from `task.json.package`. A task created under `packages/cli` but later read from `docs-site/` would flip package, breaking spec scope, session context, and Linear sync idempotency.

#### Correct — read the frozen field, fall back through `resolve_package`

```python
task = load_task(task_dir)
task_package = task.package if task and isinstance(task.package, str) else None
package = resolve_package(task_package=task_package, repo_root=repo_root)
# package is now: task.json binding → default_package → None (in that order)
```

### Tests Required

When changing `cmd_create`, `resolve_package`, or `validate_package`:

- `test/commands/task_store.test.ts` (or equivalent Python test):
  - `--package <valid>` in monorepo → `task.json.package == <valid>`
  - `--package <invalid>` in monorepo → exit 1, stderr lists available packages, no `task.json` written
  - `--package <anything>` in single-repo → warning on stderr, `task.json.package is None`
  - no `--package` in monorepo with `default_package` set → `task.json.package == default_package`
  - no `--package` in monorepo with `default_package` missing from `packages:` → warning, `task.json.package is None`
- Assertion points: `task_json_path.exists()`, `read_json(task_json_path)["package"]`, captured stderr.

---

## Error Handling

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Usage error (wrong arguments) |

### Error Messages

Print errors to stderr with context:

```python
import sys

def error(msg: str) -> None:
    """Print error message to stderr."""
    print(f"Error: {msg}", file=sys.stderr)

# Usage
if not repo_root:
    error("Not in a Trellis project (no .trellis directory found)")
    sys.exit(1)
```

---

## Argument Parsing

Use `argparse` for consistent CLI interface:

```python
import argparse


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Task management",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 task.py create "Add login" --slug add-login
  python3 task.py list --mine --status in_progress
"""
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # create command
    create_parser = subparsers.add_parser("create", help="Create new task")
    create_parser.add_argument("title", help="Task title")
    create_parser.add_argument("--slug", help="URL-friendly name")

    # list command
    list_parser = subparsers.add_parser("list", help="List tasks")
    list_parser.add_argument("--mine", "-m", action="store_true")
    list_parser.add_argument("--status", "-s", choices=["planning", "in_progress", "review", "completed"])

    args = parser.parse_args()

    if args.command == "create":
        return cmd_create(args)
    elif args.command == "list":
        return cmd_list(args)

    return 0
```

---

## Import Conventions

### Relative Imports Within Package

```python
# In task.py (root level)
from common.paths import get_repo_root, DIR_WORKFLOW
from common.developer import get_developer

# In common/developer.py
from .paths import get_repo_root, DIR_WORKFLOW
```

### Standard Library Imports

Group and order imports:

```python
# 1. Future imports
from __future__ import annotations

# 2. Standard library
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# 3. Local imports
from common.paths import get_repo_root
from common.developer import get_developer
```

---

## Module Split Patterns

When a script grows too large (300+ lines of logic), split it into focused modules. These patterns were established during the v0.4.0 refactoring of `task.py` (1375→456 lines), `git_context.py` (724→80 lines), and `status.py` (783→79 lines).

### Pattern: Entry Shim

Keep the original filename as a thin dispatcher that imports from new modules. This preserves all external references (`.md` templates, other scripts doing `from task import cmd_create`).

```python
# task.py — entry shim (argparse + dispatch only)
from __future__ import annotations

import argparse
import sys

from common.task_store import cmd_create, cmd_archive   # CRUD operations
from common.task_context import cmd_init_context         # JSONL management

def main() -> int:
    parser = argparse.ArgumentParser(...)
    args = parser.parse_args()
    if args.command == "create":
        return cmd_create(args)
    # ... dispatch table
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

**Key rules**:
- Original file path stays stable (e.g., `python3 .trellis/scripts/task.py`)
- Imported names become re-exports for backward compatibility
- Display-only commands (like `cmd_list`) can stay in the shim if they don't warrant a new module

### Pattern: Lazy Import for Circular Dependencies

When two split modules need each other (A imports from B, B imports from A), use a lazy import inside the function body:

```python
# status_display.py — imports status_monitor at call time, not module load time
def cmd_summary(repo_root: Path, filter_assignee: str | None = None) -> int:
    # Lazy import: status_monitor imports find_agent from this module
    from .status_monitor import get_last_tool, get_last_message

    # ... use get_last_tool, get_last_message
```

**When to use**: Only when a true circular dependency exists. If you can restructure imports to avoid it, do that first.

### Pattern: Internal Helpers to Avoid Redundant File Reads

When multiple public functions read the same file and call each other, extract private helpers that operate on a pre-loaded `data: dict`:

```python
# BAD — get_phase_info reads task.json 3 times
def get_phase_info(task_json: Path) -> str:
    data = read_json(task_json)              # read 1
    total = get_total_phases(task_json)      # read 2 (inside)
    action = get_phase_action(task_json, p)  # read 3 (inside)

# GOOD — read once, pass data to private helpers
def _total_phases(data: dict) -> int:
    next_action = data.get("next_action", [])
    return len(next_action) if isinstance(next_action, list) else 0

def _phase_action(data: dict, phase: int) -> str:
    # ... operate on data dict directly

def get_phase_info(task_json: Path) -> str:
    data = read_json(task_json)              # read once
    total = _total_phases(data)              # no file I/O
    action = _phase_action(data, phase)      # no file I/O
```

**When to use**: Any module where public functions compose by calling other public functions that each read the same file (e.g., `task_store.py`, `config.py`).

---

## DO / DON'T

### DO

- Use `pathlib.Path` for all path operations
- Use type hints (Python 3.10+ syntax)
- Return exit codes from `main()`
- Print errors to stderr
- Always use `python3` in documentation and messages
- Use `encoding="utf-8"` for all file operations

### DON'T

- Don't use string path concatenation
- Don't use `os.path` when `pathlib` works
- Don't rely on shebang for invocation documentation
- Don't use `print()` for errors (use stderr)
- Don't hardcode paths - use constants from `common/paths.py`
- Don't use external dependencies (stdlib only)

---

## Example: Complete Script

See `.trellis/scripts/task.py` for a comprehensive example with:
- Multiple subcommands
- Argument parsing
- JSON file operations
- Error handling
- Cross-platform path handling

---

## Migration Note

> **Historical Context**: Scripts were migrated from Bash to Python in v0.3.0 for cross-platform compatibility. In v0.5.0, the `multi_agent/` pipeline directory (`plan.py`, `start.py`, `status.py`, etc.) was removed along with `phase.py`, `registry.py`, and `worktree.py` from `common/`. The `_bootstrap.py` shim is no longer needed.
