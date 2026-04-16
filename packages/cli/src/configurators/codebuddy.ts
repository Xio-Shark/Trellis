import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import { resolveCommands, resolveSkills } from "./shared.js";

/**
 * Configure CodeBuddy:
 * - commands/trellis/ — start + finish-work as slash commands
 * - skills/trellis-{name}/SKILL.md — other 7 as auto-triggered skills
 */
export async function configureCodebuddy(cwd: string): Promise<void> {
  const ctx = AI_TOOLS.codebuddy.templateContext;

  const commandsDir = path.join(cwd, ".codebuddy", "commands", "trellis");
  ensureDir(commandsDir);
  for (const cmd of resolveCommands(ctx)) {
    await writeFile(path.join(commandsDir, `${cmd.name}.md`), cmd.content);
  }

  const skillsDir = path.join(cwd, ".codebuddy", "skills");
  ensureDir(skillsDir);
  for (const skill of resolveSkills(ctx)) {
    const skillDir = path.join(skillsDir, skill.name);
    ensureDir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content);
  }
}
