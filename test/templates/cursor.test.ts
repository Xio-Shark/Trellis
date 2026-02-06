import { describe, expect, it } from "vitest";
import { getAllCommands } from "../../src/templates/cursor/index.js";

// =============================================================================
// getAllCommands — reads cursor command templates
// =============================================================================

describe("cursor getAllCommands", () => {
  it("returns an array", () => {
    const commands = getAllCommands();
    expect(Array.isArray(commands)).toBe(true);
  });

  it("returns non-empty list (templates exist)", () => {
    const commands = getAllCommands();
    expect(commands.length).toBeGreaterThan(0);
  });

  it("each command has name and content", () => {
    const commands = getAllCommands();
    for (const cmd of commands) {
      expect(typeof cmd.name).toBe("string");
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.content).toBe("string");
      expect(cmd.content.length).toBeGreaterThan(0);
    }
  });

  it("command names do not include .md extension", () => {
    const commands = getAllCommands();
    for (const cmd of commands) {
      expect(cmd.name).not.toContain(".md");
    }
  });
});
