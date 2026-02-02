"""
CLI Adapter for Multi-Platform Support.

Abstracts differences between Claude Code and OpenCode CLI interfaces.

Supported platforms:
- claude: Claude Code (default)
- opencode: OpenCode

Usage:
    from common.cli_adapter import CLIAdapter

    adapter = CLIAdapter("opencode")
    cmd = adapter.build_run_command(
        agent="dispatch",
        session_id="abc123",
        prompt="Start the pipeline"
    )
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Platform = Literal["claude", "opencode"]


@dataclass
class CLIAdapter:
    """Adapter for different AI coding CLI tools."""

    platform: Platform

    # =========================================================================
    # Agent Name Mapping
    # =========================================================================

    # OpenCode has built-in agents that cannot be overridden
    # See: https://github.com/sst/opencode/issues/4271
    AGENT_NAME_MAP: dict[Platform, dict[str, str]] = {
        "claude": {},  # No mapping needed
        "opencode": {
            "plan": "trellis-plan",  # 'plan' is built-in in OpenCode
        },
    }

    def get_agent_name(self, agent: str) -> str:
        """Get platform-specific agent name.

        Args:
            agent: Original agent name (e.g., 'plan', 'dispatch')

        Returns:
            Platform-specific agent name (e.g., 'trellis-plan' for OpenCode)
        """
        mapping = self.AGENT_NAME_MAP.get(self.platform, {})
        return mapping.get(agent, agent)

    # =========================================================================
    # Agent Path
    # =========================================================================

    def get_agent_path(self, agent: str, project_root: Path) -> Path:
        """Get path to agent definition file.

        Args:
            agent: Agent name (original, before mapping)
            project_root: Project root directory

        Returns:
            Path to agent .md file
        """
        mapped_name = self.get_agent_name(agent)

        if self.platform == "opencode":
            return project_root / ".opencode" / "agents" / f"{mapped_name}.md"
        else:
            return project_root / ".claude" / "agents" / f"{mapped_name}.md"

    # =========================================================================
    # Environment Variables
    # =========================================================================

    def get_non_interactive_env(self) -> dict[str, str]:
        """Get environment variables for non-interactive mode.

        Returns:
            Dict of environment variables to set
        """
        if self.platform == "opencode":
            return {"OPENCODE_NON_INTERACTIVE": "1"}
        else:
            return {"CLAUDE_NON_INTERACTIVE": "1"}

    # =========================================================================
    # CLI Command Building
    # =========================================================================

    def build_run_command(
        self,
        agent: str,
        prompt: str,
        session_id: str | None = None,
        skip_permissions: bool = True,
        verbose: bool = True,
        json_output: bool = True,
    ) -> list[str]:
        """Build CLI command for running an agent.

        Args:
            agent: Agent name (will be mapped if needed)
            prompt: Prompt to send to the agent
            session_id: Optional session ID (Claude Code only for creation)
            skip_permissions: Whether to skip permission prompts
            verbose: Whether to enable verbose output
            json_output: Whether to use JSON output format

        Returns:
            List of command arguments
        """
        mapped_agent = self.get_agent_name(agent)

        if self.platform == "opencode":
            cmd = ["opencode", "run"]
            cmd.extend(["--agent", mapped_agent])

            if skip_permissions:
                cmd.append("--yolo")

            if json_output:
                cmd.extend(["--format", "json"])

            if verbose:
                cmd.extend(["--log-level", "DEBUG", "--print-logs"])

            # Note: OpenCode doesn't support --session-id on creation
            # Session ID must be extracted from logs after startup

            cmd.append(prompt)

        else:  # claude
            cmd = ["claude", "-p"]
            cmd.extend(["--agent", mapped_agent])

            if session_id:
                cmd.extend(["--session-id", session_id])

            if skip_permissions:
                cmd.append("--dangerously-skip-permissions")

            if json_output:
                cmd.extend(["--output-format", "stream-json"])

            if verbose:
                cmd.append("--verbose")

            cmd.append(prompt)

        return cmd

    def build_resume_command(self, session_id: str) -> list[str]:
        """Build CLI command for resuming a session.

        Args:
            session_id: Session ID to resume

        Returns:
            List of command arguments
        """
        if self.platform == "opencode":
            return ["opencode", "run", "--session", session_id]
        else:
            return ["claude", "--resume", session_id]

    def get_resume_command_str(self, session_id: str, cwd: str | None = None) -> str:
        """Get human-readable resume command string.

        Args:
            session_id: Session ID to resume
            cwd: Optional working directory to cd into

        Returns:
            Command string for display
        """
        cmd = self.build_resume_command(session_id)
        cmd_str = " ".join(cmd)

        if cwd:
            return f"cd {cwd} && {cmd_str}"
        return cmd_str

    # =========================================================================
    # Platform Detection Helpers
    # =========================================================================

    @property
    def is_opencode(self) -> bool:
        """Check if platform is OpenCode."""
        return self.platform == "opencode"

    @property
    def is_claude(self) -> bool:
        """Check if platform is Claude Code."""
        return self.platform == "claude"

    @property
    def cli_name(self) -> str:
        """Get CLI executable name."""
        return "opencode" if self.is_opencode else "claude"

    # =========================================================================
    # Session ID Handling
    # =========================================================================

    @property
    def supports_session_id_on_create(self) -> bool:
        """Check if platform supports specifying session ID on creation.

        Claude Code: Yes (--session-id)
        OpenCode: No (auto-generated, extract from logs)
        """
        return self.platform == "claude"

    def extract_session_id_from_log(self, log_content: str) -> str | None:
        """Extract session ID from log output (OpenCode only).

        OpenCode generates session IDs in format: ses_xxx

        Args:
            log_content: Log file content

        Returns:
            Session ID if found, None otherwise
        """
        import re

        # OpenCode session ID pattern
        match = re.search(r"ses_[a-zA-Z0-9]+", log_content)
        if match:
            return match.group(0)
        return None


# =============================================================================
# Factory Function
# =============================================================================


def get_cli_adapter(platform: str = "claude") -> CLIAdapter:
    """Get CLI adapter for the specified platform.

    Args:
        platform: Platform name ('claude' or 'opencode')

    Returns:
        CLIAdapter instance

    Raises:
        ValueError: If platform is not supported
    """
    if platform not in ("claude", "opencode"):
        raise ValueError(f"Unsupported platform: {platform} (must be 'claude' or 'opencode')")

    return CLIAdapter(platform=platform)
