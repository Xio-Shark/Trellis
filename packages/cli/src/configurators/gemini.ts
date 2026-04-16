import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import {
  resolvePlaceholders,
  resolveCommands,
  resolveSkills,
  writeSkills,
  writeAgents,
  writeSharedHooks,
} from "./shared.js";
import {
  getAllAgents,
  getSettingsTemplate,
} from "../templates/gemini/index.js";

/**
 * Configure Gemini CLI:
 * - commands/trellis/ — start + finish-work as TOML slash commands
 * - skills/trellis-{name}/SKILL.md — other 5 as auto-triggered skills
 * - agents/{name}.md — sub-agent definitions
 * - hooks/*.py — shared hook scripts
 * - settings.json — hook configuration (BeforeTool/AfterTool events)
 */
export async function configureGemini(cwd: string): Promise<void> {
  const config = AI_TOOLS.gemini;
  const ctx = config.templateContext;
  const configRoot = path.join(cwd, config.configDir);

  const commandsDir = path.join(configRoot, "commands", "trellis");
  ensureDir(commandsDir);
  for (const cmd of resolveCommands(ctx)) {
    const toml = `description = "Trellis: ${cmd.name}"\n\nprompt = """\n${cmd.content}\n"""\n`;
    await writeFile(path.join(commandsDir, `${cmd.name}.toml`), toml);
  }

  await writeSkills(path.join(configRoot, "skills"), resolveSkills(ctx));
  await writeAgents(path.join(configRoot, "agents"), getAllAgents());
  await writeSharedHooks(path.join(configRoot, "hooks"));

  await writeFile(
    path.join(configRoot, "settings.json"),
    resolvePlaceholders(getSettingsTemplate()),
  );
}
