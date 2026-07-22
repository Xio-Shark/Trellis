"""
Parallel task dependency helpers (MVP A).

Authoritative fields live on task.json:
  depends_on: list[str]   — sibling task directory names
  isolation: "worktree" | "shared" | unset

Ready / blocked / cycle / drift are computed here; CLI commands in task.py
are thin wrappers. Phase B spawn orchestration lives in task_dispatch.py.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from .io import read_json
from .paths import DIR_ARCHIVE, FILE_TASK_JSON

IsolationValue = Literal["worktree", "shared"]

DONE_STATUSES = frozenset({"completed", "done"})
# Statuses that may still be dispatched / worked on.
ACTIONABLE_STATUSES = frozenset({"planning", "pending", "in_progress"})
# Terminal failure from dispatch-ready — does not unlock dependents.
FAILED_STATUSES = frozenset({"failed"})
VALID_ISOLATIONS = frozenset({"worktree", "shared"})

_DEPENDENCIES_HEADING = re.compile(r"^##\s+Dependencies\s*$", re.IGNORECASE | re.MULTILINE)
_DEPENDS_ON_LINE = re.compile(
    r"depends_on\s*:\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)
_ISOLATION_LINE = re.compile(
    r"isolation\s*:\s*`?([A-Za-z0-9_-]+)`?",
    re.IGNORECASE | re.MULTILINE,
)
_BACKTICK_NAME = re.compile(r"`([^`]+)`")
_NONE_TOKENS = frozenset({"", "(none)", "none", "_none_", "—", "-", "n/a", "na"})


@dataclass(frozen=True)
class DepStatus:
    """Resolved status for one depends_on entry."""

    name: str
    status: str | None  # None → missing / unresolved
    location: str  # "active" | "archive" | "missing"


@dataclass
class ChildReadyInfo:
    """Ready/blocked evaluation for one child under a parent."""

    dir_name: str
    status: str
    isolation: str | None
    depends_on: tuple[str, ...]
    ready: bool
    blocked_by: list[DepStatus] = field(default_factory=list)
    skip_reason: str | None = None  # e.g. already completed


@dataclass
class ReadyReport:
    parent: str
    ready: list[ChildReadyInfo] = field(default_factory=list)
    blocked: list[ChildReadyInfo] = field(default_factory=list)
    skipped: list[ChildReadyInfo] = field(default_factory=list)
    cycle: list[str] | None = None  # non-None → fail closed
    warnings: list[str] = field(default_factory=list)


@dataclass
class DriftItem:
    child: str
    field: str
    json_value: str
    md_value: str
    source_file: str | None


@dataclass
class DriftReport:
    parent: str
    items: list[DriftItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def has_drift(self) -> bool:
        return bool(self.items)


def normalize_depends_on(raw: object) -> list[str]:
    """Coerce task.json depends_on to a clean list of directory names."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, str):
            name = item.strip()
            if name:
                out.append(name)
    return out


def normalize_isolation(raw: object) -> str | None:
    """Return isolation if valid, else None (unset / legacy)."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        return None
    value = raw.strip().lower()
    if value in VALID_ISOLATIONS:
        return value
    return None


def get_depends_on(data: dict) -> list[str]:
    return normalize_depends_on(data.get("depends_on"))


def get_isolation(data: dict) -> str | None:
    return normalize_isolation(data.get("isolation"))


def find_archived_task(tasks_dir: Path, dir_name: str) -> Path | None:
    """Locate an archived task dir by active-task directory name."""
    archive_dir = tasks_dir / DIR_ARCHIVE
    if not archive_dir.is_dir():
        return None
    for month_dir in sorted(archive_dir.iterdir()):
        if not month_dir.is_dir():
            continue
        candidate = month_dir / dir_name
        if candidate.is_dir() and (candidate / FILE_TASK_JSON).is_file():
            return candidate
    return None


def resolve_task_status(tasks_dir: Path, dir_name: str) -> DepStatus:
    """Resolve a dependency name to active/archive/missing status."""
    active = tasks_dir / dir_name
    active_json = active / FILE_TASK_JSON
    if active.is_dir() and active_json.is_file():
        data = read_json(active_json) or {}
        return DepStatus(
            name=dir_name,
            status=str(data.get("status", "unknown")),
            location="active",
        )

    archived = find_archived_task(tasks_dir, dir_name)
    if archived is not None:
        data = read_json(archived / FILE_TASK_JSON) or {}
        status = str(data.get("status", "completed"))
        # Archive implies done even if status field is odd.
        if status not in DONE_STATUSES:
            status = "completed"
        return DepStatus(name=dir_name, status=status, location="archive")

    return DepStatus(name=dir_name, status=None, location="missing")


def is_dep_satisfied(dep: DepStatus) -> bool:
    if dep.location == "missing" or dep.status is None:
        return False
    return dep.status in DONE_STATUSES


def detect_cycle(graph: dict[str, list[str]]) -> list[str] | None:
    """Return one cycle path (node list ending at repeat) or None.

    Fail-closed helper for the parent subgraph. Only edges among `graph`
    keys are considered; external depends_on names are ignored for cycles.
    """
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {n: WHITE for n in graph}
    parent: dict[str, str | None] = {n: None for n in graph}

    def dfs(u: str) -> list[str] | None:
        color[u] = GRAY
        for v in graph.get(u, []):
            if v not in color:
                continue
            if color[v] == GRAY:
                # Reconstruct cycle u → … → v → u
                cycle = [v]
                cur: str | None = u
                while cur is not None and cur != v:
                    cycle.append(cur)
                    cur = parent.get(cur)
                cycle.append(v)
                cycle.reverse()
                return cycle
            if color[v] == WHITE:
                parent[v] = u
                found = dfs(v)
                if found is not None:
                    return found
        color[u] = BLACK
        return None

    for node in graph:
        if color[node] == WHITE:
            found = dfs(node)
            if found is not None:
                return found
    return None


def build_parent_dep_graph(
    children: list[str],
    child_data: dict[str, dict],
) -> dict[str, list[str]]:
    """Build depends_on adjacency among parent's children only."""
    child_set = set(children)
    graph: dict[str, list[str]] = {}
    for name in children:
        deps = get_depends_on(child_data.get(name, {}))
        graph[name] = [d for d in deps if d in child_set]
    return graph


def evaluate_ready(parent_dir: Path, tasks_dir: Path) -> ReadyReport:
    """Evaluate ready/blocked children for a parent task directory."""
    parent_json = parent_dir / FILE_TASK_JSON
    parent_data = read_json(parent_json) or {}
    children = list(parent_data.get("children") or [])
    report = ReadyReport(parent=parent_dir.name)

    if not children:
        report.warnings.append("Parent has no children; nothing to evaluate.")
        return report

    child_data: dict[str, dict] = {}
    for child_name in children:
        child_path = tasks_dir / child_name
        cj = child_path / FILE_TASK_JSON
        if not cj.is_file():
            archived = find_archived_task(tasks_dir, child_name)
            if archived is not None:
                child_data[child_name] = read_json(archived / FILE_TASK_JSON) or {
                    "status": "completed",
                }
            else:
                report.warnings.append(f"Child task.json missing: {child_name}")
                child_data[child_name] = {"status": "missing", "depends_on": []}
        else:
            child_data[child_name] = read_json(cj) or {}

    graph = build_parent_dep_graph(children, child_data)
    cycle = detect_cycle(graph)
    if cycle is not None:
        report.cycle = cycle
        return report

    for child_name in children:
        data = child_data[child_name]
        status = str(data.get("status", "unknown"))
        isolation = get_isolation(data)
        deps = tuple(get_depends_on(data))
        is_archived = (
            not (tasks_dir / child_name).is_dir()
            and find_archived_task(tasks_dir, child_name) is not None
        )

        # Warn on unknown depends_on names (still evaluate).
        for dep_name in deps:
            resolved = resolve_task_status(tasks_dir, dep_name)
            if resolved.location == "missing":
                report.warnings.append(
                    f"{child_name}: depends_on entry not found: {dep_name}"
                )

        info = ChildReadyInfo(
            dir_name=child_name,
            status=status,
            isolation=isolation,
            depends_on=deps,
            ready=False,
        )

        if status in DONE_STATUSES or is_archived:
            if status not in DONE_STATUSES:
                info.status = "completed"
            info.skip_reason = "already completed"
            report.skipped.append(info)
            continue

        if status in FAILED_STATUSES:
            info.skip_reason = "failed (does not unlock dependents)"
            report.skipped.append(info)
            continue

        if status not in ACTIONABLE_STATUSES:
            # e.g. review — not ready for parallel dispatch in MVP.
            info.skip_reason = f"status={status} not actionable"
            report.skipped.append(info)
            continue

        blocked: list[DepStatus] = []
        for dep_name in deps:
            dep = resolve_task_status(tasks_dir, dep_name)
            if not is_dep_satisfied(dep):
                blocked.append(dep)

        if blocked:
            info.blocked_by = blocked
            report.blocked.append(info)
        else:
            info.ready = True
            report.ready.append(info)

    return report


def _parse_depends_on_text(text: str) -> list[str] | None:
    """Parse depends_on list from a Dependencies section body.

    Returns None if the field is absent (cannot compare).
    """
    m = _DEPENDS_ON_LINE.search(text)
    if not m:
        return None
    raw = m.group(1).strip()
    # Prefer backtick-quoted names.
    names = [n.strip() for n in _BACKTICK_NAME.findall(raw) if n.strip()]
    if names:
        return names
    # Fallback: split on commas / whitespace.
    cleaned = raw.strip().rstrip(".")
    lower = cleaned.lower().strip("`").strip("_").strip()
    if lower in _NONE_TOKENS or "none" == lower or lower in {"(none)", "none"}:
        return []
    # Patterns like _(none)_ or _(none)
    if "none" in lower and not _BACKTICK_NAME.search(raw) and "," not in raw:
        if re.fullmatch(r"[\W_]*none[\W_]*", lower):
            return []
    parts = re.split(r"[,，]\s*|\s{2,}", cleaned)
    out = []
    for p in parts:
        p = p.strip().strip("`").strip()
        if p.lower() in _NONE_TOKENS:
            continue
        if p:
            out.append(p)
    return out


def _parse_isolation_text(text: str) -> str | None | object:
    """Parse isolation from Dependencies section.

    Returns:
      str value, None if explicitly absent-as-unset after parse miss,
      or a sentinel None when field missing — use `_MISSING` .
    """
    m = _ISOLATION_LINE.search(text)
    if not m:
        return _MISSING
    value = m.group(1).strip().lower()
    if value in VALID_ISOLATIONS:
        return value
    return value  # preserve unknown for drift comparison


_MISSING = object()


def extract_dependencies_section(md_text: str) -> str | None:
    """Return the body under ## Dependencies until the next ## heading."""
    m = _DEPENDENCIES_HEADING.search(md_text)
    if not m:
        return None
    start = m.end()
    rest = md_text[start:]
    next_h = re.search(r"^##\s+\S", rest, re.MULTILINE)
    if next_h:
        return rest[: next_h.start()]
    return rest


def parse_markdown_dependencies(task_dir: Path) -> tuple[list[str] | None, object, str | None]:
    """Read depends_on / isolation projection from prd.md or implement.md.

    Returns (depends_on_or_None, isolation_or_MISSING, source_file).
    Prefers prd.md, then implement.md. If ## Dependencies is missing in both,
    returns (None, _MISSING, None).
    """
    for name in ("prd.md", "implement.md"):
        path = task_dir / name
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        section = extract_dependencies_section(text)
        if section is None:
            continue
        deps = _parse_depends_on_text(section)
        isolation = _parse_isolation_text(section)
        return deps, isolation, name
    return None, _MISSING, None


def evaluate_drift(parent_dir: Path, tasks_dir: Path) -> DriftReport:
    """Compare task.json depends_on/isolation vs markdown ## Dependencies."""
    parent_data = read_json(parent_dir / FILE_TASK_JSON) or {}
    children = list(parent_data.get("children") or [])
    report = DriftReport(parent=parent_dir.name)

    if not children:
        report.warnings.append("Parent has no children; nothing to check.")
        return report

    for child_name in children:
        child_path = tasks_dir / child_name
        if not child_path.is_dir():
            # Archived or missing — skip drift (no live markdown to compare).
            continue
        cj = child_path / FILE_TASK_JSON
        if not cj.is_file():
            report.warnings.append(f"Child task.json missing: {child_name}")
            continue
        data = read_json(cj) or {}
        json_deps = get_depends_on(data)
        json_iso = get_isolation(data)

        md_deps, md_iso, source = parse_markdown_dependencies(child_path)
        if source is None:
            report.warnings.append(
                f"{child_name}: no ## Dependencies section in prd.md/implement.md"
            )
            # Treat missing section as drift if json has non-default values.
            if json_deps or json_iso:
                report.items.append(
                    DriftItem(
                        child=child_name,
                        field="Dependencies section",
                        json_value=(
                            f"depends_on={json_deps!r}, isolation={json_iso!r}"
                        ),
                        md_value="(missing section)",
                        source_file=None,
                    )
                )
            continue

        if md_deps is not None and list(md_deps) != list(json_deps):
            report.items.append(
                DriftItem(
                    child=child_name,
                    field="depends_on",
                    json_value=repr(json_deps),
                    md_value=repr(md_deps),
                    source_file=source,
                )
            )

        if md_iso is not _MISSING:
            md_iso_norm = normalize_isolation(md_iso) if isinstance(md_iso, str) else None
            # Compare normalized; if md has invalid value, still report mismatch.
            json_cmp = json_iso
            md_cmp: str | None
            if isinstance(md_iso, str) and md_iso_norm is None and md_iso:
                md_cmp = md_iso
            else:
                md_cmp = md_iso_norm
            if json_cmp != md_cmp:
                report.items.append(
                    DriftItem(
                        child=child_name,
                        field="isolation",
                        json_value=repr(json_cmp),
                        md_value=repr(md_iso if isinstance(md_iso, str) else md_cmp),
                        source_file=source,
                    )
                )
        elif json_iso is not None:
            report.items.append(
                DriftItem(
                    child=child_name,
                    field="isolation",
                    json_value=repr(json_iso),
                    md_value="(missing in markdown)",
                    source_file=source,
                )
            )

    return report


def reverse_dependents(
    tasks_dir: Path,
    target_dir_name: str,
) -> list[str]:
    """List active tasks that list target in depends_on."""
    result: list[str] = []
    if not tasks_dir.is_dir():
        return result
    for d in sorted(tasks_dir.iterdir()):
        if not d.is_dir() or d.name == DIR_ARCHIVE:
            continue
        data = read_json(d / FILE_TASK_JSON)
        if not data:
            continue
        if target_dir_name in get_depends_on(data):
            result.append(d.name)
    return result
