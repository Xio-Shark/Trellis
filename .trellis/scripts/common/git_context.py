#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Git and Session Context utilities.

Provides:
    output_json - Output context in JSON format
    output_text - Output context in text format
"""

from __future__ import annotations

import json
from pathlib import Path

from .config import get_default_package, get_packages, get_spec_scope
from .git import run_git
from .tasks import iter_active_tasks, load_task, get_all_statuses, children_progress
from .paths import (
    DIR_SCRIPTS,
    DIR_SPEC,
    DIR_TASKS,
    DIR_WORKFLOW,
    DIR_WORKSPACE,
    count_lines,
    get_active_journal_file,
    get_current_task,
    get_developer,
    get_repo_root,
    get_tasks_dir,
)

# =============================================================================
# Helper Functions
# =============================================================================


# Backward-compatible alias — external modules import this name
_run_git_command = run_git


def _scan_spec_layers(spec_dir: Path, package: str | None = None) -> list[str]:
    """Scan spec directory for available layers (subdirectories).

    For monorepo: scans spec/<package>/
    For single-repo: scans spec/
    """
    target = spec_dir / package if package else spec_dir
    if not target.is_dir():
        return []
    return sorted(
        d.name for d in target.iterdir() if d.is_dir() and d.name != "guides"
    )


def _get_packages_info(repo_root: Path) -> list[dict]:
    """Get structured package info for monorepo projects.

    Returns list of dicts with keys: name, path, type, default, specLayers, isSubmodule.
    Returns empty list for single-repo projects.
    """
    packages = get_packages(repo_root)
    if not packages:
        return []

    default_pkg = get_default_package(repo_root)
    spec_dir = repo_root / DIR_WORKFLOW / DIR_SPEC
    result = []

    for pkg_name, pkg_config in packages.items():
        pkg_path = pkg_config.get("path", pkg_name) if isinstance(pkg_config, dict) else str(pkg_config)
        pkg_type = pkg_config.get("type", "local") if isinstance(pkg_config, dict) else "local"
        layers = _scan_spec_layers(spec_dir, pkg_name)

        result.append({
            "name": pkg_name,
            "path": pkg_path,
            "type": pkg_type,
            "default": pkg_name == default_pkg,
            "specLayers": layers,
            "isSubmodule": pkg_type == "submodule",
        })

    return result


def _get_packages_section(repo_root: Path) -> str:
    """Build the PACKAGES section for text output."""
    spec_dir = repo_root / DIR_WORKFLOW / DIR_SPEC
    pkg_info = _get_packages_info(repo_root)

    lines: list[str] = []
    lines.append("## PACKAGES")

    if not pkg_info:
        lines.append("(single-repo mode)")
        layers = _scan_spec_layers(spec_dir)
        if layers:
            lines.append(f"Spec layers: {', '.join(layers)}")
        return "\n".join(lines)

    default_pkg = get_default_package(repo_root)

    for pkg in pkg_info:
        layers_str = f"  [{', '.join(pkg['specLayers'])}]" if pkg["specLayers"] else ""
        submodule_tag = "  (submodule)" if pkg["isSubmodule"] else ""
        default_tag = "  *" if pkg["default"] else ""
        lines.append(
            f"- {pkg['name']:<16} {pkg['path']:<20}{layers_str}{submodule_tag}{default_tag}"
        )

    if default_pkg:
        lines.append(f"Default package: {default_pkg}")

    return "\n".join(lines)


# =============================================================================
# JSON Output
# =============================================================================


def get_context_json(repo_root: Path | None = None) -> dict:
    """Get context as a dictionary.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Context dictionary.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    developer = get_developer(repo_root)
    tasks_dir = get_tasks_dir(repo_root)
    journal_file = get_active_journal_file(repo_root)

    journal_lines = 0
    journal_relative = ""
    if journal_file and developer:
        journal_lines = count_lines(journal_file)
        journal_relative = (
            f"{DIR_WORKFLOW}/{DIR_WORKSPACE}/{developer}/{journal_file.name}"
        )

    # Git info
    _, branch_out, _ = run_git(["branch", "--show-current"], cwd=repo_root)
    branch = branch_out.strip() or "unknown"

    _, status_out, _ = run_git(["status", "--porcelain"], cwd=repo_root)
    git_status_count = len([line for line in status_out.splitlines() if line.strip()])
    is_clean = git_status_count == 0

    # Recent commits
    _, log_out, _ = run_git(["log", "--oneline", "-5"], cwd=repo_root)
    commits = []
    for line in log_out.splitlines():
        if line.strip():
            parts = line.split(" ", 1)
            if len(parts) >= 2:
                commits.append({"hash": parts[0], "message": parts[1]})
            elif len(parts) == 1:
                commits.append({"hash": parts[0], "message": ""})

    # Tasks
    tasks = [
        {
            "dir": t.dir_name,
            "name": t.name,
            "status": t.status,
            "children": list(t.children),
            "parent": t.parent,
        }
        for t in iter_active_tasks(tasks_dir)
    ]

    return {
        "developer": developer or "",
        "git": {
            "branch": branch,
            "isClean": is_clean,
            "uncommittedChanges": git_status_count,
            "recentCommits": commits,
        },
        "tasks": {
            "active": tasks,
            "directory": f"{DIR_WORKFLOW}/{DIR_TASKS}",
        },
        "journal": {
            "file": journal_relative,
            "lines": journal_lines,
            "nearLimit": journal_lines > 1800,
        },
    }


def output_json(repo_root: Path | None = None) -> None:
    """Output context in JSON format.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.
    """
    context = get_context_json(repo_root)
    print(json.dumps(context, indent=2, ensure_ascii=False))


# =============================================================================
# Text Output
# =============================================================================


def get_context_text(repo_root: Path | None = None) -> str:
    """Get context as formatted text.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Formatted text output.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    lines = []
    lines.append("========================================")
    lines.append("SESSION CONTEXT")
    lines.append("========================================")
    lines.append("")

    developer = get_developer(repo_root)

    # Developer section
    lines.append("## DEVELOPER")
    if not developer:
        lines.append(
            f"ERROR: Not initialized. Run: python3 ./{DIR_WORKFLOW}/{DIR_SCRIPTS}/init_developer.py <name>"
        )
        return "\n".join(lines)

    lines.append(f"Name: {developer}")
    lines.append("")

    # Git status
    lines.append("## GIT STATUS")
    _, branch_out, _ = run_git(["branch", "--show-current"], cwd=repo_root)
    branch = branch_out.strip() or "unknown"
    lines.append(f"Branch: {branch}")

    _, status_out, _ = run_git(["status", "--porcelain"], cwd=repo_root)
    status_lines = [line for line in status_out.splitlines() if line.strip()]
    status_count = len(status_lines)

    if status_count == 0:
        lines.append("Working directory: Clean")
    else:
        lines.append(f"Working directory: {status_count} uncommitted change(s)")
        lines.append("")
        lines.append("Changes:")
        _, short_out, _ = run_git(["status", "--short"], cwd=repo_root)
        for line in short_out.splitlines()[:10]:
            lines.append(line)
    lines.append("")

    # Recent commits
    lines.append("## RECENT COMMITS")
    _, log_out, _ = run_git(["log", "--oneline", "-5"], cwd=repo_root)
    if log_out.strip():
        for line in log_out.splitlines():
            lines.append(line)
    else:
        lines.append("(no commits)")
    lines.append("")

    # Current task
    lines.append("## CURRENT TASK")
    current_task = get_current_task(repo_root)
    if current_task:
        current_task_dir = repo_root / current_task
        lines.append(f"Path: {current_task}")

        ct = load_task(current_task_dir)
        if ct:
            lines.append(f"Name: {ct.name}")
            lines.append(f"Status: {ct.status}")
            lines.append(f"Created: {ct.raw.get('createdAt', 'unknown')}")
            if ct.description:
                lines.append(f"Description: {ct.description}")

        # Check for prd.md
        prd_file = current_task_dir / "prd.md"
        if prd_file.is_file():
            lines.append("")
            lines.append("[!] This task has prd.md - read it for task details")
    else:
        lines.append("(none)")
    lines.append("")

    # Active tasks
    lines.append("## ACTIVE TASKS")
    tasks_dir = get_tasks_dir(repo_root)
    task_count = 0

    # Collect all task data for hierarchy display
    all_tasks = {t.dir_name: t for t in iter_active_tasks(tasks_dir)}
    all_statuses = {name: t.status for name, t in all_tasks.items()}

    def _print_task_tree(name: str, indent: int = 0) -> None:
        nonlocal task_count
        t = all_tasks[name]
        progress = children_progress(t.children, all_statuses)
        prefix = "  " * indent
        lines.append(f"{prefix}- {name}/ ({t.status}){progress} @{t.assignee or '-'}")
        task_count += 1
        for child in t.children:
            if child in all_tasks:
                _print_task_tree(child, indent + 1)

    for dir_name in sorted(all_tasks.keys()):
        if not all_tasks[dir_name].parent:
            _print_task_tree(dir_name)

    if task_count == 0:
        lines.append("(no active tasks)")
    lines.append(f"Total: {task_count} active task(s)")
    lines.append("")

    # My tasks
    lines.append("## MY TASKS (Assigned to me)")
    my_task_count = 0

    for t in all_tasks.values():
        if t.assignee == developer and t.status != "done":
            progress = children_progress(t.children, all_statuses)
            lines.append(f"- [{t.priority}] {t.title} ({t.status}){progress}")
            my_task_count += 1

    if my_task_count == 0:
        lines.append("(no tasks assigned to you)")
    lines.append("")

    # Journal file
    lines.append("## JOURNAL FILE")
    journal_file = get_active_journal_file(repo_root)
    if journal_file:
        journal_lines = count_lines(journal_file)
        relative = f"{DIR_WORKFLOW}/{DIR_WORKSPACE}/{developer}/{journal_file.name}"
        lines.append(f"Active file: {relative}")
        lines.append(f"Line count: {journal_lines} / 2000")
        if journal_lines > 1800:
            lines.append("[!] WARNING: Approaching 2000 line limit!")
    else:
        lines.append("No journal file found")
    lines.append("")

    # Packages
    packages_text = _get_packages_section(repo_root)
    if packages_text:
        lines.append(packages_text)
        lines.append("")

    # Paths
    lines.append("## PATHS")
    lines.append(f"Workspace: {DIR_WORKFLOW}/{DIR_WORKSPACE}/{developer}/")
    lines.append(f"Tasks: {DIR_WORKFLOW}/{DIR_TASKS}/")
    lines.append(f"Spec: {DIR_WORKFLOW}/{DIR_SPEC}/")
    lines.append("")

    lines.append("========================================")

    return "\n".join(lines)


def get_context_record_json(repo_root: Path | None = None) -> dict:
    """Get record-mode context as a dictionary.

    Focused on: my active tasks, git status, current task.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    developer = get_developer(repo_root)
    tasks_dir = get_tasks_dir(repo_root)

    # Git info
    _, branch_out, _ = run_git(["branch", "--show-current"], cwd=repo_root)
    branch = branch_out.strip() or "unknown"

    _, status_out, _ = run_git(["status", "--porcelain"], cwd=repo_root)
    git_status_count = len([line for line in status_out.splitlines() if line.strip()])

    _, log_out, _ = run_git(["log", "--oneline", "-5"], cwd=repo_root)
    commits = []
    for line in log_out.splitlines():
        if line.strip():
            parts = line.split(" ", 1)
            if len(parts) >= 2:
                commits.append({"hash": parts[0], "message": parts[1]})

    # My tasks (single pass — collect statuses and filter by assignee)
    all_tasks_list = list(iter_active_tasks(tasks_dir))
    all_statuses = {t.dir_name: t.status for t in all_tasks_list}

    my_tasks = []
    for t in all_tasks_list:
        if t.assignee == developer:
            done = sum(
                1 for c in t.children
                if all_statuses.get(c) in ("completed", "done")
            )
            my_tasks.append({
                "dir": t.dir_name,
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "children": list(t.children),
                "childrenDone": done,
                "parent": t.parent,
                "meta": t.meta,
            })

    # Current task
    current_task_info = None
    current_task = get_current_task(repo_root)
    if current_task:
        ct = load_task(repo_root / current_task)
        if ct:
            current_task_info = {
                "path": current_task,
                "name": ct.name,
                "status": ct.status,
            }

    return {
        "developer": developer or "",
        "git": {
            "branch": branch,
            "isClean": git_status_count == 0,
            "uncommittedChanges": git_status_count,
            "recentCommits": commits,
        },
        "myTasks": my_tasks,
        "currentTask": current_task_info,
    }


def get_context_text_record(repo_root: Path | None = None) -> str:
    """Get context as formatted text for record-session mode.

    Focused output: MY ACTIVE TASKS first (with [!!!] emphasis),
    then GIT STATUS, RECENT COMMITS, CURRENT TASK.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Formatted text output for record-session.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    lines: list[str] = []
    lines.append("========================================")
    lines.append("SESSION CONTEXT (RECORD MODE)")
    lines.append("========================================")
    lines.append("")

    developer = get_developer(repo_root)
    if not developer:
        lines.append(
            f"ERROR: Not initialized. Run: python3 ./{DIR_WORKFLOW}/{DIR_SCRIPTS}/init_developer.py <name>"
        )
        return "\n".join(lines)

    # MY ACTIVE TASKS — first and prominent
    lines.append(f"## [!!!] MY ACTIVE TASKS (Assigned to {developer})")
    lines.append("[!] Review whether any should be archived before recording this session.")
    lines.append("")

    tasks_dir = get_tasks_dir(repo_root)
    my_task_count = 0

    # Single pass — collect all tasks and filter by assignee
    all_statuses = get_all_statuses(tasks_dir)

    for t in iter_active_tasks(tasks_dir):
        if t.assignee == developer:
            progress = children_progress(t.children, all_statuses)
            lines.append(f"- [{t.priority}] {t.title} ({t.status}){progress} — {t.dir_name}")
            my_task_count += 1

    if my_task_count == 0:
        lines.append("(no active tasks assigned to you)")
    lines.append("")

    # GIT STATUS
    lines.append("## GIT STATUS")
    _, branch_out, _ = run_git(["branch", "--show-current"], cwd=repo_root)
    branch = branch_out.strip() or "unknown"
    lines.append(f"Branch: {branch}")

    _, status_out, _ = run_git(["status", "--porcelain"], cwd=repo_root)
    status_lines = [line for line in status_out.splitlines() if line.strip()]
    status_count = len(status_lines)

    if status_count == 0:
        lines.append("Working directory: Clean")
    else:
        lines.append(f"Working directory: {status_count} uncommitted change(s)")
        lines.append("")
        lines.append("Changes:")
        _, short_out, _ = run_git(["status", "--short"], cwd=repo_root)
        for line in short_out.splitlines()[:10]:
            lines.append(line)
    lines.append("")

    # RECENT COMMITS
    lines.append("## RECENT COMMITS")
    _, log_out, _ = run_git(["log", "--oneline", "-5"], cwd=repo_root)
    if log_out.strip():
        for line in log_out.splitlines():
            lines.append(line)
    else:
        lines.append("(no commits)")
    lines.append("")

    # CURRENT TASK
    lines.append("## CURRENT TASK")
    current_task = get_current_task(repo_root)
    if current_task:
        lines.append(f"Path: {current_task}")
        ct = load_task(repo_root / current_task)
        if ct:
            lines.append(f"Name: {ct.name}")
            lines.append(f"Status: {ct.status}")
    else:
        lines.append("(none)")
    lines.append("")

    lines.append("========================================")

    return "\n".join(lines)


def _resolve_scope_set(
    packages: dict,
    spec_scope,
    task_pkg: str | None,
    default_pkg: str | None,
) -> set | None:
    """Resolve spec_scope to a set of allowed package names, or None for full scan."""
    if not packages:
        return None

    if spec_scope is None:
        return None

    if isinstance(spec_scope, str) and spec_scope == "active_task":
        if task_pkg and task_pkg in packages:
            return {task_pkg}
        if default_pkg and default_pkg in packages:
            return {default_pkg}
        return None

    if isinstance(spec_scope, list):
        valid = {e for e in spec_scope if e in packages}
        if valid:
            return valid
        # All invalid: fallback
        if task_pkg and task_pkg in packages:
            return {task_pkg}
        if default_pkg and default_pkg in packages:
            return {default_pkg}
        return None

    return None


def get_context_packages_text(repo_root: Path | None = None) -> str:
    """Get packages context as formatted text (for --mode packages)."""
    if repo_root is None:
        repo_root = get_repo_root()

    pkg_info = _get_packages_info(repo_root)
    lines: list[str] = []

    if not pkg_info:
        spec_dir = repo_root / DIR_WORKFLOW / DIR_SPEC
        lines.append("Single-repo project (no packages configured)")
        lines.append("")
        layers = _scan_spec_layers(spec_dir)
        if layers:
            lines.append(f"Spec layers: {', '.join(layers)}")
        return "\n".join(lines)

    # Resolve scope for annotations
    packages_dict = get_packages(repo_root) or {}
    default_pkg = get_default_package(repo_root)
    spec_scope = get_spec_scope(repo_root)
    task_pkg = _get_active_task_package(repo_root)
    scope_set = _resolve_scope_set(packages_dict, spec_scope, task_pkg, default_pkg)

    lines.append("## PACKAGES")
    lines.append("")
    for pkg in pkg_info:
        default_tag = " (default)" if pkg["default"] else ""
        type_tag = f" [{pkg['type']}]" if pkg["type"] != "local" else ""

        # Scope annotation
        scope_tag = ""
        if scope_set is not None and pkg["name"] not in scope_set:
            scope_tag = " (out of scope)"

        lines.append(f"### {pkg['name']}{default_tag}{type_tag}{scope_tag}")
        lines.append(f"Path: {pkg['path']}")
        if pkg["specLayers"]:
            lines.append(f"Spec layers: {', '.join(pkg['specLayers'])}")
            for layer in pkg["specLayers"]:
                lines.append(f"  - .trellis/spec/{pkg['name']}/{layer}/index.md")
        else:
            lines.append("Spec: not configured")
        lines.append("")

    # Also show shared guides
    guides_dir = repo_root / DIR_WORKFLOW / DIR_SPEC / "guides"
    if guides_dir.is_dir():
        lines.append("### Shared Guides (always included)")
        lines.append("Path: .trellis/spec/guides/index.md")
        lines.append("")

    return "\n".join(lines)


def _get_active_task_package(repo_root: Path) -> str | None:
    """Get the package field from the active task's task.json."""
    current = get_current_task(repo_root)
    if not current:
        return None
    ct = load_task(repo_root / current)
    return ct.package if ct and ct.package else None


def get_context_packages_json(repo_root: Path | None = None) -> dict:
    """Get packages context as a dictionary (for --mode packages --json)."""
    if repo_root is None:
        repo_root = get_repo_root()

    pkg_info = _get_packages_info(repo_root)

    if not pkg_info:
        spec_dir = repo_root / DIR_WORKFLOW / DIR_SPEC
        layers = _scan_spec_layers(spec_dir)
        return {
            "mode": "single-repo",
            "specLayers": layers,
        }

    default_pkg = get_default_package(repo_root)
    spec_scope = get_spec_scope(repo_root)
    task_pkg = _get_active_task_package(repo_root)

    return {
        "mode": "monorepo",
        "packages": pkg_info,
        "defaultPackage": default_pkg,
        "specScope": spec_scope,
        "activeTaskPackage": task_pkg,
    }


def output_text(repo_root: Path | None = None) -> None:
    """Output context in text format.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.
    """
    print(get_context_text(repo_root))


# =============================================================================
# Main Entry
# =============================================================================


def main() -> None:
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Get Session Context for AI Agent")
    parser.add_argument(
        "--json",
        "-j",
        action="store_true",
        help="Output in JSON format (works with any --mode)",
    )
    parser.add_argument(
        "--mode",
        "-m",
        choices=["default", "record", "packages"],
        default="default",
        help="Output mode: default (full context), record (for record-session), packages (package info only)",
    )

    args = parser.parse_args()

    if args.mode == "record":
        if args.json:
            print(json.dumps(get_context_record_json(), indent=2, ensure_ascii=False))
        else:
            print(get_context_text_record())
    elif args.mode == "packages":
        if args.json:
            print(json.dumps(get_context_packages_json(), indent=2, ensure_ascii=False))
        else:
            print(get_context_packages_text())
    else:
        if args.json:
            output_json()
        else:
            output_text()


if __name__ == "__main__":
    main()
