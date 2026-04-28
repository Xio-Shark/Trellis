import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import {
  resolvePlaceholders,
  resolveCommands,
  resolveSkills,
  resolveBundledSkills,
  writeSkills,
  writeAgents,
  writeSharedHooks,
  applyPullBasedPreludeMarkdown,
} from "./shared.js";
import {
  getAllAgents,
  getSettingsTemplate,
} from "../templates/gemini/index.js";

/**
 * Configure Gemini CLI (pull-based class-2 platform):
 * - commands/trellis/ — start + finish-work as TOML slash commands
 * - skills/trellis-{name}/SKILL.md — other 5 as auto-triggered skills
 * - agents/{name}.md — sub-agent definitions, with pull-based prelude
 * - hooks/*.py — session-start only (no inject-subagent-context.py — Gemini
 *   BeforeTool can fire but #18128 limits chain-of-thought visibility; sub-agents
 *   Read jsonl/prd themselves)
 * - settings.json — hook configuration (SessionStart only)
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

  await writeSkills(
    path.join(configRoot, "skills"),
    resolveSkills(ctx),
    resolveBundledSkills(ctx),
  );
  await writeAgents(
    path.join(configRoot, "agents"),
    applyPullBasedPreludeMarkdown(getAllAgents()),
  );
  await writeSharedHooks(path.join(configRoot, "hooks"), "gemini");

  await writeFile(
    path.join(configRoot, "settings.json"),
    resolvePlaceholders(getSettingsTemplate()),
  );
}
