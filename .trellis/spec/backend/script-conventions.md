# Script Conventions

> Standards for Python scripts in the `.trellis/scripts/` directory.

---

## Overview

All workflow scripts are written in **Python 3.10+** for cross-platform compatibility. Scripts use only the standard library (no external dependencies).

---

## Directory Structure

```
.trellis/scripts/
├── __init__.py           # Package init
├── common/               # Shared modules
│   ├── __init__.py
│   ├── paths.py          # Path constants and functions
│   ├── developer.py      # Developer identity management
│   ├── task_queue.py     # Task queue CRUD
│   ├── task_utils.py     # Task helper functions
│   ├── phase.py          # Multi-agent phase tracking
│   ├── registry.py       # Agent registry management
│   ├── worktree.py       # Git worktree utilities
│   └── git_context.py    # Git/session context
├── multi_agent/          # Multi-agent pipeline scripts
│   ├── __init__.py
│   ├── start.py          # Start worktree agent
│   ├── status.py         # Monitor agent status
│   ├── plan.py           # Start plan agent
│   ├── cleanup.py        # Cleanup worktree
│   └── create_pr.py      # Create PR from task
├── task.py               # Main task management CLI
├── get_context.py        # Session context retrieval
├── init_developer.py     # Developer initialization
├── get_developer.py      # Get current developer
├── add_session.py        # Session recording
└── create_bootstrap.py   # Bootstrap task creation
```

---

## Script Types

### Library Modules (`common/*.py`)

Shared utilities imported by other scripts. **Never run directly.**

```python
# common/paths.py - Example library module

from __future__ import annotations

from pathlib import Path

# Constants
DIR_WORKFLOW = ".trellis"
DIR_SCRIPTS = "scripts"
DIR_TASKS = "tasks"

def get_repo_root() -> Path | None:
    """Find repository root by looking for .trellis directory."""
    current = Path.cwd().resolve()
    while current != current.parent:
        if (current / DIR_WORKFLOW).is_dir():
            return current
        current = current.parent
    return None
```

### Entry Scripts (`*.py`)

CLI tools that users run directly. Include docstring with usage.

```python
#!/usr/bin/env python3
"""
Task Management Script.

Usage:
    python3 task.py create "<title>" [--slug <name>]
    python3 task.py list [--mine] [--status <status>]
    python3 task.py start <dir>
    python3 task.py finish
    python3 task.py archive <task-name>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common.paths import get_repo_root, DIR_WORKFLOW


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Task management")
    # ... argument setup
    args = parser.parse_args()
    # ... command dispatch
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

## Cross-Platform Compatibility

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

> **Historical Context**: Scripts were migrated from Bash to Python in v0.3.0 for cross-platform compatibility. The old shell scripts are archived in `.trellis/scripts-shell-archive/` (if preserved).
