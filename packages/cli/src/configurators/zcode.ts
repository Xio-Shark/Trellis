/**
 * ZCode configurator.
 *
 * ZCode (智谱) is a pull-based class-2 platform (agentCapable, no hooks).
 * Three output paths:
 * - `.agents/skills/` — shared skills, byte-identical with Codex/Gemini writes
 * - `.zcode/commands/trellis/` — slash commands (invoked as /trellis:<name>)
 * - `.zcode/agents/` — sub-agent definitions with pull-based prelude
 */

import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import { getAllAgents } from "../templates/zcode/index.js";
import {
  collectSkillTemplates,
  resolveSkillsNeutral,
  resolveBundledSkills,
  resolveCommands,
  writeSkills,
  writeAgents,
  applyPullBasedPreludeMarkdown,
} from "./shared.js";

/**
 * Collect all ZCode template files for `trellis update` diff tracking.
 * Must stay in sync with `configureZcode`.
 */
export function collectZcodeTemplates(): Map<string, string> {
  const config = AI_TOOLS.zcode;
  const ctx = config.templateContext;
  const files = new Map<string, string>();

  // 1. Shared skills → .agents/skills/ (byte-identical with Codex/Gemini)
  for (const [filePath, content] of collectSkillTemplates(
    ".agents/skills",
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  // 2. Commands → .zcode/commands/trellis/
  for (const cmd of resolveCommands(ctx)) {
    files.set(`.zcode/commands/trellis/${cmd.name}.md`, cmd.content);
  }

  // 3. Sub-agents → .zcode/agents/ (with pull-based prelude)
  for (const agent of applyPullBasedPreludeMarkdown(getAllAgents())) {
    files.set(`.zcode/agents/${agent.name}.md`, agent.content);
  }

  return files;
}

/**
 * Configure ZCode at init time: write shared skills, commands, and sub-agents.
 */
export async function configureZcode(cwd: string): Promise<void> {
  const config = AI_TOOLS.zcode;
  const ctx = config.templateContext;

  // 1. Shared skills → .agents/skills/
  await writeSkills(
    path.join(cwd, ".agents", "skills"),
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  );

  // 2. Commands → .zcode/commands/trellis/
  const commandsDir = path.join(cwd, ".zcode", "commands", "trellis");
  ensureDir(commandsDir);
  for (const cmd of resolveCommands(ctx)) {
    await writeFile(path.join(commandsDir, `${cmd.name}.md`), cmd.content);
  }

  // 3. Sub-agents → .zcode/agents/ (with pull-based prelude)
  await writeAgents(
    path.join(cwd, ".zcode", "agents"),
    applyPullBasedPreludeMarkdown(getAllAgents()),
  );
}
