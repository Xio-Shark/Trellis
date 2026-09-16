"""
write_scope conflict guard — planning-time proof that edge-free siblings
do not claim overlapping write domains.

Approximation (conservative):
  1. Expand globs against the current repo file list (fnmatch).
  2. Prefix heuristic: strip trailing wildcards; if one prefix is a prefix of
     the other, treat as overlap even when the tree has no matching files yet.

May miss future files not yet on disk; false positives are fixed by narrowing
globs or adding a depends_on edge / merging tasks.
"""

from __future__ import annotations

import fnmatch
import os
from dataclasses import dataclass, field
from pathlib import Path

from .io import read_json
from .paths import FILE_TASK_JSON
from .task_deps import get_depends_on, get_isolation


def normalize_write_scope(raw: object) -> list[str]:
    """Coerce write_scope to a clean list of repo-relative glob strings."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
    return out


def get_write_scope(data: dict) -> list[str]:
    return normalize_write_scope(data.get("write_scope"))


# Directories skipped when walking the repo for expansion.
_SKIP_DIR_NAMES = frozenset({
    ".git",
    "node_modules",
    ".trellis",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".tox",
    "coverage",
    ".next",
    "target",
})


@dataclass
class ScopeConflict:
    left: str
    right: str
    samples: list[str] = field(default_factory=list)
    reason: str = ""


@dataclass
class ScopeCheckReport:
    conflicts: list[ScopeConflict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.conflicts


def glob_prefix(pattern: str) -> str:
    """Strip trailing wildcards to a path-like prefix for heuristic overlap."""
    p = pattern.strip().replace("\\", "/").lstrip("./")
    # Cut at first wildcard segment.
    parts: list[str] = []
    for part in p.split("/"):
        if any(ch in part for ch in "*?["):
            break
        if part:
            parts.append(part)
    return "/".join(parts)


def prefixes_overlap(a: str, b: str) -> bool:
    """True when one non-empty prefix is a prefix of the other (or equal)."""
    if not a or not b:
        # Empty prefix ≡ whole repo — treat as overlap with anything non-empty
        # only when the other also expands broadly; empty+empty is overlap.
        if not a and not b:
            return True
        # One side is "whole repo" wildcard like ** — overlap.
        return True
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")


def patterns_heuristically_overlap(left: list[str], right: list[str]) -> bool:
    for a in left:
        for b in right:
            if prefixes_overlap(glob_prefix(a), glob_prefix(b)):
                return True
    return False


def list_repo_files(repo_root: Path, *, limit: int = 20000) -> list[str]:
    """List repo-relative file paths for glob expansion (best-effort)."""
    files: list[str] = []
    root = repo_root.resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune skip dirs in-place.
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_NAMES]
        for name in filenames:
            full = Path(dirpath) / name
            try:
                rel = full.relative_to(root).as_posix()
            except ValueError:
                continue
            files.append(rel)
            if len(files) >= limit:
                return files
    return files


def expand_globs(globs: list[str], files: list[str]) -> set[str]:
    matched: set[str] = set()
    for pattern in globs:
        pat = pattern.strip().replace("\\", "/").lstrip("./")
        if not pat:
            continue
        # fnmatch does not treat ** specially the way gitignore does; also try
        # a recursive-ish variant by matching basename segments.
        for f in files:
            if fnmatch.fnmatch(f, pat) or fnmatch.fnmatch(f, pat.rstrip("/")):
                matched.add(f)
                continue
            # `dir/**` style: prefix match.
            if pat.endswith("/**"):
                prefix = pat[:-3]
                if f == prefix or f.startswith(prefix + "/"):
                    matched.add(f)
            elif pat.endswith("/*"):
                prefix = pat[:-2]
                if f.startswith(prefix + "/") and "/" not in f[len(prefix) + 1 :]:
                    matched.add(f)
    return matched


def scopes_intersect(
    left: list[str],
    right: list[str],
    files: list[str],
    *,
    sample_limit: int = 5,
) -> tuple[bool, list[str], str]:
    """Return (overlaps, sample_paths, reason)."""
    if not left or not right:
        return False, [], ""

    left_files = expand_globs(left, files)
    right_files = expand_globs(right, files)
    shared = sorted(left_files & right_files)
    if shared:
        return True, shared[:sample_limit], "expanded file intersection"

    if patterns_heuristically_overlap(left, right):
        # Prefer showing the conflicting glob pair as samples.
        samples: list[str] = []
        for a in left:
            for b in right:
                if prefixes_overlap(glob_prefix(a), glob_prefix(b)):
                    samples.append(f"{a} ∩ {b}")
                    if len(samples) >= sample_limit:
                        break
            if len(samples) >= sample_limit:
                break
        return True, samples, "prefix/pattern heuristic overlap"

    return False, [], ""


def reachable(graph: dict[str, list[str]], start: str) -> set[str]:
    seen: set[str] = set()
    stack = [start]
    while stack:
        u = stack.pop()
        if u in seen:
            continue
        seen.add(u)
        for v in graph.get(u, []):
            if v not in seen:
                stack.append(v)
    seen.discard(start)
    return seen


def edge_free_pair(graph: dict[str, list[str]], a: str, b: str) -> bool:
    """True when neither reaches the other via depends_on (unordered siblings)."""
    return b not in reachable(graph, a) and a not in reachable(graph, b)


def check_plan_write_scopes(
    children: list[dict],
    *,
    repo_root: Path,
    require_worktree_scope: bool = True,
) -> ScopeCheckReport:
    """Validate write_scope among plan children (slug-keyed).

    Each child dict needs: slug, depends_on (slug list), isolation, write_scope.
    """
    report = ScopeCheckReport()
    by_slug = {str(c["slug"]): c for c in children}
    graph = {
        slug: [d for d in (c.get("depends_on") or []) if d in by_slug]
        for slug, c in by_slug.items()
    }

    for slug, c in by_slug.items():
        isolation = c.get("isolation")
        scope = normalize_write_scope(c.get("write_scope"))
        if require_worktree_scope and isolation == "worktree" and not scope:
            report.conflicts.append(
                ScopeConflict(
                    left=slug,
                    right=slug,
                    samples=[],
                    reason=(
                        "isolation=worktree requires non-empty write_scope "
                        "(declare repo-relative globs)"
                    ),
                )
            )

    files = list_repo_files(repo_root)
    slugs = list(by_slug.keys())
    for i, a in enumerate(slugs):
        for b in slugs[i + 1 :]:
            if not edge_free_pair(graph, a, b):
                continue
            scope_a = normalize_write_scope(by_slug[a].get("write_scope"))
            scope_b = normalize_write_scope(by_slug[b].get("write_scope"))
            if not scope_a or not scope_b:
                continue
            overlaps, samples, reason = scopes_intersect(scope_a, scope_b, files)
            if overlaps:
                report.conflicts.append(
                    ScopeConflict(
                        left=a,
                        right=b,
                        samples=samples,
                        reason=reason or "write_scope overlap",
                    )
                )
    return report


def check_parent_write_scopes(
    parent_dir: Path,
    tasks_dir: Path,
    repo_root: Path,
) -> ScopeCheckReport:
    """Validate write_scope among live children under a parent (dir-name keyed)."""
    report = ScopeCheckReport()
    parent_data = read_json(parent_dir / FILE_TASK_JSON) or {}
    children = list(parent_data.get("children") or [])
    if not children:
        return report

    child_meta: dict[str, dict] = {}
    for name in children:
        data = read_json(tasks_dir / name / FILE_TASK_JSON) or {}
        child_meta[name] = data
        isolation = get_isolation(data)
        scope = get_write_scope(data)
        if isolation == "worktree" and not scope:
            report.warnings.append(
                f"{name}: isolation=worktree but write_scope unset "
                "(legacy; declare write_scope to enable conflict guard)"
            )

    graph = {
        name: [d for d in get_depends_on(child_meta[name]) if d in child_meta]
        for name in children
    }
    files = list_repo_files(repo_root)
    for i, a in enumerate(children):
        for b in children[i + 1 :]:
            if not edge_free_pair(graph, a, b):
                continue
            scope_a = get_write_scope(child_meta[a])
            scope_b = get_write_scope(child_meta[b])
            if not scope_a or not scope_b:
                continue
            overlaps, samples, reason = scopes_intersect(scope_a, scope_b, files)
            if overlaps:
                report.conflicts.append(
                    ScopeConflict(
                        left=a,
                        right=b,
                        samples=samples,
                        reason=reason or "write_scope overlap",
                    )
                )
    return report


def format_scope_conflicts(report: ScopeCheckReport) -> list[str]:
    lines: list[str] = []
    for c in report.conflicts:
        if c.left == c.right:
            lines.append(f"{c.left}: {c.reason}")
        else:
            sample = f" e.g. {', '.join(c.samples)}" if c.samples else ""
            lines.append(
                f"{c.left} ↔ {c.right}: write_scope overlap ({c.reason}){sample}. "
                "Fix: add a depends_on edge, merge the tasks, or narrow the globs."
            )
    return lines
