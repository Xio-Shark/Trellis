import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import { resolveCommands, resolveSkills } from "./shared.js";

/**
 * Configure Gemini CLI:
 * - commands/trellis/ — start + finish-work as TOML slash commands
 * - skills/trellis-{name}/SKILL.md — other 7 as auto-triggered skills
 */
export async function configureGemini(cwd: string): Promise<void> {
  const ctx = AI_TOOLS.gemini.templateContext;

  // Gemini commands use TOML format
  const commandsDir = path.join(cwd, ".gemini", "commands", "trellis");
  ensureDir(commandsDir);
  for (const cmd of resolveCommands(ctx)) {
    // Wrap as TOML inline (Gemini's command format)
    const toml = `description = "Trellis: ${cmd.name}"\n\nprompt = """\n${cmd.content}\n"""\n`;
    await writeFile(path.join(commandsDir, `${cmd.name}.toml`), toml);
  }

  const skillsDir = path.join(cwd, ".gemini", "skills");
  ensureDir(skillsDir);
  for (const skill of resolveSkills(ctx)) {
    const skillDir = path.join(skillsDir, skill.name);
    ensureDir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content);
  }
}
