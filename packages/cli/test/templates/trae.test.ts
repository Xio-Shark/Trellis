import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAllAgents, getSettingsTemplate } from "../../src/templates/trae/index.js";
import {
  resolveAllAsSkills,
  resolveSkills,
  resolveBundledSkills,
  applyPullBasedPreludeMarkdown,
} from "../../src/configurators/shared.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

const EXPECTED_AGENT_NAMES = [
  "trellis-check",
  "trellis-implement",
  "trellis-research",
];

// Shared skills are sourced from common/ via resolveAllAsSkills (written to
// .trae/skills/ — Trae has its own private config dir, no .agents/skills alias).
describe("trae shared skills (from common source)", () => {
  it("resolves all common templates for trae context", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.trae.templateContext);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content).toContain("description:");
      expect(skill.content).toContain(`name: ${skill.name}`);
    }
  });

  it("does not include platform-specific syntax in resolved output", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.trae.templateContext);
    for (const skill of skills) {
      // Trae uses /trellis- prefix, not /trellis:
      expect(skill.content).not.toContain("/trellis:");
      expect(skill.content).not.toContain(".claude/");
      expect(skill.content).not.toContain(".cursor/");
    }
  });

  it("resolves bundled skills for trae context", () => {
    const bundled = resolveBundledSkills(AI_TOOLS.trae.templateContext);
    expect(bundled.length).toBeGreaterThan(0);
  });

  it("resolves auto-triggered skills (resolveSkills) for trae context", () => {
    const skills = resolveSkills(AI_TOOLS.trae.templateContext);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content).toContain("description:");
      expect(skill.content).toContain(`name: ${skill.name}`);
    }
  });
});

describe("trae getAllAgents", () => {
  it("returns the expected custom agent set", () => {
    const agents = getAllAgents();
    const names = agents.map((agent) => agent.name);
    expect(names).toEqual(EXPECTED_AGENT_NAMES);
  });

  it("each agent is a Markdown file with YAML frontmatter", () => {
    for (const agent of getAllAgents()) {
      expect(agent.content.length).toBeGreaterThan(0);
      expect(agent.content).toMatch(/^---\n/);
      expect(agent.content).toContain("name: ");
      expect(agent.content).toContain("description:");
    }
  });
});

// =============================================================================
// Trae sub-agent recursion guard (mirrors codex issue #234)
// =============================================================================
//
// trellis-implement / trellis-check agent markdown MUST contain a hard recursion
// guard so the dispatched sub-agent does not spawn another
// trellis-implement / trellis-check sub-agent.
describe("trae sub-agent recursion guard", () => {
  for (const name of ["trellis-implement", "trellis-check"] as const) {
    it(`${name}.md forbids spawning trellis-implement / trellis-check`, () => {
      const mdPath = path.join(
        repoRoot,
        "packages/cli/src/templates/trae/agents",
        `${name}.md`,
      );
      const content = fs.readFileSync(mdPath, "utf-8");
      // Hard prohibition keyword
      expect(content).toMatch(/Do NOT spawn/i);
      // Mentions both sibling agent kinds explicitly
      expect(content).toContain("trellis-implement");
      expect(content).toContain("trellis-check");
      // Mentions the leakage source so the reader knows why
      expect(content).toMatch(
        /SessionStart|dispatch.*main session|breadcrumb/i,
      );
    });
  }
});

describe("trae has no config.toml (no Codex CLI trust mechanism)", () => {
  it("does not ship a config.toml template", () => {
    const configPath = path.join(
      repoRoot,
      "packages/cli/src/templates/trae/config.toml",
    );
    expect(fs.existsSync(configPath)).toBe(false);
  });
});

describe("trae hooks.json registers SessionStart + UserPromptSubmit", () => {
  const hooksPath = path.join(
    repoRoot,
    "packages/cli/src/templates/trae/hooks.json",
  );

  it("includes version field and wires session-start.py under SessionStart", () => {
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: number; hooks?: Record<string, unknown> };
    expect(parsed.version).toBe(1);
    expect(parsed.hooks).toBeDefined();
    expect(Object.keys(parsed.hooks ?? {})).toContain("SessionStart");
    expect(raw).toContain(".trae/hooks/session-start.py");
    // Trae docs: matcher is only for PreToolUse/PostToolUse/Notification.
    // SessionStart fires once per new session (source: "startup" only).
    // Having matchers on SessionStart would cause 3x execution or be ignored.
    const sessionStartGroups = (parsed.hooks as Record<string, Record<string, unknown>[]>)["SessionStart"];
    expect(sessionStartGroups).toHaveLength(1);
    expect(sessionStartGroups[0]).not.toHaveProperty("matcher");
  });

  it("wires inject-workflow-state.py under UserPromptSubmit", () => {
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    expect(parsed.hooks).toBeDefined();
    expect(Object.keys(parsed.hooks ?? {})).toContain("UserPromptSubmit");
    expect(raw).toContain(".trae/hooks/inject-workflow-state.py");
  });

  it("does not register any other hook events", () => {
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    expect(Object.keys(parsed.hooks ?? {}).sort()).toEqual(
      ["SessionStart", "UserPromptSubmit"].sort(),
    );
  });

  it("UserPromptSubmit hook group has no matcher", () => {
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    const userPromptGroups = (parsed.hooks as Record<string, Record<string, unknown>[]>)["UserPromptSubmit"];
    expect(userPromptGroups).toHaveLength(1);
    expect(userPromptGroups[0]).not.toHaveProperty("matcher");
  });
});

describe("trae getSettingsTemplate", () => {
  it("returns hooks.json as the target path with version field", () => {
    const settings = getSettingsTemplate();
    expect(settings.targetPath).toBe("hooks.json");
    expect(settings.content).toContain("\"version\": 1");
    expect(settings.content).toContain("SessionStart");
    expect(settings.content).toContain("UserPromptSubmit");
  });
});

// inject-workflow-state.py is shared across platforms; its _detect_platform()
// must map a hook installed under .trae/ to the "trae" platform so the
// breadcrumb is emitted with the right context (mirrors the .codex branch).
describe("trae platform detection in shared inject-workflow-state.py", () => {
  it("_detect_platform returns 'trae' for a .trae script path", () => {
    const hookPath = path.join(
      repoRoot,
      "packages/cli/src/templates/shared-hooks/inject-workflow-state.py",
    );
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toMatch(/if "\.trae" in script_parts:\s*\n\s*return "trae"/);
  });
});

// session-start.py is also a shared hook for Trae; it must detect .trae paths
// and TRAE_PROJECT_DIR env so the SessionStart context is emitted correctly.
describe("trae platform detection in shared session-start.py", () => {
  it("detects .trae directory and TRAE_PROJECT_DIR env", () => {
    const hookPath = path.join(
      repoRoot,
      "packages/cli/src/templates/shared-hooks/session-start.py",
    );
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toMatch(/if "\.trae" in script_parts:\s*\n\s*return "trae"/);
    expect(content).toContain("TRAE_PROJECT_DIR");
  });
});

// =============================================================================
// Pull-based prelude (class-2 platform)
// =============================================================================
//
// Trae is a class-2 (pull-based) platform: hooks cannot mutate sub-agent
// prompts. The implement/check agents must have a pull-based prelude injected
// so they load Trellis context themselves.
describe("trae pull-based prelude injection (class-2)", () => {
  it("applyPullBasedPreludeMarkdown injects context-loading instructions", () => {
    const agents = applyPullBasedPreludeMarkdown(getAllAgents());
    for (const agent of agents) {
      if (
        agent.name === "trellis-implement" ||
        agent.name === "trellis-check"
      ) {
        expect(agent.content).toContain("Load Trellis Context First");
        expect(agent.content).toContain("task.py current --source");
      }
    }
  });

  it("research agent does not get the prelude (no task context needed)", () => {
    const agents = applyPullBasedPreludeMarkdown(getAllAgents());
    const research = agents.find((a) => a.name === "trellis-research");
    expect(research).toBeDefined();
    if (!research) return; // guard for type-safety
    expect(research.content).not.toContain("Load Trellis Context First");
  });
});
