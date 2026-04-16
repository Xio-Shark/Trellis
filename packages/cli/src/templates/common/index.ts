/**
 * Common templates — single source of truth for all platforms.
 *
 * These templates contain {{placeholders}} that are resolved per-platform
 * by resolvePlaceholders() in configurators/shared.ts.
 *
 * Directory structure:
 *   common/
 *   ├── commands/    # Templates that stay as slash commands (start, finish-work)
 *   └── skills/      # Templates that become auto-triggered skills
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readTemplate(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), "utf-8");
}

function listMarkdownFiles(dir: string): string[] {
  try {
    return readdirSync(join(__dirname, dir))
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

export interface CommonTemplate {
  /** Template name without extension (e.g., "start", "before-dev") */
  name: string;
  /** Raw content with {{placeholders}} — must be resolved before writing */
  content: string;
}

// Cached results — files don't change during a CLI run
let cachedCommands: CommonTemplate[] | undefined;
let cachedSkills: CommonTemplate[] | undefined;

/**
 * Get all command templates (stay as slash commands on all platforms).
 * Results are cached after first call.
 */
export function getCommandTemplates(): CommonTemplate[] {
  cachedCommands ??= listMarkdownFiles("commands").map((file) => ({
    name: file.replace(/\.md$/, ""),
    content: readTemplate(`commands/${file}`),
  }));
  return cachedCommands;
}

/**
 * Get all skill templates (become auto-triggered skills on supporting platforms).
 * Results are cached after first call.
 */
export function getSkillTemplates(): CommonTemplate[] {
  cachedSkills ??= listMarkdownFiles("skills").map((file) => ({
    name: file.replace(/\.md$/, ""),
    content: readTemplate(`skills/${file}`),
  }));
  return cachedSkills;
}
