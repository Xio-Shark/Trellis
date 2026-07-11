/**
 * ZCode template module.
 *
 * ZCode (智谱) is an agentic AI coding tool that supports multi-agent
 * collaboration. It stores agents as `.zcode/agents/<name>.md`
 * (Markdown with YAML frontmatter: name, description, color).
 *
 * trellis-implement and trellis-check use pull-based context injection.
 * trellis-research is intentionally standalone: it does not receive the
 * implement/check prelude, and persists findings under the active task's
 * research directory instead.
 *
 * ZCode 3.x supports a workspace hook config at `.zcode/config.json`
 * (SessionStart + UserPromptSubmit). Shared Python hook scripts are written
 * to `.zcode/hooks/` and registered via the config. The config schema is the
 * workspace form: `{ hooks: { enabled: true, events: { <Event>: [...] } } }`
 * — distinct from plugin `hooks.json` files (no `enabled`/`events` wrapper).
 */

import {
  createTemplateReader,
  type AgentTemplate,
  type HookTemplate,
} from "../template-utils.js";

export type { AgentTemplate, HookTemplate };

const { listMdAgents, getSettings } = createTemplateReader(import.meta.url);

/** Sub-agent definitions (trellis-implement, trellis-check, trellis-research). */
export function getAllAgents(): AgentTemplate[] {
  return listMdAgents();
}

/** Hook configuration written to `.zcode/config.json` (workspace config form). */
export function getHooksConfig(): HookTemplate {
  return getSettings("config.json");
}
