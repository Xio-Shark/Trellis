import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { getAllHooks, getHooksConfig } from "../templates/copilot/index.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import {
  resolvePlaceholders,
  resolveCommands,
  resolveSkills,
} from "./shared.js";

/**
 * Configure GitHub Copilot:
 * - prompts/ — start + finish-work as prompt files
 * - skills/trellis-{name}/SKILL.md — other 7 as auto-triggered skills
 * - copilot/hooks/ — platform-specific hooks
 */
export async function configureCopilot(cwd: string): Promise<void> {
  const ctx = AI_TOOLS.copilot.templateContext;
  const copilotRoot = path.join(cwd, ".github", "copilot");

  // start + finish-work as prompt files
  const promptsDir = path.join(cwd, ".github", "prompts");
  ensureDir(promptsDir);
  for (const cmd of resolveCommands(ctx)) {
    await writeFile(
      path.join(promptsDir, `${cmd.name}.prompt.md`),
      cmd.content,
    );
  }

  // Other 7 as skills
  const skillsDir = path.join(cwd, ".github", "skills");
  ensureDir(skillsDir);
  for (const skill of resolveSkills(ctx)) {
    const skillDir = path.join(skillsDir, skill.name);
    ensureDir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content);
  }

  // Hook scripts (platform-specific)
  const hooksDir = path.join(copilotRoot, "hooks");
  ensureDir(hooksDir);
  for (const hook of getAllHooks()) {
    await writeFile(path.join(hooksDir, hook.name), hook.content);
  }

  // Hooks config
  const resolvedConfig = resolvePlaceholders(getHooksConfig());
  await writeFile(path.join(copilotRoot, "hooks.json"), resolvedConfig);
  const githubHooksDir = path.join(cwd, ".github", "hooks");
  ensureDir(githubHooksDir);
  await writeFile(path.join(githubHooksDir, "trellis.json"), resolvedConfig);
}
