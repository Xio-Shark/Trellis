import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { writeFile } from "../utils/file-writer.js";
import {
  resolvePlaceholders,
  resolveAllAsSkills,
  writeSkills,
  writeAgents,
  writeSharedHooks,
  applyPullBasedPreludeMarkdown,
} from "./shared.js";
import { getAllAgents, getSettingsTemplate } from "../templates/qoder/index.js";

/**
 * Configure Qoder (pull-based class-2 platform):
 * - skills/trellis-{name}/SKILL.md — all templates as auto-triggered skills
 * - agents/{name}.md — sub-agent definitions, with pull-based prelude prepended
 * - hooks/*.py — session-start only (no inject-subagent-context.py — Qoder hook
 *   can't inject sub-agent prompts; sub-agents Read jsonl/prd themselves)
 * - settings.json — hook configuration (SessionStart only)
 */
export async function configureQoder(cwd: string): Promise<void> {
  const config = AI_TOOLS.qoder;
  const configRoot = path.join(cwd, config.configDir);

  await writeSkills(
    path.join(configRoot, "skills"),
    resolveAllAsSkills(config.templateContext),
  );
  await writeAgents(
    path.join(configRoot, "agents"),
    applyPullBasedPreludeMarkdown(getAllAgents()),
  );
  await writeSharedHooks(path.join(configRoot, "hooks"), {
    exclude: ["inject-subagent-context.py"],
  });

  const settings = getSettingsTemplate();
  await writeFile(
    path.join(configRoot, settings.targetPath),
    resolvePlaceholders(settings.content),
  );
}
