import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import { resolveAllAsSkills } from "./shared.js";

/**
 * Configure Qoder — skill-only platform.
 * All templates become .qoder/skills/trellis-<name>/SKILL.md
 */
export async function configureQoder(cwd: string): Promise<void> {
  const skillsRoot = path.join(cwd, ".qoder", "skills");
  ensureDir(skillsRoot);

  for (const skill of resolveAllAsSkills(AI_TOOLS.qoder.templateContext)) {
    const skillDir = path.join(skillsRoot, skill.name);
    ensureDir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content);
  }
}
