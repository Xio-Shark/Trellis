import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import { resolveCommands, resolveSkills } from "./shared.js";

/**
 * Configure Cursor:
 * - commands/ — start + finish-work as slash commands (trellis- prefix, flat)
 * - skills/trellis-{name}/SKILL.md — other 7 as auto-triggered skills
 */
export async function configureCursor(cwd: string): Promise<void> {
  const ctx = AI_TOOLS.cursor.templateContext;

  // start + finish-work as slash commands
  const commandsDir = path.join(cwd, ".cursor", "commands");
  ensureDir(commandsDir);
  for (const cmd of resolveCommands(ctx)) {
    await writeFile(
      path.join(commandsDir, `trellis-${cmd.name}.md`),
      cmd.content,
    );
  }

  // Other 7 as skills
  const skillsDir = path.join(cwd, ".cursor", "skills");
  ensureDir(skillsDir);
  for (const skill of resolveSkills(ctx)) {
    const skillDir = path.join(skillsDir, skill.name);
    ensureDir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content);
  }
}
