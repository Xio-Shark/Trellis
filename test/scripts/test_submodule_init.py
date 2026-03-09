"""Integration tests for P9: Worktree selective submodule initialization.

Tests that start.py correctly initializes only the submodules needed
by the task's target package.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from conftest import _git


class TestWorktreeSubmoduleInit:
    """Test git worktree + selective submodule init behavior."""

    def test_worktree_submodule_is_empty_by_default(self, monorepo: dict[str, Path]) -> None:
        """Verify the precondition: git worktree add does NOT init submodules."""
        repo = monorepo["repo"]
        wt = monorepo["worktree_base"] / "test-branch"

        _git(["worktree", "add", "-b", "test-branch", str(wt)], cwd=repo)

        # Submodule directory exists but is empty
        sub_dir = wt / "docs-site"
        assert sub_dir.exists()
        assert not (sub_dir / "README.md").exists(), (
            "Submodule should NOT be initialized in a new worktree"
        )

    def test_selective_init_populates_target_submodule(self, monorepo: dict[str, Path]) -> None:
        """P9 core: selective init populates the target submodule."""
        repo = monorepo["repo"]
        wt = monorepo["worktree_base"] / "feat-docs"

        _git(["worktree", "add", "-b", "feat-docs", str(wt)], cwd=repo)

        # Before init: empty
        assert not (wt / "docs-site" / "README.md").exists()

        # Selective init (what start.py does)
        _git(["submodule", "update", "--init", "docs-site"], cwd=wt)

        # After init: populated
        assert (wt / "docs-site" / "README.md").exists()
        assert (wt / "docs-site" / "src" / "index.ts").exists()

    def test_selective_init_does_not_affect_other_submodules(
        self, git_env: Path
    ) -> None:
        """When there are multiple submodules, only the target is initialized."""
        # Set up two submodule remotes
        sub_a_work = git_env / "sub-a-work"
        sub_a_work.mkdir(parents=True)
        _git(["init"], cwd=sub_a_work)
        _git(["config", "user.email", "test@test.com"], cwd=sub_a_work)
        _git(["config", "user.name", "Test"], cwd=sub_a_work)
        (sub_a_work / "a.txt").write_text("a")
        _git(["add", "-A"], cwd=sub_a_work)
        _git(["commit", "-m", "init a"], cwd=sub_a_work)
        sub_a_bare = git_env / "sub-a.git"
        _git(["clone", "--bare", str(sub_a_work), str(sub_a_bare)], cwd=git_env)

        sub_b_work = git_env / "sub-b-work"
        sub_b_work.mkdir(parents=True)
        _git(["init"], cwd=sub_b_work)
        _git(["config", "user.email", "test@test.com"], cwd=sub_b_work)
        _git(["config", "user.name", "Test"], cwd=sub_b_work)
        (sub_b_work / "b.txt").write_text("b")
        _git(["add", "-A"], cwd=sub_b_work)
        _git(["commit", "-m", "init b"], cwd=sub_b_work)
        sub_b_bare = git_env / "sub-b.git"
        _git(["clone", "--bare", str(sub_b_work), str(sub_b_bare)], cwd=git_env)

        # Main repo with both submodules
        repo = git_env / "multi-sub"
        repo.mkdir(parents=True)
        _git(["init"], cwd=repo)
        _git(["config", "user.email", "test@test.com"], cwd=repo)
        _git(["config", "user.name", "Test"], cwd=repo)
        (repo / ".gitkeep").write_text("")
        _git(["add", "-A"], cwd=repo)
        _git(["commit", "-m", "init"], cwd=repo)
        _git(["submodule", "add", str(sub_a_bare), "mod-a"], cwd=repo)
        _git(["submodule", "add", str(sub_b_bare), "mod-b"], cwd=repo)
        _git(["add", "-A"], cwd=repo)
        _git(["commit", "-m", "add submodules"], cwd=repo)

        # Create worktree
        wt = git_env / "wt-multi"
        _git(["worktree", "add", "-b", "feat-a", str(wt)], cwd=repo)

        # Only init mod-a
        _git(["submodule", "update", "--init", "mod-a"], cwd=wt)

        # mod-a populated, mod-b still empty
        assert (wt / "mod-a" / "a.txt").exists()
        assert not (wt / "mod-b" / "b.txt").exists()

    def test_non_submodule_package_needs_no_init(self, monorepo: dict[str, Path]) -> None:
        """Non-submodule packages are already present in the worktree."""
        repo = monorepo["repo"]
        wt = monorepo["worktree_base"] / "feat-cli"

        _git(["worktree", "add", "-b", "feat-cli", str(wt)], cwd=repo)

        # packages/cli/ is a normal directory — already there
        assert (wt / "packages" / "cli" / "src" / "index.ts").exists()

    def test_trellis_spec_available_in_worktree(self, monorepo: dict[str, Path]) -> None:
        """Verify .trellis/spec/ is available in worktree (for agent context injection)."""
        repo = monorepo["repo"]
        wt = monorepo["worktree_base"] / "feat-spec"

        _git(["worktree", "add", "-b", "feat-spec", str(wt)], cwd=repo)

        assert (wt / ".trellis" / "spec" / "cli" / "backend" / "index.md").exists()
        assert (wt / ".trellis" / "spec" / "docs-site" / "docs" / "index.md").exists()
        assert (wt / ".trellis" / "spec" / "guides" / "index.md").exists()
        assert (wt / ".trellis" / "config.yaml").exists()
