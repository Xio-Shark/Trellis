import { describe, expect, it } from "vitest";
import { getCommandTemplates } from "../../src/configurators/templates.js";

// =============================================================================
// getCommandTemplates — returns command templates by platform
// =============================================================================

describe("getCommandTemplates", () => {
  it("returns non-empty record for claude-code", () => {
    const result = getCommandTemplates("claude-code");
    expect(typeof result).toBe("object");
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it("returns non-empty record for cursor", () => {
    const result = getCommandTemplates("cursor");
    expect(typeof result).toBe("object");
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it("returns empty record for opencode (no command templates)", () => {
    const result = getCommandTemplates("opencode");
    expect(typeof result).toBe("object");
    expect(Object.keys(result).length).toBe(0);
  });

  it("returns empty record for iflow (handled by iflow template reader)", () => {
    const result = getCommandTemplates("iflow");
    expect(typeof result).toBe("object");
    expect(Object.keys(result).length).toBe(0);
  });

  it("defaults to claude-code when no argument", () => {
    const defaultResult = getCommandTemplates();
    const claudeResult = getCommandTemplates("claude-code");
    expect(defaultResult).toEqual(claudeResult);
  });

  it("all values are non-empty strings", () => {
    const result = getCommandTemplates("claude-code");
    for (const [key, value] of Object.entries(result)) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
