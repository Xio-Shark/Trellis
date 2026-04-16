import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import { resolveCommands, resolveSkills } from "./shared.js";

/**
 * Configure Antigravity:
 * - workflows/ — start + finish-work as slash commands
 * - skills/trellis-{name}/SKILL.md — other 7 as auto-triggered skills
 */
export async function configureAntigravity(cwd: string): Promise<void> {
  const ctx = AI_TOOLS.antigravity.templateContext;

  const workflowsDir = path.join(cwd, ".agent", "workflows");
  ensureDir(workflowsDir);
  for (const cmd of resolveCommands(ctx)) {
    await writeFile(path.join(workflowsDir, `${cmd.name}.md`), cmd.content);
  }

  const skillsDir = path.join(cwd, ".agent", "skills");
  ensureDir(skillsDir);
  for (const skill of resolveSkills(ctx)) {
    const skillDir = path.join(skillsDir, skill.name);
    ensureDir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content);
  }
}
