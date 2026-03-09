"""Integration tests for P10: create_pr.py submodule-aware PR creation.

Tests that create_pr.py correctly detects submodule changes,
commits inside the submodule, pushes, and handles the parent repo ref update.

Note: gh pr create is NOT tested (requires GitHub auth).
We test everything up to and including push, plus dry-run output.
"""

from __future__ import annotations

import sys
from pathlib import Path

from conftest import _git

# Add scripts to path
SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / ".trellis" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))


class TestHasSubmoduleChanges:
    """Test detection of changes inside submodules."""

    def test_no_changes_detected(self, monorepo: dict[str, Path]) -> None:
        repo = monorepo["repo"]
        sub_path = repo / "docs-site"
        # Import the function
        sys.path.insert(0, str(SCRIPTS_DIR / "multi_agent"))
        from create_pr import _has_submodule_changes

        assert not _has_submodule_changes(sub_path)

    def test_changes_detected_after_edit(self, monorepo: dict[str, Path]) -> None:
        repo = monorepo["repo"]
        sub_path = repo / "docs-site"

        # Modify a file inside submodule
        (sub_path / "README.md").write_text("modified content\n")

        sys.path.insert(0, str(SCRIPTS_DIR / "multi_agent"))
        from create_pr import _has_submodule_changes

        assert _has_submodule_changes(sub_path)

    def test_changes_detected_after_new_file(self, monorepo: dict[str, Path]) -> None:
        repo = monorepo["repo"]
        sub_path = repo / "docs-site"

        # Add a new file inside submodule
        (sub_path / "new-file.md").write_text("new\n")

        sys.path.insert(0, str(SCRIPTS_DIR / "multi_agent"))
        from create_pr import _has_submodule_changes

        assert _has_submodule_changes(sub_path)

    def test_nonexistent_path_returns_false(self) -> None:
        sys.path.insert(0, str(SCRIPTS_DIR / "multi_agent"))
        from create_pr import _has_submodule_changes

        assert not _has_submodule_changes(Path("/nonexistent/path"))


class TestCommitAndPushSubmodule:
    """Test committing and pushing inside a submodule."""

    def test_commit_and_push_to_remote(self, monorepo: dict[str, Path]) -> None:
        """Changes in submodule are committed and pushed to submodule remote.

        Note: gh pr create will fail (no GitHub remote) — we test
        commit+push directly and verify the result on the bare remote.
        """
        repo = monorepo["repo"]
        sub_path = repo / "docs-site"
        sub_remote = monorepo["sub_remote"]

        # Make a change
        (sub_path / "README.md").write_text("updated by agent\n")

        # Set git config for submodule (needed for commit)
        _git(["config", "user.email", "test@test.com"], cwd=sub_path)
        _git(["config", "user.name", "Test"], cwd=sub_path)

        # Test commit+push directly (not through _commit_and_push_submodule
        # which also tries gh pr create, which fails without GitHub remote)
        _git(["checkout", "-B", "feature/test"], cwd=sub_path)
        _git(["add", "-A"], cwd=sub_path)
        _git(["commit", "-m", "docs: update readme"], cwd=sub_path)
        _git(["push", "-u", "origin", "feature/test"], cwd=sub_path)

        # Verify commit exists on the branch
        result = _git(["log", "--oneline", "feature/test"], cwd=sub_path)
        assert "docs: update readme" in result.stdout

        # Verify branch exists in bare remote
        result = _git(
            ["rev-parse", "--verify", "feature/test"], cwd=sub_remote, check=False
        )
        assert result.returncode == 0, "Branch should exist in submodule remote"

    def test_dry_run_no_commit(self, monorepo: dict[str, Path]) -> None:
        """Dry run does not create commits."""
        repo = monorepo["repo"]
        sub_path = repo / "docs-site"

        (sub_path / "README.md").write_text("dry run change\n")

        _git(["config", "user.email", "test@test.com"], cwd=sub_path)
        _git(["config", "user.name", "Test"], cwd=sub_path)

        sys.path.insert(0, str(SCRIPTS_DIR / "multi_agent"))
        from create_pr import _commit_and_push_submodule

        # Get commit count before
        result_before = _git(["rev-list", "--count", "HEAD"], cwd=sub_path)
        count_before = int(result_before.stdout.strip())

        ok, _ = _commit_and_push_submodule(
            sub_path, "feature/dry", "docs: dry run", dry_run=True
        )

        assert ok

        # Commit count should not change (dry run creates branch but doesn't commit)
        # Actually checkout -B happens, but no git commit in dry_run
        result_after = _git(
            ["rev-list", "--count", "HEAD"], cwd=sub_path, check=False
        )
        # In dry-run, the branch is created but no commit, so count stays same
        count_after = int(result_after.stdout.strip())
        assert count_after == count_before


class TestParentRepoRefUpdate:
    """Test that parent repo correctly sees submodule ref changes."""

    def test_parent_sees_submodule_ref_change_after_commit(
        self, monorepo: dict[str, Path]
    ) -> None:
        """After committing in submodule, parent repo detects the ref change."""
        repo = monorepo["repo"]
        sub_path = repo / "docs-site"

        # Make change and commit in submodule
        (sub_path / "README.md").write_text("updated\n")
        _git(["config", "user.email", "test@test.com"], cwd=sub_path)
        _git(["config", "user.name", "Test"], cwd=sub_path)
        _git(["add", "-A"], cwd=sub_path)
        _git(["commit", "-m", "update in sub"], cwd=sub_path)

        # Parent repo should see modified submodule
        result = _git(["status", "--porcelain"], cwd=repo)
        assert "docs-site" in result.stdout, (
            "Parent should detect submodule ref change"
        )

        # git add in parent updates the ref pointer
        _git(["add", "docs-site"], cwd=repo)
        result = _git(["diff", "--cached", "--name-only"], cwd=repo)
        assert "docs-site" in result.stdout


class TestWorktreeSubmodulePRFlow:
    """End-to-end test: worktree + submodule change + commit flow."""

    def test_full_worktree_submodule_flow(self, monorepo: dict[str, Path]) -> None:
        """
        Simulate the full parallel agent flow:
        1. Create worktree
        2. Init submodule
        3. Make changes in submodule
        4. Commit + push submodule
        5. Verify parent repo ref update
        """
        repo = monorepo["repo"]
        wt = monorepo["worktree_base"] / "feat-full"
        sub_remote = monorepo["sub_remote"]

        # Step 1: Create worktree
        _git(["worktree", "add", "-b", "feat-full", str(wt)], cwd=repo)

        # Step 2: Init submodule in worktree
        _git(["submodule", "update", "--init", "docs-site"], cwd=wt)
        assert (wt / "docs-site" / "README.md").exists()

        # Step 3: Make changes in submodule
        (wt / "docs-site" / "new-page.md").write_text("# New Page\n")

        # Step 4: Commit + push in submodule
        sub_in_wt = wt / "docs-site"
        _git(["config", "user.email", "test@test.com"], cwd=sub_in_wt)
        _git(["config", "user.name", "Test"], cwd=sub_in_wt)
        _git(["checkout", "-B", "feat-full"], cwd=sub_in_wt)
        _git(["add", "-A"], cwd=sub_in_wt)
        _git(["commit", "-m", "docs: add new page"], cwd=sub_in_wt)
        _git(["push", "-u", "origin", "feat-full"], cwd=sub_in_wt)

        # Verify pushed to submodule remote
        result = _git(
            ["rev-parse", "--verify", "feat-full"], cwd=sub_remote, check=False
        )
        assert result.returncode == 0

        # Step 5: Parent repo ref update
        _git(["add", "docs-site"], cwd=wt)
        result = _git(["diff", "--cached", "--name-only"], cwd=wt)
        assert "docs-site" in result.stdout

        # Verify .trellis/spec still accessible
        assert (wt / ".trellis" / "spec" / "cli" / "backend" / "index.md").exists()
