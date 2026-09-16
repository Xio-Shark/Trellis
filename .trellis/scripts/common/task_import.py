"""
parallel-plan.v1 import: validate + batch materialize children under a parent.

``task.py plan-import <parent> <plan.json>`` defaults to dry-run; ``--yes`` writes.
validate-all-then-write: schema / slug collision / missing deps / cycles fail closed
with zero materialization. isolation=worktree children get a pre-created git worktree.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .git import run_git
from .io import read_json, write_json
from .log import Colors, colored
from .paths import (
    DIR_WORKFLOW,
    FILE_TASK_JSON,
    generate_task_date_prefix,
    get_developer,
    get_repo_root,
    get_tasks_dir,
)
from .task_deps import detect_cycle
from .task_scope import (
    check_plan_write_scopes,
    format_scope_conflicts,
    normalize_write_scope,
)
from .task_store import (
    _find_archived_task_by_dir_name,
    _has_subagent_platform,
    ensure_tasks_dir,
)
from .task_utils import resolve_task_dir, run_task_hooks

PARALLEL_PLAN_VERSION = "parallel-plan.v1"
VALID_ISOLATIONS = frozenset({"worktree", "shared"})
_SLUG_RE = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")


@dataclass
class PlanChild:
    slug: str
    title: str
    description: str = ""
    depends_on: list[str] = field(default_factory=list)
    isolation: str | None = None
    write_scope: list[str] = field(default_factory=list)
    verify: str | None = None


@dataclass
class MaterializeChild:
    slug: str
    dir_name: str
    title: str
    description: str
    depends_on_slugs: list[str]
    depends_on_dirs: list[str]
    isolation: str | None
    write_scope: list[str]
    verify: str | None
    wave: int
    branch: str | None = None
    worktree_rel: str | None = None


@dataclass
class ImportPlan:
    parent_dir_name: str
    children: list[MaterializeChild]
    errors: list[str] = field(default_factory=list)


def _err(msg: str) -> None:
    print(colored(f"Error: {msg}", Colors.RED), file=sys.stderr)


def _ok(msg: str) -> None:
    print(colored(msg, Colors.GREEN), file=sys.stderr)


def _info(msg: str) -> None:
    print(msg, file=sys.stderr)


def _validate_slug(slug: str) -> str | None:
    if not slug or not isinstance(slug, str):
        return "slug is required"
    s = slug.strip()
    if not _SLUG_RE.match(s):
        return (
            f"invalid slug {slug!r}: use lowercase letters, digits, hyphens "
            "(no leading/trailing hyphen)"
        )
    if re.match(r"^\d{2}-\d{2}-", s):
        return (
            f"slug {slug!r} must not include MM-DD date prefix "
            "(plan-import adds today's prefix)"
        )
    return None


def _parse_child(raw: object, index: int) -> tuple[PlanChild | None, list[str]]:
    errors: list[str] = []
    if not isinstance(raw, dict):
        return None, [f"children[{index}]: must be an object"]
    slug = str(raw.get("slug") or "").strip()
    err = _validate_slug(slug)
    if err:
        errors.append(f"children[{index}]: {err}")
    title = str(raw.get("title") or "").strip()
    if not title:
        errors.append(f"children[{index}] ({slug or '?'}): title is required")
    isolation_raw = raw.get("isolation")
    isolation: str | None = None
    if isolation_raw is not None and isolation_raw != "":
        if not isinstance(isolation_raw, str) or isolation_raw.strip() not in VALID_ISOLATIONS:
            errors.append(
                f"children[{index}] ({slug}): isolation must be "
                f"'worktree' | 'shared' (got {isolation_raw!r})"
            )
        else:
            isolation = isolation_raw.strip()
    deps_raw = raw.get("depends_on") or []
    if not isinstance(deps_raw, list):
        errors.append(f"children[{index}] ({slug}): depends_on must be a list")
        deps: list[str] = []
    else:
        deps = []
        for d in deps_raw:
            if not isinstance(d, str) or not d.strip():
                errors.append(
                    f"children[{index}] ({slug}): depends_on entries must be non-empty strings"
                )
            else:
                deps.append(d.strip())
    write_scope = normalize_write_scope(raw.get("write_scope"))
    verify = raw.get("verify")
    verify_s = str(verify).strip() if isinstance(verify, str) and verify.strip() else None
    description = str(raw.get("description") or "").strip()
    if errors:
        return None, errors
    return (
        PlanChild(
            slug=slug,
            title=title,
            description=description,
            depends_on=deps,
            isolation=isolation,
            write_scope=write_scope,
            verify=verify_s,
        ),
        [],
    )


def load_parallel_plan(path: Path) -> tuple[dict[str, Any] | None, list[PlanChild], list[str]]:
    """Load and schema-validate a parallel-plan.v1 JSON file."""
    errors: list[str] = []
    try:
        text = path.read_text(encoding="utf-8")
        data = json.loads(text)
    except FileNotFoundError:
        return None, [], [f"plan file not found: {path}"]
    except json.JSONDecodeError as exc:
        return None, [], [f"plan JSON invalid: {exc}"]

    if not isinstance(data, dict):
        return None, [], ["plan root must be an object"]

    version = data.get("version")
    if version != PARALLEL_PLAN_VERSION:
        errors.append(
            f"version must be {PARALLEL_PLAN_VERSION!r} (got {version!r})"
        )

    children_raw = data.get("children")
    if not isinstance(children_raw, list) or not children_raw:
        errors.append("children must be a non-empty array")
        return data, [], errors

    children: list[PlanChild] = []
    seen: set[str] = set()
    for i, item in enumerate(children_raw):
        child, child_errs = _parse_child(item, i)
        errors.extend(child_errs)
        if child is None:
            continue
        if child.slug in seen:
            errors.append(f"duplicate child slug: {child.slug}")
        seen.add(child.slug)
        children.append(child)

    slug_set = {c.slug for c in children}
    for child in children:
        for dep in child.depends_on:
            if dep not in slug_set:
                errors.append(
                    f"{child.slug}: depends_on references unknown sibling slug {dep!r}"
                )

    return data, children, errors


def assign_waves(children: list[PlanChild]) -> dict[str, int]:
    """Assign 1-based wave numbers from depends_on (longest path from roots)."""
    by_slug = {c.slug: c for c in children}
    waves: dict[str, int] = {}

    def wave_of(slug: str, stack: set[str]) -> int:
        if slug in waves:
            return waves[slug]
        if slug in stack:
            return 1  # cycle handled separately
        stack.add(slug)
        child = by_slug[slug]
        if not child.depends_on:
            w = 1
        else:
            w = 1 + max(wave_of(d, stack) for d in child.depends_on)
        stack.remove(slug)
        waves[slug] = w
        return w

    for c in children:
        wave_of(c.slug, set())
    return waves


def build_import_plan(
    parent_dir: Path,
    children: list[PlanChild],
    repo_root: Path,
    *,
    date_prefix: str | None = None,
) -> ImportPlan:
    """Validate collisions / cycles and build the materialization plan."""
    tasks_dir = get_tasks_dir(repo_root)
    prefix = date_prefix or generate_task_date_prefix()
    plan = ImportPlan(parent_dir_name=parent_dir.name, children=[])
    slug_to_dir = {c.slug: f"{prefix}-{c.slug}" for c in children}

    for child in children:
        dir_name = slug_to_dir[child.slug]
        if (tasks_dir / dir_name).exists():
            plan.errors.append(f"task directory already exists: {dir_name}")
        archived = _find_archived_task_by_dir_name(tasks_dir, dir_name)
        if archived is not None:
            plan.errors.append(f"task already archived: {dir_name}")

    graph = {
        slug_to_dir[c.slug]: [slug_to_dir[d] for d in c.depends_on]
        for c in children
    }
    cycle = detect_cycle(graph)
    if cycle is not None:
        plan.errors.append(f"dependency cycle: {' → '.join(cycle)}")

    need_worktree = any(c.isolation == "worktree" for c in children)
    if need_worktree:
        code, _, err = run_git(["rev-parse", "--is-inside-work-tree"], cwd=repo_root)
        if code != 0:
            plan.errors.append(
                f"isolation=worktree requires a git repository "
                f"(git rev-parse failed: {err.strip() or 'not a git repo'})"
            )

    if plan.errors:
        return plan

    # write_scope guard (B): require scopes for worktree + fail on edge-free overlap.
    scope_children = [
        {
            "slug": c.slug,
            "depends_on": list(c.depends_on),
            "isolation": c.isolation,
            "write_scope": list(c.write_scope),
        }
        for c in children
    ]
    scope_report = check_plan_write_scopes(scope_children, repo_root=repo_root)
    for line in format_scope_conflicts(scope_report):
        plan.errors.append(line)
    if plan.errors:
        return plan

    waves = assign_waves(children)
    for child in children:
        dir_name = slug_to_dir[child.slug]
        branch: str | None = None
        worktree_rel: str | None = None
        if child.isolation == "worktree":
            branch = f"trellis/{dir_name}"
            worktree_rel = f"{DIR_WORKFLOW}/worktrees/{dir_name}"
            wt_abs = repo_root / worktree_rel
            if wt_abs.exists():
                plan.errors.append(f"worktree path already exists: {worktree_rel}")
            # Branch existence checked at materialize time (may be stale dry-run).
        plan.children.append(
            MaterializeChild(
                slug=child.slug,
                dir_name=dir_name,
                title=child.title,
                description=child.description,
                depends_on_slugs=list(child.depends_on),
                depends_on_dirs=[slug_to_dir[d] for d in child.depends_on],
                isolation=child.isolation,
                write_scope=list(child.write_scope),
                verify=child.verify,
                wave=waves[child.slug],
                branch=branch,
                worktree_rel=worktree_rel,
            )
        )

    return plan


def format_dependencies_section(child: MaterializeChild) -> str:
    deps = ", ".join(f"`{d}`" for d in child.depends_on_dirs) if child.depends_on_dirs else "(none)"
    iso = child.isolation or "(unset)"
    lines = [
        "## Dependencies",
        f"- depends_on: {deps}",
        f"- isolation: {iso}",
        f"- parallel_group: wave-{child.wave}",
    ]
    if child.write_scope:
        scope = ", ".join(f"`{g}`" for g in child.write_scope)
        lines.append(f"- write_scope: {scope}")
    if child.verify:
        lines.append(f"- verify: `{child.verify}`")
    return "\n".join(lines) + "\n"


def _prd_content(child: MaterializeChild) -> str:
    goal = child.description.strip() or "TBD."
    return (
        f"# {child.title}\n\n"
        f"## Goal\n\n{goal}\n\n"
        f"## Requirements\n\n- TBD\n\n"
        f"## Acceptance Criteria\n\n- [ ] TBD\n\n"
        f"{format_dependencies_section(child)}\n"
        f"## Notes\n\n"
        f"- Materialized by `task.py plan-import` from parallel-plan.v1.\n"
    )


def print_import_plan(plan: ImportPlan, *, dry_run: bool) -> None:
    mode = "DRY-RUN" if dry_run else "EXECUTE"
    _info(f"plan-import [{mode}] parent={plan.parent_dir_name}")
    _info(f"  children: {len(plan.children)}")
    for child in plan.children:
        deps = ",".join(child.depends_on_dirs) if child.depends_on_dirs else "(none)"
        iso = child.isolation or "(unset)"
        _info(
            f"  - {child.dir_name}  slug={child.slug}  "
            f"wave-{child.wave}  isolation={iso}  depends_on=[{deps}]"
        )
        if child.write_scope:
            _info(f"      write_scope={child.write_scope}")
        if child.worktree_rel:
            _info(f"      worktree={child.worktree_rel}  branch={child.branch}")


def _rollback_created(
    repo_root: Path,
    created_dirs: list[Path],
    created_worktrees: list[Path],
    created_branches: list[str],
) -> None:
    for wt in reversed(created_worktrees):
        run_git(["worktree", "remove", "--force", str(wt)], cwd=repo_root)
        if wt.exists():
            shutil.rmtree(wt, ignore_errors=True)
    for branch in reversed(created_branches):
        run_git(["branch", "-D", branch], cwd=repo_root)
    for d in reversed(created_dirs):
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)


def _create_worktree(
    repo_root: Path,
    child: MaterializeChild,
) -> tuple[Path | None, str | None]:
    assert child.worktree_rel and child.branch
    wt_abs = (repo_root / child.worktree_rel).resolve()
    wt_abs.parent.mkdir(parents=True, exist_ok=True)

    code, out, err = run_git(["show-ref", "--verify", f"refs/heads/{child.branch}"], cwd=repo_root)
    if code == 0:
        return None, f"branch already exists: {child.branch}"

    code, out, err = run_git(
        ["worktree", "add", "-b", child.branch, str(wt_abs)],
        cwd=repo_root,
    )
    if code != 0:
        return None, f"git worktree add failed for {child.dir_name}: {(err or out).strip()}"
    if not wt_abs.is_dir():
        return None, f"worktree path missing after add: {wt_abs}"
    return wt_abs, None


def materialize_import_plan(
    parent_dir: Path,
    plan: ImportPlan,
    repo_root: Path,
) -> int:
    """Write children + link parent + pre-create worktrees. Roll back on failure."""
    tasks_dir = ensure_tasks_dir(repo_root)
    assignee = get_developer(repo_root) or "unknown"
    today = datetime.now().strftime("%Y-%m-%d")
    _, branch_out, _ = run_git(["branch", "--show-current"], cwd=repo_root)
    base_branch = branch_out.strip() or "main"

    parent_json_path = parent_dir / FILE_TASK_JSON
    parent_data = read_json(parent_json_path) or {}
    parent_children = list(parent_data.get("children") or [])

    created_dirs: list[Path] = []
    created_worktrees: list[Path] = []
    created_branches: list[str] = []
    seed_jsonl = _has_subagent_platform(repo_root)

    try:
        for child in plan.children:
            task_dir = tasks_dir / child.dir_name
            task_dir.mkdir(parents=True, exist_ok=False)
            created_dirs.append(task_dir)

            worktree_path: str | None = None
            if child.isolation == "worktree":
                wt_abs, wt_err = _create_worktree(repo_root, child)
                if wt_err or wt_abs is None:
                    raise RuntimeError(wt_err or "worktree create failed")
                created_worktrees.append(wt_abs)
                if child.branch:
                    created_branches.append(child.branch)
                try:
                    worktree_path = str(wt_abs.relative_to(repo_root))
                except ValueError:
                    worktree_path = str(wt_abs)

            meta: dict[str, Any] = {}
            if child.verify:
                meta["verify"] = child.verify

            task_data: dict[str, Any] = {
                "id": child.slug,
                "name": child.slug,
                "title": child.title,
                "description": child.description,
                "status": "planning",
                "dev_type": None,
                "scope": None,
                "package": None,
                "priority": parent_data.get("priority") or "P2",
                "creator": assignee,
                "assignee": assignee,
                "createdAt": today,
                "completedAt": None,
                "branch": child.branch,
                "base_branch": base_branch,
                "worktree_path": worktree_path,
                "commit": None,
                "pr_url": None,
                "subtasks": [],
                "children": [],
                "parent": parent_dir.name,
                "depends_on": list(child.depends_on_dirs),
                "isolation": child.isolation,
                "write_scope": list(child.write_scope),
                "relatedFiles": [],
                "notes": "",
                "meta": meta,
            }
            write_json(task_dir / FILE_TASK_JSON, task_data)
            (task_dir / "prd.md").write_text(_prd_content(child), encoding="utf-8")
            if seed_jsonl:
                for jsonl_name in ("implement.jsonl", "check.jsonl"):
                    (task_dir / jsonl_name).write_text("", encoding="utf-8")

            if child.dir_name not in parent_children:
                parent_children.append(child.dir_name)
            run_task_hooks("after_create", task_dir / FILE_TASK_JSON, repo_root)

        parent_data["children"] = parent_children
        write_json(parent_json_path, parent_data)
    except Exception as exc:
        _err(f"materialize failed: {exc}")
        _info("Rolling back created children / worktrees…")
        _rollback_created(repo_root, created_dirs, created_worktrees, created_branches)
        # Restore parent children list if we mutated in memory only — file may
        # already be written; re-read and strip dirs we created.
        parent_data = read_json(parent_json_path) or {}
        kids = [c for c in (parent_data.get("children") or []) if c not in {d.name for d in created_dirs}]
        parent_data["children"] = kids
        write_json(parent_json_path, parent_data)
        return 1

    _ok(f"Materialized {len(plan.children)} children under {parent_dir.name}")
    for child in plan.children:
        extra = ""
        if child.worktree_rel:
            extra = f"  worktree={child.worktree_rel}"
        _info(f"  ✓ {child.dir_name}{extra}")
    _info("")
    _info("Next:")
    _info(f"  python3 ./.trellis/scripts/task.py ready {parent_dir.name}")
    _info(f"  python3 ./.trellis/scripts/task.py drift {parent_dir.name}")
    _info(f"  python3 ./.trellis/scripts/task.py dispatch-ready {parent_dir.name}")
    return 0


def cmd_plan_import(args: argparse.Namespace) -> int:
    """CLI: plan-import <parent_dir> <plan.json> [--yes]."""
    repo_root = get_repo_root()
    parent_dir = resolve_task_dir(args.parent_dir, repo_root)
    if not (parent_dir / FILE_TASK_JSON).is_file():
        _err(f"parent task.json not found: {args.parent_dir}")
        return 1

    plan_path = Path(args.plan_json)
    if not plan_path.is_absolute():
        plan_path = (Path.cwd() / plan_path).resolve()

    _, children, errors = load_parallel_plan(plan_path)
    if errors:
        for e in errors:
            _err(e)
        return 1

    plan = build_import_plan(parent_dir, children, repo_root)
    if plan.errors:
        for e in plan.errors:
            _err(e)
        return 1

    dry_run = not bool(getattr(args, "yes", False))
    print_import_plan(plan, dry_run=dry_run)

    if dry_run:
        _info("")
        _info("Dry-run only. Re-run with --yes to materialize.")
        return 0

    return materialize_import_plan(parent_dir, plan, repo_root)
