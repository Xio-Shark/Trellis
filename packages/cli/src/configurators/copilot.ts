import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { getAllHooks, getHooksConfig } from "../templates/copilot/index.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import {
  resolvePlaceholders,
  resolveCommands,
  resolveSkills,
} from "./shared.js";
import { getSharedHookScripts } from "../templates/shared-hooks/index.js";

/**
 * Configure GitHub Copilot:
 * - prompts/ — start + finish-work as prompt files
 * - skills/trellis-{name}/SKILL.md — other 5 as auto-triggered skills
 * - agents/{name}.agent.md — sub-agent definitions (note .agent.md suffix)
 * - copilot/hooks/ — platform-specific + shared hook scripts
 * - hooks config — hooks.json
 */
export async function configureCopilot(cwd: string): Promise<void> {
  const config = AI_TOOLS.copilot;
  const ctx = config.templateContext;
  const copilotRoot = path.join(cwd, ".github", "copilot");

  const promptsDir = path.join(cwd, ".github", "prompts");
  ensureDir(promptsDir);
  for (const cmd of resolveCommands(ctx)) {
    await writeFile(
      path.join(promptsDir, `${cmd.name}.prompt.md`),
      cmd.content,
    );
  }

  // Skills
  const skillsDir = path.join(cwd, ".github", "skills");
  ensureDir(skillsDir);
  for (const skill of resolveSkills(ctx)) {
    const skillDir = path.join(skillsDir, skill.name);
    ensureDir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content);
  }

  const agentsDir = path.join(cwd, ".github", "agents");
  ensureDir(agentsDir);
  // Copilot agents come from Claude's agent definitions (same content)
  const { getAllAgents: getCursorAgents } =
    await import("../templates/cursor/index.js");
  for (const agent of getCursorAgents()) {
    await writeFile(
      path.join(agentsDir, `${agent.name}.agent.md`),
      agent.content,
    );
  }

  // Platform-specific hook scripts (Copilot's own session-start.py)
  const hooksDir = path.join(copilotRoot, "hooks");
  ensureDir(hooksDir);
  for (const hook of getAllHooks()) {
    await writeFile(path.join(hooksDir, hook.name), hook.content);
  }

  // Shared hook scripts (inject-subagent-context, statusline, etc.)
  for (const hook of getSharedHookScripts()) {
    // Skip session-start.py — Copilot has its own version
    if (hook.name === "session-start.py") continue;
    await writeFile(path.join(hooksDir, hook.name), hook.content);
  }

  // Hooks config
  const resolvedConfig = resolvePlaceholders(getHooksConfig());
  await writeFile(path.join(copilotRoot, "hooks.json"), resolvedConfig);
  const githubHooksDir = path.join(cwd, ".github", "hooks");
  ensureDir(githubHooksDir);
  await writeFile(path.join(githubHooksDir, "trellis.json"), resolvedConfig);
}
