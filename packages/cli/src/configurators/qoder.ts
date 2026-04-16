import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { writeFile } from "../utils/file-writer.js";
import {
  resolvePlaceholders,
  resolveAllAsSkills,
  writeSkills,
  writeAgents,
  writeSharedHooks,
} from "./shared.js";
import { getAllAgents, getSettingsTemplate } from "../templates/qoder/index.js";

/**
 * Configure Qoder:
 * - skills/trellis-{name}/SKILL.md — all templates as auto-triggered skills
 * - agents/{name}.md — sub-agent definitions
 * - hooks/*.py — shared hook scripts
 * - settings.json — hook configuration
 */
export async function configureQoder(cwd: string): Promise<void> {
  const config = AI_TOOLS.qoder;
  const configRoot = path.join(cwd, config.configDir);

  await writeSkills(
    path.join(configRoot, "skills"),
    resolveAllAsSkills(config.templateContext),
  );
  await writeAgents(path.join(configRoot, "agents"), getAllAgents());
  await writeSharedHooks(path.join(configRoot, "hooks"));

  const settings = getSettingsTemplate();
  await writeFile(
    path.join(configRoot, settings.targetPath),
    resolvePlaceholders(settings.content),
  );
}
