import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import { resolveAllAsSkills } from "./shared.js";

/**
 * Configure Kiro Code — skill-only platform.
 * All templates become .kiro/skills/trellis-<name>/SKILL.md
 */
export async function configureKiro(cwd: string): Promise<void> {
  const skillsRoot = path.join(cwd, ".kiro", "skills");
  ensureDir(skillsRoot);

  for (const skill of resolveAllAsSkills(AI_TOOLS.kiro.templateContext)) {
    const skillDir = path.join(skillsRoot, skill.name);
    ensureDir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content);
  }
}
