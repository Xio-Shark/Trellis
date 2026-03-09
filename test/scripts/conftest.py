"""Shared fixtures for .trellis/scripts/ integration tests.

Creates temporary git repos with submodule support for testing
worktree and PR creation workflows.
"""

from __future__ import annotations

import subprocess
import textwrap
from pathlib import Path

import pytest


def _git(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    """Run a git command with local protocol allowed (for submodule tests)."""
    return subprocess.run(
        ["git", "-c", "protocol.file.allow=always", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=check,
    )


def _git_init(path: Path) -> None:
    """Initialize a git repo with an initial commit."""
    path.mkdir(parents=True, exist_ok=True)
    _git(["init"], cwd=path)
    _git(["config", "user.email", "test@test.com"], cwd=path)
    _git(["config", "user.name", "Test"], cwd=path)
    (path / ".gitkeep").write_text("")
    _git(["add", "-A"], cwd=path)
    _git(["commit", "-m", "init"], cwd=path)


@pytest.fixture
def git_env(tmp_path: Path) -> Path:
    """Base tmp_path with git config to avoid user-level config interference."""
    return tmp_path


@pytest.fixture
def simple_repo(git_env: Path) -> Path:
    """A simple git repo with no submodules."""
    repo = git_env / "repo"
    _git_init(repo)
    return repo


@pytest.fixture
def submodule_remote(git_env: Path) -> Path:
    """A bare remote for a submodule."""
    # Create a working repo first, then clone as bare
    work = git_env / "sub-work"
    _git_init(work)
    (work / "README.md").write_text("submodule content\n")
    (work / "src").mkdir()
    (work / "src" / "index.ts").write_text("export const x = 1;\n")
    _git(["add", "-A"], cwd=work)
    _git(["commit", "-m", "add files"], cwd=work)

    bare = git_env / "sub-remote.git"
    _git(["clone", "--bare", str(work), str(bare)], cwd=git_env)
    return bare


@pytest.fixture
def main_remote(git_env: Path) -> Path:
    """A bare remote for the main repo (for push testing)."""
    bare = git_env / "main-remote.git"
    bare.mkdir(parents=True)
    _git(["init", "--bare"], cwd=bare)
    return bare


@pytest.fixture
def monorepo(
    git_env: Path, submodule_remote: Path, main_remote: Path
) -> dict[str, Path]:
    """A full monorepo setup with submodule.

    Returns dict with keys:
        repo: Path to the main working repo
        main_remote: Path to main bare remote
        sub_remote: Path to submodule bare remote
        worktree_base: Path for worktree creation
    """
    repo = git_env / "main"
    _git_init(repo)

    # Add submodule
    _git(["submodule", "add", str(submodule_remote), "docs-site"], cwd=repo)

    # Create non-submodule package dir
    (repo / "packages" / "cli" / "src").mkdir(parents=True)
    (repo / "packages" / "cli" / "src" / "index.ts").write_text("export const y = 2;\n")

    # Create .trellis structure
    trellis = repo / ".trellis"
    trellis.mkdir()
    (trellis / "scripts").mkdir()
    (trellis / "spec" / "cli" / "backend").mkdir(parents=True)
    (trellis / "spec" / "cli" / "backend" / "index.md").write_text("# CLI Backend Spec\n")
    (trellis / "spec" / "docs-site" / "docs").mkdir(parents=True)
    (trellis / "spec" / "docs-site" / "docs" / "index.md").write_text("# Docs Spec\n")
    (trellis / "spec" / "guides").mkdir(parents=True)
    (trellis / "spec" / "guides" / "index.md").write_text("# Guides\n")

    # Write config.yaml
    (trellis / "config.yaml").write_text(textwrap.dedent("""\
        packages:
          cli:
            path: packages/cli
          docs-site:
            path: docs-site
            type: submodule

        default_package: cli
    """))

    # Create a task dir
    task_dir = trellis / "tasks" / "test-task"
    task_dir.mkdir(parents=True)
    (task_dir / "task.json").write_text(textwrap.dedent("""\
        {
          "name": "test-task",
          "package": "docs-site",
          "branch": "feature/test",
          "dev_type": "docs",
          "scope": "docs",
          "status": "in_progress"
        }
    """))

    # Commit everything
    _git(["add", "-A"], cwd=repo)
    _git(["commit", "-m", "setup monorepo"], cwd=repo)

    # Set up remote
    _git(["remote", "add", "origin", str(main_remote)], cwd=repo)
    _git(["push", "-u", "origin", "main"], cwd=repo, check=False)
    # Try pushing whatever the default branch is
    result = _git(["branch", "--show-current"], cwd=repo)
    branch = result.stdout.strip()
    if branch != "main":
        _git(["push", "-u", "origin", branch], cwd=repo, check=False)

    worktree_base = git_env / "worktrees"
    worktree_base.mkdir()

    return {
        "repo": repo,
        "main_remote": main_remote,
        "sub_remote": submodule_remote,
        "worktree_base": worktree_base,
    }
