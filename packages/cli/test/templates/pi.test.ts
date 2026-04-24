import { describe, expect, it } from "vitest";
import {
  getAllAgents,
  getExtensionTemplate,
  getSettingsTemplate,
} from "../../src/templates/pi/index.js";

describe("pi templates", () => {
  it("provides the three Trellis sub-agent definitions", () => {
    const agents = getAllAgents();
    expect(agents.map((agent) => agent.name).sort()).toEqual([
      "trellis-check",
      "trellis-implement",
      "trellis-research",
    ]);

    for (const agent of agents) {
      expect(agent.content).toContain(`name: ${agent.name}`);
      expect(agent.content).not.toContain("inject-subagent-context.py");
    }
  });

  it("settings enable Pi prompts, skills, and the Trellis extension", () => {
    const settings = JSON.parse(getSettingsTemplate().content) as {
      enableSkillCommands?: boolean;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
    };

    expect(settings.enableSkillCommands).toBe(true);
    expect(settings.extensions).toEqual(["./extensions/trellis/index.ts"]);
    expect(settings.skills).toEqual(["./skills"]);
    expect(settings.prompts).toEqual(["./prompts"]);
  });

  it("extension exposes subagent tool and hook-equivalent Pi events", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain('name: "subagent"');
    expect(extension).toContain(
      '["--mode", "json", "-p", "--no-session", toPiPromptArgument(prompt)]',
    );
    expect(extension).toContain('pi.on?.("session_start"');
    expect(extension).toContain('pi.on?.("input"');
    expect(extension).toContain('pi.on?.("before_agent_start"');
    expect(extension).toContain('pi.on?.("context"');
    expect(extension).toContain('pi.on?.("tool_call"');
    expect(extension).not.toContain("inject-subagent-context.py");
  });

  it("extension makes subagent prompts safe for Pi CLI parsing", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain("function stripMarkdownFrontmatter");
    expect(extension).toContain("return stripMarkdownFrontmatter(");
    expect(extension).toContain("function toPiPromptArgument");
    expect(extension).toContain('prompt.startsWith("-")');
    expect(extension).toContain('"## Trellis Agent Definition"');
  });

  it("extension extracts final assistant text from Pi JSON mode output", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain("function extractFinalAssistantText");
    expect(extension).toContain("function extractTextContent");
    expect(extension).toContain("return extractFinalAssistantText(stdout) ?? (stdout || stderr)");
    expect(extension).toContain('message?.role !== "assistant"');
    expect(extension).toContain("Pi can print non-JSON diagnostics around JSON mode");
  });

  it("extension uses Pi runtime-safe event and tool result shapes", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain("Promise<PiToolResult>");
    expect(extension).toContain('content: [{ type: "text", text: output }]');
    expect(extension).toContain('details: {\n          agent: input.agent');
    expect(extension).toContain("ctx?.ui?.notify?.(");
    expect(extension).toContain("systemPrompt:");
    expect(extension).toContain('pi.on?.("input", () => ({ action: "continue" }))');
    expect(extension).not.toContain("message: buildTrellisContext");
    expect(extension).not.toContain('message:\n      "Trellis project context');
    expect(extension).not.toContain("persistent: true");
  });
});
