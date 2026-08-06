import { AI_TOOLS } from "../types/ai-tools.js";
import { collectBothTemplates } from "./shared.js";

/**
 * The Kilo CLI file set — written at init and diffed by `trellis update`.
 * - workflows/ — start + finish-work as slash commands
 * - skills/trellis-{name}/SKILL.md — auto-triggered skills from `common/skills/`
 */
export function collectKiloTemplates(): Map<string, string> {
  return collectBothTemplates(
    AI_TOOLS.kilo.templateContext,
    (n) => `.kilocode/workflows/${n}.md`,
    ".kilocode/skills",
  );
}
