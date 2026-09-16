"""
Phase B/C: dispatch-ready orchestration.

Dry-run prints a spawn plan. With --yes / parallel.auto_confirm, spawns
workers for the ready set, waits, writes child status, recomputes
the next wave. Failure does not unlock downstream dependents.

Spawn backend (Phase C):
  - parallel.worker=xio (default): `xio -p …` in the child cwd with
    Active task + planning artifacts injected into the prompt
  - parallel.worker=channel (or claude/codex): `trellis channel run`
  - If xio is missing and worker_fallback=channel, fall back with a warning
  - TRELLIS_DISPATCH_BACKEND=mock: no real spawn; success unless
    task.json meta.dispatch_fail is truthy (for tests)

MergeGate alignment (Phase C contract): conflict never auto-merges;
parent integration is `task.py integrate` (L4). xiocode MergeGate remains
user-ask only. Trellis owns depends_on; xiocode does not.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from .config import (
    get_parallel_agent,
    get_parallel_auto_confirm,
    get_parallel_context_max_chars,
    get_parallel_drift_fail_closed,
    get_parallel_max_concurrency,
    get_parallel_max_retries,
    get_parallel_timeout,
    get_parallel_wall_timeout_seconds,
    get_parallel_worker,
    get_parallel_worker_fallback,
)
from .io import read_json, write_json
from .paths import FILE_TASK_JSON
from .task_deps import (
    DONE_STATUSES,
    ChildReadyInfo,
    ReadyReport,
    evaluate_drift,
    evaluate_ready,
)

# Planning artifacts injected into worker prompts (order preserved).
_CONTEXT_ARTIFACTS = ("prd.md", "design.md", "implement.md", "implement.jsonl", "check.jsonl")

# Status written when a dispatched worker fails after retries.
FAILED_STATUS = "failed"


@dataclass
class SpawnPlanItem:
    """One planned (or executed) child spawn."""

    dir_name: str
    isolation: str | None
    status: str
    depends_on: tuple[str, ...]
    cwd: str | None
    cwd_ok: bool
    cwd_error: str | None = None
    command: list[str] = field(default_factory=list)


@dataclass
class WavePlan:
    wave: int
    items: list[SpawnPlanItem] = field(default_factory=list)
    blocked: list[ChildReadyInfo] = field(default_factory=list)
    skipped: list[ChildReadyInfo] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    cycle: list[str] | None = None


@dataclass
class SpawnResult:
    dir_name: str
    ok: bool
    attempts: int
    message: str = ""
    exit_code: int | None = None


SpawnFn = Callable[[SpawnPlanItem, Path, Path], SpawnResult]


def _truthy_meta(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def resolve_worker_cwd(
    child_dir: Path,
    data: dict,
    isolation: str | None,
    repo_root: Path,
) -> tuple[str | None, str | None]:
    """Return (cwd, error). worktree isolation requires an existing worktree_path."""
    if isolation == "worktree":
        raw = data.get("worktree_path")
        if not raw or not str(raw).strip():
            return None, (
                "isolation=worktree requires task.json worktree_path "
                "(pre-create the worktree; dispatch will not invent one)"
            )
        wt = Path(str(raw).strip()).expanduser()
        if not wt.is_absolute():
            wt = (repo_root / wt).resolve()
        else:
            wt = wt.resolve()
        if not wt.is_dir():
            return str(wt), f"worktree_path does not exist or is not a directory: {wt}"
        return str(wt), None

    # shared / unset → repo root (same cwd allowed for shared)
    return str(repo_root.resolve()), None


def _safe_worker_name(dir_name: str) -> str:
    # Channel worker names should be short-ish; keep alnum/dash.
    cleaned = "".join(c if c.isalnum() or c in "-_" else "-" for c in dir_name)
    return cleaned[:48] or "worker"


def build_worker_context_message(
    child_dir: Path,
    repo_root: Path,
    *,
    max_chars: int,
) -> str:
    """Build Active-task prompt with truncated planning artifacts (Phase C)."""
    try:
        rel_task = child_dir.relative_to(repo_root).as_posix()
    except ValueError:
        rel_task = str(child_dir)
    parts: list[str] = [
        f"Active task: {rel_task}",
        "You are a Trellis parallel worker. Implement and finish this child "
        "task per prd.md / design.md / implement.md (injected below when "
        "present). On success the dispatcher marks status=completed.",
        "Do not merge worktrees yourself — parent runs task.py integrate "
        "(MergeGate-aligned; user/serial fix on conflict).",
        "",
    ]
    budget = max(1000, max_chars)
    used = sum(len(p) + 1 for p in parts)
    for name in _CONTEXT_ARTIFACTS:
        path = child_dir / name
        if not path.is_file():
            continue
        try:
            body = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        header = f"----- {name} -----\n"
        remaining = budget - used - len(header) - 20
        if remaining <= 0:
            parts.append(f"[truncated: skipped remaining artifacts at {name}]")
            break
        if len(body) > remaining:
            body = body[:remaining] + "\n…[truncated]"
        chunk = header + body
        parts.append(chunk)
        used += len(chunk) + 1
    return "\n".join(parts)


def resolve_effective_worker(repo_root: Path) -> tuple[str, str | None]:
    """Return (worker, warning). Applies PATH check + fallback for xio."""
    preferred = get_parallel_worker(repo_root)
    if preferred == "xio":
        if shutil.which("xio") or shutil.which("xiocode"):
            return "xio", None
        fallback = get_parallel_worker_fallback(repo_root)
        if fallback == "channel":
            return (
                "channel",
                "xio not on PATH; falling back to parallel.worker=channel "
                "(trellis channel run). Install xio or set parallel.worker: channel.",
            )
        return (
            "xio",
            "xio not on PATH and worker_fallback disabled — spawn will fail",
        )
    return preferred, None


def build_channel_run_command(
    item: SpawnPlanItem,
    child_dir: Path,
    repo_root: Path,
    agent: str,
    timeout: str,
) -> list[str]:
    """Build `trellis channel run` argv for one child."""
    message = build_worker_context_message(
        child_dir,
        repo_root,
        max_chars=get_parallel_context_max_chars(repo_root),
    )
    # Channel --message stays short; full files still passed via --file/--jsonl.
    short = (
        message.split("\n\n", 1)[0]
        if "\n\n" in message
        else message[:500]
    )
    cmd = [
        "trellis",
        "channel",
        "run",
        f"dispatch-{item.dir_name}",
        "--agent",
        agent,
        "--as",
        _safe_worker_name(item.dir_name),
        "--cwd",
        item.cwd or str(repo_root),
        "--timeout",
        timeout,
        "--message",
        short,
    ]
    implement_jsonl = child_dir / "implement.jsonl"
    if implement_jsonl.is_file():
        cmd.extend(["--jsonl", str(implement_jsonl)])
    for name in ("prd.md", "design.md", "implement.md"):
        p = child_dir / name
        if p.is_file():
            cmd.extend(["--file", str(p)])
    return cmd


def build_xio_run_command(
    item: SpawnPlanItem,
    child_dir: Path,
    repo_root: Path,
) -> list[str]:
    """Build `xio -p …` argv; subprocess cwd is the worker worktree/repo."""
    binary = "xio" if shutil.which("xio") else "xiocode"
    message = build_worker_context_message(
        child_dir,
        repo_root,
        max_chars=get_parallel_context_max_chars(repo_root),
    )
    return [binary, "-p", message]


def build_spawn_command(
    item: SpawnPlanItem,
    child_dir: Path,
    repo_root: Path,
    agent: str,
    timeout: str,
    worker: str,
) -> tuple[list[str], str | None]:
    """Return (argv, error). error set when worker cannot be launched."""
    if worker == "xio":
        if not (shutil.which("xio") or shutil.which("xiocode")):
            return [], (
                "parallel.worker=xio but neither xio nor xiocode is on PATH "
                "(set parallel.worker: channel or install xio)"
            )
        return build_xio_run_command(item, child_dir, repo_root), None
    return build_channel_run_command(item, child_dir, repo_root, agent, timeout), None


def plan_wave(
    parent_dir: Path,
    tasks_dir: Path,
    repo_root: Path,
    wave: int,
    agent: str,
    timeout: str,
) -> WavePlan:
    report = evaluate_ready(parent_dir, tasks_dir)
    worker, worker_warn = resolve_effective_worker(repo_root)
    plan = WavePlan(
        wave=wave,
        blocked=list(report.blocked),
        skipped=list(report.skipped),
        warnings=list(report.warnings),
        cycle=report.cycle,
    )
    if worker_warn:
        plan.warnings.append(worker_warn)
    if report.cycle is not None:
        return plan

    for info in report.ready:
        child_dir = tasks_dir / info.dir_name
        data = read_json(child_dir / FILE_TASK_JSON) or {}
        cwd, err = resolve_worker_cwd(child_dir, data, info.isolation, repo_root)
        item = SpawnPlanItem(
            dir_name=info.dir_name,
            isolation=info.isolation,
            status=info.status,
            depends_on=info.depends_on,
            cwd=cwd,
            cwd_ok=err is None,
            cwd_error=err,
        )
        if item.cwd_ok:
            cmd, cmd_err = build_spawn_command(
                item, child_dir, repo_root, agent, timeout, worker
            )
            if cmd_err:
                item.cwd_ok = False
                item.cwd_error = cmd_err
            else:
                item.command = cmd
        plan.items.append(item)
    return plan


def mock_spawn(item: SpawnPlanItem, child_dir: Path, _repo_root: Path) -> SpawnResult:
    """Test backend: succeed unless meta.dispatch_fail is set."""
    data = read_json(child_dir / FILE_TASK_JSON) or {}
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    if _truthy_meta(meta.get("dispatch_fail")):
        return SpawnResult(
            dir_name=item.dir_name,
            ok=False,
            attempts=1,
            message="mock failure (meta.dispatch_fail)",
            exit_code=1,
        )
    # Optional artificial delay for race tests
    delay = meta.get("dispatch_mock_delay_ms")
    if delay is not None:
        try:
            time.sleep(max(0, float(delay)) / 1000.0)
        except (TypeError, ValueError):
            pass
    return SpawnResult(
        dir_name=item.dir_name,
        ok=True,
        attempts=1,
        message="mock success",
        exit_code=0,
    )


def channel_spawn(item: SpawnPlanItem, child_dir: Path, repo_root: Path) -> SpawnResult:
    """Run the planned spawn command for one child (blocking).

    For ``xio`` workers the subprocess cwd is the child worktree/shared root
    (``item.cwd``). For ``trellis channel run`` the CLI itself receives
    ``--cwd`` and we keep the process cwd at repo_root.
    """
    if not item.command:
        return SpawnResult(
            dir_name=item.dir_name,
            ok=False,
            attempts=1,
            message=item.cwd_error or "no spawn command",
            exit_code=1,
        )
    binary = item.command[0]
    if binary == "trellis" and shutil.which("trellis") is None:
        return SpawnResult(
            dir_name=item.dir_name,
            ok=False,
            attempts=1,
            message="trellis CLI not found on PATH",
            exit_code=127,
        )
    if binary in ("xio", "xiocode") and shutil.which(binary) is None:
        return SpawnResult(
            dir_name=item.dir_name,
            ok=False,
            attempts=1,
            message=f"{binary} not found on PATH",
            exit_code=127,
        )
    proc_cwd = item.cwd if binary in ("xio", "xiocode") else str(repo_root)
    try:
        proc = subprocess.run(
            item.command,
            cwd=proc_cwd or str(repo_root),
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        return SpawnResult(
            dir_name=item.dir_name,
            ok=False,
            attempts=1,
            message=str(exc),
            exit_code=1,
        )
    ok = proc.returncode == 0
    detail = (proc.stderr or proc.stdout or "").strip()
    if len(detail) > 500:
        detail = detail[:500] + "…"
    return SpawnResult(
        dir_name=item.dir_name,
        ok=ok,
        attempts=1,
        message=detail or ("ok" if ok else f"exit {proc.returncode}"),
        exit_code=proc.returncode,
    )


def select_spawn_fn() -> SpawnFn:
    backend = os.environ.get("TRELLIS_DISPATCH_BACKEND", "").strip().lower()
    if backend == "mock":
        return mock_spawn
    return channel_spawn


def write_child_status(
    child_dir: Path,
    status: str,
    *,
    error: str | None = None,
    attempts: int | None = None,
) -> None:
    path = child_dir / FILE_TASK_JSON
    data = read_json(path) or {}
    data["status"] = status
    today = datetime.now().strftime("%Y-%m-%d")
    if status in DONE_STATUSES:
        data["completedAt"] = today
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    meta = dict(meta)
    dispatch = dict(meta.get("dispatch") or {}) if isinstance(meta.get("dispatch"), dict) else {}
    dispatch["updated_at"] = today
    if attempts is not None:
        dispatch["attempts"] = attempts
    if error:
        dispatch["error"] = error
        meta["dispatch_fail"] = True
    elif status in DONE_STATUSES:
        dispatch.pop("error", None)
        meta.pop("dispatch_fail", None)
    meta["dispatch"] = dispatch
    data["meta"] = meta
    write_json(path, data)


def run_spawn_with_retries(
    item: SpawnPlanItem,
    child_dir: Path,
    repo_root: Path,
    spawn_fn: SpawnFn,
    max_retries: int,
) -> SpawnResult:
    attempts = 0
    last = SpawnResult(dir_name=item.dir_name, ok=False, attempts=0, message="not started")
    # max_retries = extra attempts after the first; total = 1 + max_retries
    total = max(1, 1 + max(0, max_retries))
    while attempts < total:
        attempts += 1
        last = spawn_fn(item, child_dir, repo_root)
        last.attempts = attempts
        if last.ok:
            return last
    return last


def parent_needs_integrate(parent_dir: Path, tasks_dir: Path) -> bool:
    """True when any required child used worktree isolation (needs merge gate)."""
    data = read_json(parent_dir / FILE_TASK_JSON) or {}
    children = list(data.get("children") or [])
    for name in children:
        child_path = tasks_dir / name
        cj = child_path / FILE_TASK_JSON
        if not cj.is_file():
            from .task_deps import find_archived_task

            archived = find_archived_task(tasks_dir, name)
            if archived is None:
                continue
            cj = archived / FILE_TASK_JSON
            if not cj.is_file():
                continue
        child = read_json(cj) or {}
        if str(child.get("isolation") or "") == "worktree":
            return True
    return False


def parent_may_complete(parent_dir: Path, tasks_dir: Path) -> tuple[bool, str]:
    """Parents with required children must not complete if any child failed or is incomplete.

    Full-form (L4): when any child used isolation=worktree, parent must also
    have run ``task.py integrate`` successfully (meta.integrate_ok or
    meta.integrate_noop). Aligns with xiocode MergeGate: never pretend a
    parallel worktree wave merged cleanly without an explicit integrate step.
    """
    data = read_json(parent_dir / FILE_TASK_JSON) or {}
    children = list(data.get("children") or [])
    if not children:
        return True, ""

    incomplete: list[str] = []
    failed: list[str] = []
    for name in children:
        child_path = tasks_dir / name
        cj = child_path / FILE_TASK_JSON
        if not cj.is_file():
            # Archived children count as done (same as ready evaluator).
            from .task_deps import find_archived_task

            archived = find_archived_task(tasks_dir, name)
            if archived is None:
                incomplete.append(f"{name} (missing)")
            continue
        child = read_json(cj) or {}
        # Plain tree children are organizational — archiving unlinks them.
        # Only parallel-graph children (depends_on edges / worktree
        # isolation) block completion while unfinished.
        is_graph_child = (
            bool(child.get("depends_on"))
            or child.get("isolation") == "worktree"
            or bool(child.get("worktree_path"))
        )
        status = str(child.get("status", "unknown"))
        if is_graph_child and status == FAILED_STATUS:
            failed.append(name)
        elif is_graph_child and status not in DONE_STATUSES:
            incomplete.append(f"{name} ({status})")

    if failed:
        return False, (
            "parent cannot complete: failed children must be fixed or removed — "
            + ", ".join(failed)
        )
    if incomplete:
        return False, (
            "parent cannot complete: required children not done — "
            + ", ".join(incomplete)
        )

    if parent_needs_integrate(parent_dir, tasks_dir):
        meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
        if not meta.get("integrate_ok") and not meta.get("integrate_noop"):
            return False, (
                "parent cannot complete: worktree children require "
                f"`task.py integrate {parent_dir.name}` "
                "(MergeGate-aligned merge + verify; conflict degrades to serial fix)"
            )
    return True, ""


def execute_waves(
    parent_dir: Path,
    tasks_dir: Path,
    repo_root: Path,
    *,
    confirm: bool,
    spawn_fn: SpawnFn | None = None,
) -> tuple[int, list[WavePlan], list[SpawnResult]]:
    """Execute (or dry-run) dispatch waves until no ready set or a hard stop.

    Returns (exit_code, plans, results).
    """
    agent = get_parallel_agent(repo_root)
    timeout = get_parallel_timeout(repo_root)
    max_retries = get_parallel_max_retries(repo_root)
    max_concurrency = get_parallel_max_concurrency(repo_root)
    wall_seconds = get_parallel_wall_timeout_seconds(repo_root)
    spawn = spawn_fn or select_spawn_fn()
    all_plans: list[WavePlan] = []
    all_results: list[SpawnResult] = []
    wave = 0
    any_failure = False
    wall_hit = False
    run_started = time.monotonic()
    wall_deadline = (run_started + wall_seconds) if wall_seconds else None

    while True:
        if wall_deadline is not None and time.monotonic() >= wall_deadline:
            wall_hit = True
            if all_plans:
                all_plans[-1].warnings.append(
                    f"wall_timeout reached ({wall_seconds:g}s); stopped new spawns"
                )
            break

        wave += 1
        plan = plan_wave(parent_dir, tasks_dir, repo_root, wave, agent, timeout)
        all_plans.append(plan)

        if plan.cycle is not None:
            return 1, all_plans, all_results

        if not plan.items:
            # No ready work left.
            break

        if not confirm:
            # Dry-run: only first wave plan (caller prints); do not loop.
            break

        # Fail closed on cwd problems before spawning anyone in the wave.
        cwd_errors = [i for i in plan.items if not i.cwd_ok]
        if cwd_errors:
            for item in cwd_errors:
                all_results.append(
                    SpawnResult(
                        dir_name=item.dir_name,
                        ok=False,
                        attempts=0,
                        message=item.cwd_error or "cwd error",
                        exit_code=1,
                    )
                )
            any_failure = True
            break

        workers = (
            max(1, len(plan.items))
            if max_concurrency == 0
            else max(1, min(len(plan.items), max_concurrency))
        )
        queued = max(0, len(plan.items) - workers)
        plan.warnings.append(
            f"concurrency cap={max_concurrency or 'unlimited'} "
            f"workers={workers} queued={queued}"
        )

        pending = list(plan.items)
        inflight: dict = {}
        wave_started = time.monotonic()

        with ThreadPoolExecutor(max_workers=workers) as pool:
            while pending or inflight:
                if wall_deadline is not None and time.monotonic() >= wall_deadline:
                    wall_hit = True
                    # Stop submitting; wait for in-flight to finish.
                    pending.clear()

                while pending and len(inflight) < workers:
                    if wall_deadline is not None and time.monotonic() >= wall_deadline:
                        wall_hit = True
                        pending.clear()
                        break
                    item = pending.pop(0)
                    child_dir = tasks_dir / item.dir_name
                    write_child_status(child_dir, "in_progress")
                    fut = pool.submit(
                        run_spawn_with_retries,
                        item,
                        child_dir,
                        repo_root,
                        spawn,
                        max_retries,
                    )
                    inflight[fut] = item

                if not inflight:
                    break

                done, _ = wait(list(inflight.keys()), return_when=FIRST_COMPLETED)
                for fut in done:
                    item = inflight.pop(fut)
                    child_dir = tasks_dir / item.dir_name
                    try:
                        result = fut.result()
                    except Exception as exc:  # noqa: BLE001 — surface to dispatcher
                        result = SpawnResult(
                            dir_name=item.dir_name,
                            ok=False,
                            attempts=1,
                            message=str(exc),
                            exit_code=1,
                        )
                    all_results.append(result)
                    if result.ok:
                        write_child_status(
                            child_dir, "completed", attempts=result.attempts
                        )
                    else:
                        any_failure = True
                        write_child_status(
                            child_dir,
                            FAILED_STATUS,
                            error=result.message,
                            attempts=result.attempts,
                        )

        elapsed = time.monotonic() - wave_started
        plan.warnings.append(f"wave elapsed={elapsed:.1f}s")

        if any_failure:
            # Do not unlock / advance waves after a failure in this wave.
            break

        if wall_hit:
            plan.warnings.append(
                f"wall_timeout reached ({wall_seconds:g}s); not starting further waves"
            )
            break

        # Next wave: recompute ready after successful completions.
        # Guard against infinite loops if ready set is stuck.
        if wave >= 64:
            all_plans[-1].warnings.append("stopped after 64 waves (safety cap)")
            break

    exit_code = 1 if any_failure or wall_hit else 0
    if confirm and any_failure:
        # Ensure parent is not marked completed.
        parent_json = parent_dir / FILE_TASK_JSON
        pdata = read_json(parent_json) or {}
        if str(pdata.get("status")) in DONE_STATUSES:
            pdata["status"] = "in_progress"
            meta = pdata.get("meta") if isinstance(pdata.get("meta"), dict) else {}
            meta = dict(meta)
            meta["dispatch_blocked_complete"] = True
            pdata["meta"] = meta
            write_json(parent_json, pdata)

    return exit_code, all_plans, all_results


def check_drift_gate(parent_dir: Path, tasks_dir: Path, repo_root: Path) -> str | None:
    """If drift_fail_closed and drift present, return error message."""
    if not get_parallel_drift_fail_closed(repo_root):
        return None
    report = evaluate_drift(parent_dir, tasks_dir)
    if not report.has_drift:
        return None
    fields = ", ".join(f"{i.child}.{i.field}" for i in report.items[:8])
    more = "" if len(report.items) <= 8 else f" (+{len(report.items) - 8} more)"
    return (
        "drift fail-closed: refusing dispatch-ready --yes while markdown "
        f"Dependencies drift from task.json: {fields}{more}. "
        "Fix dual-write or set parallel.drift_fail_closed: false."
    )


def check_scope_gate(
    parent_dir: Path,
    tasks_dir: Path,
    repo_root: Path,
) -> tuple[str | None, list[str]]:
    """Check write_scope conflicts before spawn.

    Returns (error_or_None, warning_lines). When ``scope_fail_closed`` is False,
    conflicts become warnings and error is None.
    """
    from .config import get_parallel_scope_fail_closed
    from .task_scope import check_parent_write_scopes, format_scope_conflicts

    report = check_parent_write_scopes(parent_dir, tasks_dir, repo_root)
    lines = format_scope_conflicts(report)
    warnings = list(report.warnings)
    if not report.conflicts:
        return None, warnings
    if get_parallel_scope_fail_closed(repo_root):
        detail = "; ".join(lines[:4])
        more = "" if len(lines) <= 4 else f" (+{len(lines) - 4} more)"
        return (
            "write_scope fail-closed: refusing dispatch-ready --yes — "
            f"{detail}{more}. Fix scopes/edges or set parallel.scope_fail_closed: false.",
            warnings,
        )
    warnings.extend(f"write_scope warn: {line}" for line in lines)
    return None, warnings


def should_auto_confirm(cli_yes: bool, repo_root: Path) -> bool:
    return bool(cli_yes) or get_parallel_auto_confirm(repo_root)


# Re-export for typing / tests
__all__ = [
    "FAILED_STATUS",
    "SpawnPlanItem",
    "WavePlan",
    "SpawnResult",
    "plan_wave",
    "execute_waves",
    "check_drift_gate",
    "should_auto_confirm",
    "parent_may_complete",
    "parent_needs_integrate",
    "resolve_worker_cwd",
    "resolve_effective_worker",
    "build_worker_context_message",
    "build_spawn_command",
    "select_spawn_fn",
    "mock_spawn",
    "ReadyReport",
]
