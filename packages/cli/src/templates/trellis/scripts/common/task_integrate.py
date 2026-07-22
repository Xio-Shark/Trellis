"""
Phase L4: parent integration gate.

``task.py integrate <parent>`` merges completed children's worktree branches
into the parent base branch, runs project verify, and records
``meta.integrate_ok`` / ``meta.integrate_noop``.

Conflict policy (MergeGate-aligned with xiocode):
  - Never same-cwd multi-writer "force merge"
  - On conflict: abort merge, non-zero exit, optional serial fix-task stub
  - Parent archive stays blocked until integrate succeeds (see
    ``parent_may_complete``)
"""

from __future__ import annotations

import shlex
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .config import get_parallel_verify_command
from .git import run_git
from .io import read_json, write_json
from .paths import FILE_TASK_JSON
from .task_deps import DONE_STATUSES, find_archived_task
from .task_dispatch import parent_may_complete, parent_needs_integrate


@dataclass
class MergeTarget:
    dir_name: str
    branch: str
    worktree_path: str | None = None


@dataclass
class IntegratePlan:
    parent_name: str
    base_branch: str
    needs_integrate: bool
    targets: list[MergeTarget] = field(default_factory=list)
    verify_command: str = ""
    noop_reason: str | None = None
    blocked_reason: str | None = None


@dataclass
class IntegrateResult:
    ok: bool
    noop: bool = False
    conflict: bool = False
    message: str = ""
    merged: list[str] = field(default_factory=list)
    fix_task_dir: str | None = None
    verify_ok: bool | None = None


def _resolve_child_json(tasks_dir: Path, name: str) -> Path | None:
    active = tasks_dir / name / FILE_TASK_JSON
    if active.is_file():
        return active
    archived = find_archived_task(tasks_dir, name)
    if archived is not None:
        cj = archived / FILE_TASK_JSON
        if cj.is_file():
            return cj
    return None


def _git_branch_at(path: Path) -> str | None:
    code, out, _ = run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=path)
    if code != 0:
        return None
    branch = out.strip()
    if not branch or branch == "HEAD":
        return None
    return branch


def collect_merge_targets(
    parent_dir: Path,
    tasks_dir: Path,
    repo_root: Path,
) -> list[MergeTarget]:
    """Collect worktree children that have a mergeable branch."""
    data = read_json(parent_dir / FILE_TASK_JSON) or {}
    children = list(data.get("children") or [])
    targets: list[MergeTarget] = []
    for name in children:
        cj = _resolve_child_json(tasks_dir, name)
        if cj is None:
            continue
        child = read_json(cj) or {}
        if str(child.get("isolation") or "") != "worktree":
            continue
        status = str(child.get("status", ""))
        # Only merge completed (or archived) children.
        if status and status not in DONE_STATUSES and status != "archived":
            # Active incomplete — skip; parent_may_complete will block.
            continue
        branch = str(child.get("branch") or "").strip() or None
        wt_raw = child.get("worktree_path")
        wt: Path | None = None
        if wt_raw and str(wt_raw).strip():
            wt = Path(str(wt_raw).strip()).expanduser()
            if not wt.is_absolute():
                wt = (repo_root / wt).resolve()
            else:
                wt = wt.resolve()
        if not branch and wt is not None and wt.is_dir():
            branch = _git_branch_at(wt)
        if not branch:
            # worktree child without branch — nothing to merge from git
            continue
        # Skip stale/planning branch labels that do not exist in this repo.
        code, _, _ = run_git(["rev-parse", "--verify", f"{branch}^{{commit}}"], cwd=repo_root)
        if code != 0:
            continue
        targets.append(
            MergeTarget(
                dir_name=name,
                branch=branch,
                worktree_path=str(wt) if wt else None,
            )
        )
    return targets


def plan_integrate(
    parent_dir: Path,
    tasks_dir: Path,
    repo_root: Path,
) -> IntegratePlan:
    data = read_json(parent_dir / FILE_TASK_JSON) or {}
    parent_name = parent_dir.name
    base = str(data.get("base_branch") or "main").strip() or "main"
    verify = get_parallel_verify_command(repo_root)

    ok, reason = parent_may_complete(parent_dir, tasks_dir)
    # parent_may_complete may fail solely because integrate has not run yet —
    # peel that off so we can still plan.
    children_ok = True
    blocked: str | None = None
    if not ok and "task.py integrate" not in reason:
        children_ok = False
        blocked = reason

    needs = parent_needs_integrate(parent_dir, tasks_dir)
    targets = collect_merge_targets(parent_dir, tasks_dir, repo_root) if children_ok else []

    if not children_ok:
        return IntegratePlan(
            parent_name=parent_name,
            base_branch=base,
            needs_integrate=needs,
            targets=targets,
            verify_command=verify,
            blocked_reason=blocked,
        )

    if not needs:
        return IntegratePlan(
            parent_name=parent_name,
            base_branch=base,
            needs_integrate=False,
            targets=[],
            verify_command=verify,
            noop_reason="no isolation=worktree children — integrate is a no-op",
        )

    if not targets:
        return IntegratePlan(
            parent_name=parent_name,
            base_branch=base,
            needs_integrate=True,
            targets=[],
            verify_command=verify,
            noop_reason=(
                "worktree children present but none expose branch/worktree "
                "refs to merge — marking integrate noop (docs/shared-only wave)"
            ),
        )

    return IntegratePlan(
        parent_name=parent_name,
        base_branch=base,
        needs_integrate=True,
        targets=targets,
        verify_command=verify,
    )


def _mark_parent_meta(parent_dir: Path, **fields: object) -> None:
    path = parent_dir / FILE_TASK_JSON
    data = read_json(path) or {}
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    meta = dict(meta)
    meta.update(fields)
    data["meta"] = meta
    write_json(path, data)


def _create_fix_task_stub(
    parent_dir: Path,
    tasks_dir: Path,
    conflict_branch: str,
    detail: str,
) -> Path:
    today = datetime.now().strftime("%m-%d")
    slug = f"{today}-integrate-fix-{parent_dir.name}"[:80]
    dest = tasks_dir / slug
    n = 1
    while dest.exists():
        dest = tasks_dir / f"{slug}-{n}"
        n += 1
    dest.mkdir(parents=True, exist_ok=False)
    task = {
        "id": f"integrate-fix-{parent_dir.name}",
        "name": dest.name,
        "title": f"Serial fix: integrate conflict on {parent_dir.name}",
        "description": (
            f"Merge conflict while integrating branch {conflict_branch} "
            f"into parent {parent_dir.name}. Resolve serially; do not "
            "re-enable same-cwd multi-writer parallel."
        ),
        "status": "planning",
        "priority": "P1",
        "parent": parent_dir.name,
        "children": [],
        "depends_on": [],
        "isolation": "worktree",
        "base_branch": (read_json(parent_dir / FILE_TASK_JSON) or {}).get(
            "base_branch", "main"
        ),
        "relatedFiles": [],
        "notes": detail[:2000],
        "meta": {
            "integrate_conflict": True,
            "conflict_branch": conflict_branch,
            "from_parent": parent_dir.name,
        },
    }
    write_json(dest / FILE_TASK_JSON, task)
    (dest / "prd.md").write_text(
        f"""# Serial fix: integrate conflict ({parent_dir.name})

## Goal

Resolve the merge conflict from parallel worktree integration. Do **not**
re-run same-cwd multi-writer parallel; fix serially, then re-run
`task.py integrate {parent_dir.name}`.

## Conflict detail

Branch: `{conflict_branch}`

```
{detail[:4000]}
```

## Acceptance

- [ ] Conflict resolved on base branch
- [ ] `task.py integrate {parent_dir.name}` succeeds
- [ ] Parent may archive
""",
        encoding="utf-8",
    )
    # Link into parent children so it shows up in ready reports.
    pdata = read_json(parent_dir / FILE_TASK_JSON) or {}
    kids = list(pdata.get("children") or [])
    if dest.name not in kids:
        kids.append(dest.name)
        pdata["children"] = kids
        write_json(parent_dir / FILE_TASK_JSON, pdata)
    return dest


def _run_verify(repo_root: Path, command: str) -> tuple[bool, str]:
    if not command.strip():
        return True, "no verify command"
    try:
        proc = subprocess.run(
            command,
            cwd=str(repo_root),
            shell=True,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        return False, str(exc)
    detail = (proc.stderr or proc.stdout or "").strip()
    if len(detail) > 800:
        detail = detail[:800] + "…"
    if proc.returncode == 0:
        return True, detail or "verify ok"
    return False, detail or f"verify exit {proc.returncode}"


def execute_integrate(
    parent_dir: Path,
    tasks_dir: Path,
    repo_root: Path,
    *,
    dry_run: bool = False,
    create_fix_task: bool = True,
    skip_verify: bool = False,
) -> IntegrateResult:
    """Merge child branches + verify. dry_run never mutates git or meta."""
    plan = plan_integrate(parent_dir, tasks_dir, repo_root)
    if plan.blocked_reason:
        return IntegrateResult(ok=False, message=plan.blocked_reason)

    if plan.noop_reason:
        if dry_run:
            return IntegrateResult(
                ok=True,
                noop=True,
                message=f"dry-run noop: {plan.noop_reason}",
            )
        _mark_parent_meta(
            parent_dir,
            integrate_noop=True,
            integrate_ok=True,
            integrated_at=datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            integrate_detail=plan.noop_reason,
        )
        return IntegrateResult(ok=True, noop=True, message=plan.noop_reason)

    if dry_run:
        names = ", ".join(f"{t.dir_name}→{t.branch}" for t in plan.targets)
        return IntegrateResult(
            ok=True,
            message=(
                f"dry-run: would merge [{names}] into {plan.base_branch}, "
                f"then run: {plan.verify_command}"
            ),
        )

    # Fail closed on dirty main tree before merging (ignore .trellis/ orchestration files).
    code, status_out, _ = run_git(["status", "--porcelain"], cwd=repo_root)
    if code != 0:
        return IntegrateResult(ok=False, message="git status failed in repo root")
    dirty_lines = []
    for line in status_out.splitlines():
        path = line[3:].strip() if len(line) > 3 else line.strip()
        # renames: "old -> new"
        if " -> " in path:
            path = path.split(" -> ", 1)[1].strip()
        if path.startswith(".trellis/") or path == ".trellis":
            continue
        if path:
            dirty_lines.append(line)
    if dirty_lines:
        return IntegrateResult(
            ok=False,
            message=(
                "refusing integrate: working tree is dirty — commit/stash "
                "first (MergeGate never merges into a dirty confused tree)"
            ),
        )

    # Ensure we are on base branch (or can check it out).
    cur = _git_branch_at(repo_root)
    if cur != plan.base_branch:
        code, _, err = run_git(["checkout", plan.base_branch], cwd=repo_root)
        if code != 0:
            return IntegrateResult(
                ok=False,
                message=f"cannot checkout base branch {plan.base_branch}: {err.strip()}",
            )

    merged: list[str] = []
    for target in plan.targets:
        # Fetch local branch tip — branches live in this repo / worktree.
        code, _, err = run_git(
            ["merge", "--no-ff", "-m", f"integrate: {target.dir_name} ({target.branch})", target.branch],
            cwd=repo_root,
        )
        if code != 0:
            run_git(["merge", "--abort"], cwd=repo_root)
            detail = (err or "").strip() or f"merge failed for {target.branch}"
            fix_dir: Path | None = None
            if create_fix_task:
                fix_dir = _create_fix_task_stub(
                    parent_dir, tasks_dir, target.branch, detail
                )
            _mark_parent_meta(
                parent_dir,
                integrate_ok=False,
                integrate_noop=False,
                integrate_conflict=True,
                integrate_conflict_branch=target.branch,
                integrate_detail=detail[:2000],
            )
            msg = (
                f"merge conflict on {target.branch} (from {target.dir_name}). "
                "Degraded to serial fix — do not re-enable same-cwd multi-writer. "
                f"Detail: {detail}"
            )
            if fix_dir is not None:
                msg += f" Created fix task: {fix_dir.name}"
            return IntegrateResult(
                ok=False,
                conflict=True,
                message=msg,
                merged=merged,
                fix_task_dir=fix_dir.name if fix_dir else None,
            )
        merged.append(target.branch)

    verify_ok: bool | None = None
    if not skip_verify:
        verify_ok, verify_msg = _run_verify(repo_root, plan.verify_command)
        if not verify_ok:
            _mark_parent_meta(
                parent_dir,
                integrate_ok=False,
                integrate_noop=False,
                integrate_verify_failed=True,
                integrate_detail=verify_msg[:2000],
            )
            return IntegrateResult(
                ok=False,
                message=f"merge ok but verify failed: {verify_msg}",
                merged=merged,
                verify_ok=False,
            )

    _mark_parent_meta(
        parent_dir,
        integrate_ok=True,
        integrate_noop=False,
        integrate_conflict=False,
        integrated_at=datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        integrate_merged=merged,
        integrate_detail=f"merged {len(merged)} branch(es) into {plan.base_branch}",
    )
    return IntegrateResult(
        ok=True,
        message=f"integrated {len(merged)} branch(es) into {plan.base_branch}",
        merged=merged,
        verify_ok=verify_ok if not skip_verify else None,
    )


__all__ = [
    "MergeTarget",
    "IntegratePlan",
    "IntegrateResult",
    "plan_integrate",
    "execute_integrate",
    "collect_merge_targets",
]
