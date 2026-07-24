#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task Management Script.

Usage:
    python3 task.py create "<title>" [--slug <name>] [--assignee <dev>] [--priority P0|P1|P2|P3] [--parent <dir>] [--package <pkg>] [--no-start]
    python3 task.py add-context <dir> <file> <path> [reason] # Add jsonl entry
    python3 task.py validate <dir>              # Validate jsonl files
    python3 task.py list-context <dir>          # List jsonl entries
    python3 task.py start <dir>                 # Set active task
    python3 task.py current [--source]          # Show active task
    python3 task.py finish                      # Clear active task
    python3 task.py set-branch <dir> <branch>   # Set git branch
    python3 task.py set-base-branch <dir> <branch>  # Set PR target branch
    python3 task.py set-scope <dir> <scope>     # Set scope for PR title
    python3 task.py archive <task-dir>          # Archive completed task
    python3 task.py list                        # List active tasks
    python3 task.py list-archive [month]        # List archived tasks
    python3 task.py add-subtask <parent-dir> <child-dir>     # Link child to parent
    python3 task.py remove-subtask <parent-dir> <child-dir>  # Unlink child from parent
    python3 task.py ready <parent-dir>          # Ready/blocked children (+ isolation)
    python3 task.py drift <parent-dir>          # Warn on json vs ## Dependencies drift
    python3 task.py deps <task-dir>             # Show depends_on + reverse dependents
    python3 task.py dispatch-ready <parent-dir> [--yes]  # Plan / spawn ready-set waves
    python3 task.py integrate <parent-dir> [--dry-run]   # Merge worktrees + verify (L4)
    python3 task.py plan-import <parent-dir> <plan.json> [--yes]  # Materialize parallel-plan.v1
"""

from __future__ import annotations

import argparse
import sys

from common.log import Colors, colored
from common.paths import (
    DIR_WORKFLOW,
    DIR_TASKS,
    FILE_TASK_JSON,
    get_repo_root,
    get_developer,
    get_tasks_dir,
    get_current_task,
)
from common.active_task import (
    clear_active_task,
    resolve_active_task,
    resolve_context_key,
    set_active_task,
)
from common.io import read_json, write_json
from common.task_utils import resolve_task_dir, run_task_hooks
from common.tasks import iter_active_tasks, children_progress

# Import command handlers from split modules (also re-exports for plan.py compatibility)
from common.task_store import (
    cmd_create,
    cmd_archive,
    cmd_set_branch,
    cmd_set_base_branch,
    cmd_set_scope,
    cmd_add_subtask,
    cmd_remove_subtask,
)
from common.task_context import (
    cmd_add_context,
    cmd_validate,
    cmd_list_context,
)
from common.task_deps import (
    evaluate_drift,
    evaluate_ready,
    get_depends_on,
    get_isolation,
    reverse_dependents,
)
from common.task_dispatch import (
    check_drift_gate,
    check_scope_gate,
    execute_waves,
    parent_may_complete,
    resolve_effective_worker,
    should_auto_confirm,
)
from common.task_integrate import execute_integrate, plan_integrate
from common.task_import import cmd_plan_import


# =============================================================================
# Command: start / finish
# =============================================================================

def cmd_start(args: argparse.Namespace) -> int:
    """Set active task."""
    repo_root = get_repo_root()
    task_input = args.dir

    if not task_input:
        print(colored("Error: task directory or name required", Colors.RED))
        return 1

    # Resolve task directory (supports task name, relative path, or absolute path)
    full_path = resolve_task_dir(task_input, repo_root)

    if not full_path.is_dir():
        print(colored(f"Error: Task not found: {task_input}", Colors.RED))
        print("Hint: Use task name (e.g., 'my-task') or full path (e.g., '.trellis/tasks/01-31-my-task')")
        return 1

    # Convert to relative path for storage
    try:
        task_dir = full_path.relative_to(repo_root).as_posix()
    except ValueError:
        task_dir = str(full_path)

    task_json_path = full_path / FILE_TASK_JSON

    if not resolve_context_key():
        # Degraded mode: no session identity available.
        # Hook didn't inject TRELLIS_CONTEXT_ID (common on Windows + Claude Code,
        # --continue resume path, fork distribution, hooks disabled, etc.). Skip
        # per-session pointer write; AI continues based on conversation context.
        print(colored(
            "ℹ Session identity not available; active-task pointer not persisted "
            "this session (degraded mode). AI continues based on conversation context.",
            Colors.YELLOW,
        ))
        print(colored(
            "Hint: run inside an AI IDE/session that exposes session identity, "
            "or set TRELLIS_CONTEXT_ID before running task.py start.",
            Colors.YELLOW,
        ))

        # Still flip task.json status: planning → in_progress so downstream phases proceed.
        if task_json_path.is_file():
            data = read_json(task_json_path)
            if data and data.get("status") == "planning":
                data["status"] = "in_progress"
                if write_json(task_json_path, data):
                    print(colored("✓ Status: planning → in_progress (degraded)", Colors.GREEN))
            run_task_hooks("after_start", task_json_path, repo_root)
        return 0

    active = set_active_task(task_dir, repo_root)
    if active:
        print(colored(f"✓ Current task set to: {task_dir}", Colors.GREEN))
        print(f"Source: {active.source}")

        if task_json_path.is_file():
            data = read_json(task_json_path)
            if data and data.get("status") == "planning":
                data["status"] = "in_progress"
                if write_json(task_json_path, data):
                    print(colored("✓ Status: planning → in_progress", Colors.GREEN))

        print()
        print(colored("The hook will now inject context from this task's jsonl files.", Colors.BLUE))

        run_task_hooks("after_start", task_json_path, repo_root)
        return 0
    else:
        print(colored("Error: Failed to set current task", Colors.RED))
        return 1


def cmd_finish(args: argparse.Namespace) -> int:
    """Clear active task."""
    repo_root = get_repo_root()
    active = clear_active_task(repo_root)
    current = active.task_path

    if not current:
        print(colored("No current task set", Colors.YELLOW))
        return 0

    # Resolve task.json path before clearing
    task_json_path = repo_root / current / FILE_TASK_JSON

    print(colored(f"✓ Cleared current task (was: {current})", Colors.GREEN))
    print(f"Source: {active.source}")

    if task_json_path.is_file():
        run_task_hooks("after_finish", task_json_path, repo_root)
    return 0


def cmd_current(args: argparse.Namespace) -> int:
    """Show active task."""
    repo_root = get_repo_root()
    active = resolve_active_task(repo_root)

    if args.source:
        print(f"Current task: {active.task_path or '(none)'}")
        print(f"Source: {active.source}")
        if active.stale:
            print("State: stale")
        return 0 if active.task_path else 1

    if active.task_path:
        print(active.task_path)
        return 0

    return 1


# =============================================================================
# Command: list
# =============================================================================

def cmd_list(args: argparse.Namespace) -> int:
    """List active tasks."""
    repo_root = get_repo_root()
    tasks_dir = get_tasks_dir(repo_root)
    current_task = get_current_task(repo_root)
    developer = get_developer(repo_root)
    filter_mine = args.mine
    filter_status = args.status

    if filter_mine:
        if not developer:
            print(colored("Error: No developer set. Run init_developer.py first", Colors.RED), file=sys.stderr)
            return 1
        print(colored(f"My tasks (assignee: {developer}):", Colors.BLUE))
    else:
        print(colored("All active tasks:", Colors.BLUE))
    print()

    # Single pass: collect all tasks via shared iterator
    all_tasks = {t.dir_name: t for t in iter_active_tasks(tasks_dir)}
    all_statuses = {name: t.status for name, t in all_tasks.items()}

    # Display tasks hierarchically
    count = 0

    def _print_task(dir_name: str, indent: int = 0) -> None:
        nonlocal count
        t = all_tasks[dir_name]

        # Apply --mine filter
        if filter_mine and (t.assignee or "-") != developer:
            return

        # Apply --status filter
        if filter_status and t.status != filter_status:
            return

        relative_path = f"{DIR_WORKFLOW}/{DIR_TASKS}/{dir_name}"
        marker = ""
        if relative_path == current_task:
            marker = f" {colored('<- current', Colors.GREEN)}"

        # Children progress
        progress = children_progress(t.children, all_statuses)

        # Package tag
        pkg_tag = f" @{t.package}" if t.package else ""

        prefix = "  " * indent + "  - "

        if filter_mine:
            print(f"{prefix}{dir_name}/ ({t.status}){pkg_tag}{progress}{marker}")
        else:
            print(f"{prefix}{dir_name}/ ({t.status}){pkg_tag}{progress} [{colored(t.assignee or '-', Colors.CYAN)}]{marker}")
        count += 1

        # Print children indented
        for child_name in t.children:
            if child_name in all_tasks:
                _print_task(child_name, indent + 1)

    # Display only top-level tasks (those without a parent)
    for dir_name in sorted(all_tasks.keys()):
        if not all_tasks[dir_name].parent:
            _print_task(dir_name)

    if count == 0:
        if filter_mine:
            print("  (no tasks assigned to you)")
        else:
            print("  (no active tasks)")

    print()
    print(f"Total: {count} task(s)")
    return 0


# =============================================================================
# Command: list-archive
# =============================================================================

def cmd_list_archive(args: argparse.Namespace) -> int:
    """List archived tasks."""
    repo_root = get_repo_root()
    tasks_dir = get_tasks_dir(repo_root)
    archive_dir = tasks_dir / "archive"
    month = args.month

    print(colored("Archived tasks:", Colors.BLUE))
    print()

    if month:
        month_dir = archive_dir / month
        if month_dir.is_dir():
            print(f"[{month}]")
            for d in sorted(month_dir.iterdir()):
                if d.is_dir():
                    print(f"  - {d.name}/")
        else:
            print(f"  No archives for {month}")
    else:
        if archive_dir.is_dir():
            for month_dir in sorted(archive_dir.iterdir()):
                if month_dir.is_dir():
                    month_name = month_dir.name
                    count = sum(1 for d in month_dir.iterdir() if d.is_dir())
                    print(f"[{month_name}] - {count} task(s)")

    return 0


# =============================================================================
# Command: ready / drift / deps (parallel orchestration MVP A)
# =============================================================================

def _fmt_isolation(value: str | None) -> str:
    return value if value else "(unset)"


def _fmt_write_scope(scopes: list[str] | tuple[str, ...] | None) -> str:
    if not scopes:
        return "(none)"
    if len(scopes) <= 2:
        return "[" + ", ".join(scopes) + "]"
    return f"[{scopes[0]}, {scopes[1]}, +{len(scopes) - 2}]"


def _fmt_dep_reason(dep_status_name: str | None, location: str) -> str:
    if location == "missing":
        return "missing"
    if dep_status_name is None:
        return "unknown"
    return f"{dep_status_name} ({location})"


def cmd_ready(args: argparse.Namespace) -> int:
    """List ready / blocked children under a parent task."""
    repo_root = get_repo_root()
    parent_path = resolve_task_dir(args.parent_dir, repo_root)
    task_json = parent_path / FILE_TASK_JSON
    if not task_json.is_file():
        print(colored(f"Error: parent task not found: {args.parent_dir}", Colors.RED))
        return 1

    tasks_dir = get_tasks_dir(repo_root)
    report = evaluate_ready(parent_path, tasks_dir)

    print(colored(f"Ready report: {report.parent}", Colors.BLUE))
    print()

    if report.cycle is not None:
        cycle_str = " → ".join(report.cycle)
        print(colored("CYCLE DETECTED (fail closed)", Colors.RED))
        print(f"  {cycle_str}")
        print()
        print("Fix depends_on edges before dispatching parallel workers.")
        return 1

    for w in report.warnings:
        print(colored(f"Warning: {w}", Colors.YELLOW))
    if report.warnings:
        print()

    print(colored(f"Ready ({len(report.ready)}):", Colors.GREEN))
    if not report.ready:
        print("  (none)")
    for info in report.ready:
        deps = ", ".join(info.depends_on) if info.depends_on else "(none)"
        print(
            f"  - {info.dir_name}  "
            f"[status={info.status}]  "
            f"isolation={_fmt_isolation(info.isolation)}  "
            f"depends_on=[{deps}]  "
            f"write_scope={_fmt_write_scope(info.write_scope)}"
        )
    print()

    print(colored(f"Blocked ({len(report.blocked)}):", Colors.YELLOW))
    if not report.blocked:
        print("  (none)")
    for info in report.blocked:
        print(
            f"  - {info.dir_name}  "
            f"[status={info.status}]  "
            f"isolation={_fmt_isolation(info.isolation)}  "
            f"write_scope={_fmt_write_scope(info.write_scope)}"
        )
        for dep in info.blocked_by:
            reason = _fmt_dep_reason(dep.status, dep.location)
            print(f"      waiting on: {dep.name}  ({reason})")
    print()

    if report.skipped:
        print(colored(f"Skipped ({len(report.skipped)}):", Colors.BLUE))
        for info in report.skipped:
            print(
                f"  - {info.dir_name}  "
                f"[status={info.status}]  "
                f"{info.skip_reason or ''}"
            )
        print()

    # Strong hint when ready set mixes worktree isolation.
    worktree_ready = [i for i in report.ready if i.isolation == "worktree"]
    if len(report.ready) > 1 and worktree_ready:
        print(colored(
            "Hint: isolation=worktree — each ready child needs its own "
            "worktree_path. Review, then: "
            "task.py dispatch-ready <parent> [--yes]",
            Colors.YELLOW,
        ))
    elif len(report.ready) > 1:
        print(colored(
            "Hint: multiple ready children — review isolation, then: "
            "task.py dispatch-ready <parent> [--yes] "
            "(default is dry-run plan only).",
            Colors.YELLOW,
        ))

    return 0


def cmd_drift(args: argparse.Namespace) -> int:
    """Warn when task.json depends_on/isolation drift from markdown.

    Non-zero exit when drift is found. Does NOT block ready / scheduling (MVP).
    """
    repo_root = get_repo_root()
    parent_path = resolve_task_dir(args.parent_dir, repo_root)
    task_json = parent_path / FILE_TASK_JSON
    if not task_json.is_file():
        print(colored(f"Error: parent task not found: {args.parent_dir}", Colors.RED))
        return 1

    tasks_dir = get_tasks_dir(repo_root)
    report = evaluate_drift(parent_path, tasks_dir)

    print(colored(f"Drift report: {report.parent}", Colors.BLUE))
    print("(json is authoritative; markdown is a human-readable projection)")
    print("Drift warnings do not block ready / scheduling in MVP.")
    print()

    for w in report.warnings:
        print(colored(f"Warning: {w}", Colors.YELLOW))
    if report.warnings:
        print()

    if not report.items:
        print(colored("No drift detected.", Colors.GREEN))
        return 0

    print(colored(f"Drift ({len(report.items)}):", Colors.YELLOW))
    for item in report.items:
        src = f" in {item.source_file}" if item.source_file else ""
        print(f"  - {item.child}.{item.field}{src}")
        print(f"      task.json: {item.json_value}")
        print(f"      markdown:  {item.md_value}")
    print()
    print("Fix by updating markdown to match task.json (or edit json, then "
          "re-dual-write). json→markdown sync is reserved for a later phase.")
    return 1


def cmd_deps(args: argparse.Namespace) -> int:
    """Show depends_on and reverse dependents for a task."""
    repo_root = get_repo_root()
    task_path = resolve_task_dir(args.task_dir, repo_root)
    task_json = task_path / FILE_TASK_JSON
    if not task_json.is_file():
        print(colored(f"Error: task not found: {args.task_dir}", Colors.RED))
        return 1

    data = read_json(task_json) or {}
    deps = get_depends_on(data)
    isolation = get_isolation(data)
    from common.task_scope import get_write_scope

    write_scope = get_write_scope(data)
    tasks_dir = get_tasks_dir(repo_root)
    reverse = reverse_dependents(tasks_dir, task_path.name)

    print(colored(f"Dependencies: {task_path.name}", Colors.BLUE))
    print(f"  isolation:  {_fmt_isolation(isolation)}")
    print(f"  depends_on: {deps if deps else '(none)'}")
    print(f"  write_scope: {write_scope if write_scope else '(none)'}")
    print(f"  depended on by: {reverse if reverse else '(none)'}")
    return 0


def _print_wave_plan(plan, *, confirm: bool, worker: str | None = None) -> None:
    print(colored(f"Dispatch plan: wave {plan.wave}", Colors.BLUE))
    if worker:
        print(f"Worker: {worker}")
    if plan.cycle is not None:
        cycle_str = " → ".join(plan.cycle)
        print(colored("CYCLE DETECTED (fail closed)", Colors.RED))
        print(f"  {cycle_str}")
        return

    for w in plan.warnings:
        print(colored(f"Warning: {w}", Colors.YELLOW))
    if plan.warnings:
        print()

    print(colored(f"Planned spawns ({len(plan.items)}):", Colors.GREEN))
    if not plan.items:
        print("  (none)")
    for item in plan.items:
        deps = ", ".join(item.depends_on) if item.depends_on else "(none)"
        print(
            f"  - {item.dir_name}  "
            f"[status={item.status}]  "
            f"isolation={_fmt_isolation(item.isolation)}  "
            f"depends_on=[{deps}]"
        )
        if item.cwd_ok:
            print(f"      cwd: {item.cwd}")
            cmd_preview = list(item.command)
            if (
                len(cmd_preview) >= 3
                and cmd_preview[0] in ("xio", "xiocode")
                and cmd_preview[1] == "-p"
            ):
                prompt = cmd_preview[2]
                cmd_preview[2] = prompt[:80] + ("…" if len(prompt) > 80 else "")
            print(f"      cmd: {' '.join(cmd_preview)}")
        else:
            print(colored(f"      cwd ERROR: {item.cwd_error}", Colors.RED))
    print()

    if plan.blocked:
        print(colored(f"Blocked ({len(plan.blocked)}):", Colors.YELLOW))
        for info in plan.blocked:
            print(
                f"  - {info.dir_name}  "
                f"[status={info.status}]  "
                f"isolation={_fmt_isolation(info.isolation)}"
            )
            for dep in info.blocked_by:
                reason = _fmt_dep_reason(dep.status, dep.location)
                print(f"      waiting on: {dep.name}  ({reason})")
        print()

    if plan.skipped:
        print(colored(f"Skipped ({len(plan.skipped)}):", Colors.BLUE))
        for info in plan.skipped:
            print(
                f"  - {info.dir_name}  "
                f"[status={info.status}]  "
                f"{info.skip_reason or ''}"
            )
        print()

    if not confirm:
        print(colored(
            "Dry-run only (no spawn). Re-run with --yes or set "
            "parallel.auto_confirm: true to execute.",
            Colors.YELLOW,
        ))
    elif plan.items:
        worktree_missing = [
            i for i in plan.items
            if i.isolation == "worktree" and not i.cwd_ok
        ]
        if worktree_missing:
            print(colored(
                "Fail closed: isolation=worktree children need an existing "
                "worktree_path before spawn.",
                Colors.RED,
            ))


def cmd_dispatch_ready(args: argparse.Namespace) -> int:
    """Plan or execute ready-set channel/xio spawns (Phase B/C).

    Default: print plan and exit 0 (human confirm).
    With --yes or parallel.auto_confirm: spawn waves via configured worker.
    """
    repo_root = get_repo_root()
    parent_path = resolve_task_dir(args.parent_dir, repo_root)
    task_json = parent_path / FILE_TASK_JSON
    if not task_json.is_file():
        print(colored(f"Error: parent task not found: {args.parent_dir}", Colors.RED))
        return 1

    tasks_dir = get_tasks_dir(repo_root)
    confirm = should_auto_confirm(bool(getattr(args, "yes", False)), repo_root)
    worker, _ = resolve_effective_worker(repo_root)

    print(colored(f"Dispatch-ready: {parent_path.name}", Colors.BLUE))
    print(f"Mode: {'EXECUTE (--yes / auto_confirm)' if confirm else 'DRY-RUN (plan only)'}")
    print(f"Worker: {worker}")
    print()

    if confirm:
        drift_err = check_drift_gate(parent_path, tasks_dir, repo_root)
        if drift_err:
            print(colored(f"Error: {drift_err}", Colors.RED))
            return 1
        scope_err, scope_warns = check_scope_gate(parent_path, tasks_dir, repo_root)
        for w in scope_warns:
            print(colored(f"Warning: {w}", Colors.YELLOW))
        if scope_err:
            print(colored(f"Error: {scope_err}", Colors.RED))
            return 1

    exit_code, plans, results = execute_waves(
        parent_path,
        tasks_dir,
        repo_root,
        confirm=confirm,
    )

    if not plans:
        print(colored("No plan produced.", Colors.YELLOW))
        return exit_code

    # Always print the first (or only dry-run) wave plan.
    _print_wave_plan(plans[0], confirm=confirm, worker=worker)

    if confirm:
        for plan in plans[1:]:
            print()
            _print_wave_plan(plan, confirm=True, worker=worker)

        if results:
            print(colored("Spawn results:", Colors.BLUE))
            for r in results:
                color = Colors.GREEN if r.ok else Colors.RED
                label = "ok" if r.ok else "FAIL"
                print(colored(
                    f"  [{label}] {r.dir_name}  attempts={r.attempts}  {r.message}",
                    color,
                ))
            print()

        ok_parent, reason = parent_may_complete(parent_path, tasks_dir)
        if not ok_parent:
            print(colored(f"Parent complete gate: {reason}", Colors.YELLOW))

        all_ok = exit_code == 0 and not any(not r.ok for r in results)
        if all_ok:
            print(colored("All required ready waves finished.", Colors.GREEN))
            print()
            do_integrate = bool(getattr(args, "integrate", False))
            if do_integrate:
                print(colored("Integrate (--integrate):", Colors.BLUE))
                integ = execute_integrate(
                    parent_path,
                    tasks_dir,
                    repo_root,
                    dry_run=False,
                    create_fix_task=not bool(getattr(args, "no_fix_task", False)),
                    skip_verify=bool(getattr(args, "skip_verify", False)),
                )
                color = Colors.GREEN if integ.ok else Colors.RED
                print(colored(f"  {integ.message}", color))
                if not integ.ok:
                    exit_code = 1
            else:
                print(colored("Integrate handoff (auto dry-run):", Colors.BLUE))
                integ_plan = plan_integrate(parent_path, tasks_dir, repo_root)
                print(f"  targets: {len(integ_plan.targets)}")
                for t in integ_plan.targets:
                    print(f"  - {t.dir_name}  branch={t.branch}")
                if integ_plan.noop_reason:
                    print(f"  noop: {integ_plan.noop_reason}")
                print(colored(
                    f"Next: `task.py integrate {parent_path.name}` "
                    f"or re-run `dispatch-ready {parent_path.name} --yes --integrate`",
                    Colors.GREEN,
                ))

    return exit_code


def cmd_integrate(args: argparse.Namespace) -> int:
    """Merge worktree child branches + project verify (Full-form L4)."""
    repo_root = get_repo_root()
    parent_path = resolve_task_dir(args.parent_dir, repo_root)
    task_json = parent_path / FILE_TASK_JSON
    if not task_json.is_file():
        print(colored(f"Error: parent task not found: {args.parent_dir}", Colors.RED))
        return 1

    tasks_dir = get_tasks_dir(repo_root)
    dry_run = bool(getattr(args, "dry_run", False))
    plan = plan_integrate(parent_path, tasks_dir, repo_root)

    print(colored(f"Integrate: {parent_path.name}", Colors.BLUE))
    print(f"Mode: {'DRY-RUN' if dry_run else 'EXECUTE'}")
    print(f"Base branch: {plan.base_branch}")
    print(f"Verify: {plan.verify_command or '(none)'}")
    print()

    if plan.blocked_reason:
        print(colored(f"Error: {plan.blocked_reason}", Colors.RED))
        return 1

    if plan.noop_reason:
        print(colored(f"No-op: {plan.noop_reason}", Colors.YELLOW))
    elif plan.targets:
        print(colored(f"Merge targets ({len(plan.targets)}):", Colors.GREEN))
        for t in plan.targets:
            wt = t.worktree_path or "(branch only)"
            print(f"  - {t.dir_name}  branch={t.branch}  worktree={wt}")
        print()
    else:
        print("  (no merge targets)")
        print()

    result = execute_integrate(
        parent_path,
        tasks_dir,
        repo_root,
        dry_run=dry_run,
        create_fix_task=not bool(getattr(args, "no_fix_task", False)),
        skip_verify=bool(getattr(args, "skip_verify", False)),
    )

    color = Colors.GREEN if result.ok else Colors.RED
    print(colored(result.message, color))
    if result.fix_task_dir:
        print(colored(
            f"Serial fix task: {result.fix_task_dir} "
            "(resolve conflict, then re-run integrate)",
            Colors.YELLOW,
        ))
    if result.ok and not dry_run and not result.noop:
        print(colored(
            "Parent may now archive (integrate_ok set).",
            Colors.GREEN,
        ))
    return 0 if result.ok else 1


# =============================================================================
# Help
# =============================================================================

def show_usage() -> None:
    """Show usage help."""
    print("""Task Management Script

Usage:
  python3 task.py create <title>                     Create new task directory
  python3 task.py create <title> --package <pkg>     Create task for a specific package
  python3 task.py create <title> --parent <dir>      Create task as child of parent
  python3 task.py create <title> --no-start          Create without making it active in this session
  python3 task.py add-context <dir> <jsonl> <path> [reason]  Add entry to jsonl
  python3 task.py validate <dir>                     Validate jsonl files
  python3 task.py list-context <dir>                 List jsonl entries
  python3 task.py start <dir>                        Set active task
  python3 task.py current [--source]                 Show active task
  python3 task.py finish                             Clear active task
  python3 task.py set-branch <dir> <branch>          Set git branch
  python3 task.py set-base-branch <dir> <branch>     Set PR target branch
  python3 task.py set-scope <dir> <scope>            Set scope for PR title
  python3 task.py archive <task-dir>                 Archive completed task
  python3 task.py add-subtask <parent> <child>       Link child task to parent
  python3 task.py remove-subtask <parent> <child>    Unlink child from parent
  python3 task.py ready <parent-dir>                 List ready/blocked children (+ isolation)
  python3 task.py drift <parent-dir>                 Warn on json vs ## Dependencies drift
  python3 task.py deps <task-dir>                    Show depends_on + reverse dependents
  python3 task.py dispatch-ready <parent-dir> [--yes]  Plan/spawn ready-set waves (Phase B/C)
  python3 task.py integrate <parent-dir> [--dry-run]   Merge worktrees + verify (L4)
  python3 task.py plan-import <parent> <plan.json> [--yes]  Materialize parallel-plan.v1 children
  python3 task.py list [--mine] [--status <status>]  List tasks
  python3 task.py list-archive [YYYY-MM]             List archived tasks

Monorepo options:
  --package <pkg>      Package name (validated against config.yaml packages)

List options:
  --mine, -m           Show only tasks assigned to current developer
  --status, -s <s>     Filter by status (planning, in_progress, review, completed)

Examples:
  python3 task.py create "Add login feature" --slug add-login
  python3 task.py create "Add login feature" --slug add-login --package cli
  python3 task.py create "Child task" --slug child --parent .trellis/tasks/01-21-parent
  python3 task.py add-context <dir> implement .trellis/spec/cli/backend/auth.md "Auth guidelines"
  python3 task.py set-branch <dir> task/add-login
  python3 task.py start .trellis/tasks/01-21-add-login
  python3 task.py current --source
  python3 task.py finish
  python3 task.py archive add-login
  python3 task.py add-subtask parent-task child-task  # Link existing tasks
  python3 task.py remove-subtask parent-task child-task
  python3 task.py ready parent-task                  # Ready/blocked under parent
  python3 task.py drift parent-task                  # Dual-write drift warnings
  python3 task.py dispatch-ready parent-task         # Dry-run spawn plan
  python3 task.py dispatch-ready parent-task --yes   # Spawn ready set (xio/channel)
  python3 task.py integrate parent-task              # Merge worktrees + verify
  python3 task.py integrate parent-task --dry-run    # Plan integrate only
  python3 task.py plan-import parent-task plan.json  # Dry-run parallel-plan.v1 import
  python3 task.py plan-import parent-task plan.json --yes  # Materialize + worktrees
  python3 task.py deps child-task                    # depends_on + reverse deps
  python3 task.py list                               # List all active tasks
  python3 task.py list --mine                        # List my tasks only
  python3 task.py list --mine --status in_progress   # List my in-progress tasks
""")


# =============================================================================
# Main Entry
# =============================================================================

def main() -> int:
    """CLI entry point."""
    # Deprecation guard: `init-context` was removed in v0.5.0-beta.12.
    # Detect early so argparse doesn't mask the real reason with a generic
    # "invalid choice" error.
    if len(sys.argv) >= 2 and sys.argv[1] == "init-context":
        print(
            colored(
                "Error: `task.py init-context` was removed in v0.5.0-beta.12.",
                Colors.RED,
            ),
            file=sys.stderr,
        )
        print(
            "implement.jsonl / check.jsonl are now seeded on `task.py create` for",
            file=sys.stderr,
        )
        print(
            "sub-agent-capable platforms and curated by the AI during planning when needed.",
            file=sys.stderr,
        )
        print("See .trellis/workflow.md planning artifact guidance or run:", file=sys.stderr)
        print(
            "  python3 ./.trellis/scripts/get_context.py --mode phase --step 1",
            file=sys.stderr,
        )
        print(
            "Use `task.py add-context <dir> implement|check <path> <reason>` to append entries.",
            file=sys.stderr,
        )
        return 2

    parser = argparse.ArgumentParser(
        description="Task Management Script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # create
    p_create = subparsers.add_parser("create", help="Create new task")
    p_create.add_argument("title", help="Task title")
    p_create.add_argument("--slug", "-s", help="Task slug without the MM-DD date prefix")
    p_create.add_argument("--assignee", "-a", help="Assignee developer")
    p_create.add_argument("--priority", "-p", default="P2", help="Priority (P0-P3)")
    p_create.add_argument("--description", "-d", help="Task description")
    p_create.add_argument("--parent", help="Parent task directory (establishes subtask link)")
    p_create.add_argument("--package", help="Package name for monorepo projects")
    p_create.add_argument(
        "--no-start",
        action="store_true",
        help="Create the task without making it active in this session",
    )

    # add-context
    p_add = subparsers.add_parser("add-context", help="Add context entry")
    p_add.add_argument("dir", help="Task directory")
    p_add.add_argument("file", help="JSONL file (implement|check)")
    p_add.add_argument("path", help="File path to add")
    p_add.add_argument("reason", nargs="?", help="Reason for adding")

    # validate
    p_validate = subparsers.add_parser("validate", help="Validate context files")
    p_validate.add_argument("dir", help="Task directory")

    # list-context
    p_listctx = subparsers.add_parser("list-context", help="List context entries")
    p_listctx.add_argument("dir", help="Task directory")

    # start
    p_start = subparsers.add_parser("start", help="Set active task")
    p_start.add_argument("dir", help="Task directory")

    # current
    p_current = subparsers.add_parser("current", help="Show active task")
    p_current.add_argument("--source", action="store_true",
                           help="Show active task source")

    # finish
    subparsers.add_parser("finish", help="Clear active task")

    # set-branch
    p_branch = subparsers.add_parser("set-branch", help="Set git branch")
    p_branch.add_argument("dir", help="Task directory")
    p_branch.add_argument("branch", help="Branch name")

    # set-base-branch
    p_base = subparsers.add_parser("set-base-branch", help="Set PR target branch")
    p_base.add_argument("dir", help="Task directory")
    p_base.add_argument("base_branch", help="Base branch name (PR target)")

    # set-scope
    p_scope = subparsers.add_parser("set-scope", help="Set scope")
    p_scope.add_argument("dir", help="Task directory")
    p_scope.add_argument("scope", help="Scope name")

    # archive
    p_archive = subparsers.add_parser("archive", help="Archive task")
    p_archive.add_argument("name", help="Task directory or name")
    p_archive.add_argument("--no-commit", action="store_true", help="Skip auto git commit after archive")

    # list
    p_list = subparsers.add_parser("list", help="List tasks")
    p_list.add_argument("--mine", "-m", action="store_true", help="My tasks only")
    p_list.add_argument("--status", "-s", help="Filter by status")

    # add-subtask
    p_addsub = subparsers.add_parser("add-subtask", help="Link child task to parent")
    p_addsub.add_argument("parent_dir", help="Parent task directory")
    p_addsub.add_argument("child_dir", help="Child task directory")

    # remove-subtask
    p_rmsub = subparsers.add_parser("remove-subtask", help="Unlink child task from parent")
    p_rmsub.add_argument("parent_dir", help="Parent task directory")
    p_rmsub.add_argument("child_dir", help="Child task directory")

    # ready — parallel orchestration MVP A
    p_ready = subparsers.add_parser(
        "ready",
        help="List ready/blocked children under a parent (depends_on / isolation)",
    )
    p_ready.add_argument("parent_dir", help="Parent task directory")

    # drift — json vs markdown ## Dependencies (warn only; does not block ready)
    p_drift = subparsers.add_parser(
        "drift",
        help="Warn when task.json depends_on/isolation drift from markdown",
    )
    p_drift.add_argument("parent_dir", help="Parent task directory")

    # deps — show depends_on + reverse dependents
    p_deps = subparsers.add_parser(
        "deps",
        help="Show depends_on and reverse dependents for a task",
    )
    p_deps.add_argument("task_dir", help="Task directory")

    # dispatch-ready — Phase B/C auto/semi-auto spawn
    p_dispatch = subparsers.add_parser(
        "dispatch-ready",
        help="Plan or spawn workers for the ready set (Phase B/C; default worker=xio)",
    )
    p_dispatch.add_argument("parent_dir", help="Parent task directory")
    p_dispatch.add_argument(
        "--yes",
        action="store_true",
        help="Execute spawns (default is dry-run plan only)",
    )
    p_dispatch.add_argument(
        "--integrate",
        action="store_true",
        help="After all-green waves, run real integrate (default: dry-run handoff only)",
    )
    p_dispatch.add_argument(
        "--no-fix-task",
        action="store_true",
        help="With --integrate, do not create a serial fix task stub on conflict",
    )
    p_dispatch.add_argument(
        "--skip-verify",
        action="store_true",
        help="With --integrate, skip parallel.verify_command after merges",
    )

    # integrate — Full-form L4 parent merge + verify
    p_integrate = subparsers.add_parser(
        "integrate",
        help="Merge worktree child branches + verify (Full-form L4)",
    )
    p_integrate.add_argument("parent_dir", help="Parent task directory")
    p_integrate.add_argument(
        "--dry-run",
        action="store_true",
        help="Print plan only; do not merge or write meta",
    )
    p_integrate.add_argument(
        "--no-fix-task",
        action="store_true",
        help="On conflict, do not create a serial fix task stub",
    )
    p_integrate.add_argument(
        "--skip-verify",
        action="store_true",
        help="Skip parallel.verify_command after merges (not recommended)",
    )

    # plan-import — parallel-plan.v1 batch materialize
    p_plan_import = subparsers.add_parser(
        "plan-import",
        help="Materialize parallel-plan.v1 children under a parent (default dry-run)",
    )
    p_plan_import.add_argument("parent_dir", help="Parent task directory")
    p_plan_import.add_argument("plan_json", help="Path to parallel-plan.v1 JSON")
    p_plan_import.add_argument(
        "--yes",
        action="store_true",
        help="Execute materialization (default is dry-run plan only)",
    )

    # list-archive
    p_listarch = subparsers.add_parser("list-archive", help="List archived tasks")
    p_listarch.add_argument("month", nargs="?", help="Month (YYYY-MM)")

    args = parser.parse_args()

    if not args.command:
        show_usage()
        return 1

    commands = {
        "create": cmd_create,
        "add-context": cmd_add_context,
        "validate": cmd_validate,
        "list-context": cmd_list_context,
        "start": cmd_start,
        "current": cmd_current,
        "finish": cmd_finish,
        "set-branch": cmd_set_branch,
        "set-base-branch": cmd_set_base_branch,
        "set-scope": cmd_set_scope,
        "archive": cmd_archive,
        "add-subtask": cmd_add_subtask,
        "remove-subtask": cmd_remove_subtask,
        "ready": cmd_ready,
        "drift": cmd_drift,
        "deps": cmd_deps,
        "dispatch-ready": cmd_dispatch_ready,
        "integrate": cmd_integrate,
        "plan-import": cmd_plan_import,
        "list": cmd_list,
        "list-archive": cmd_list_archive,
    }

    if args.command in commands:
        return commands[args.command](args)
    else:
        show_usage()
        return 1


if __name__ == "__main__":
    sys.exit(main())
