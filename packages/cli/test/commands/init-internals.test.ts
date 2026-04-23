import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import {
  isSupportedPythonVersion,
  requireSupportedPython,
} from "../../src/commands/init.js";

describe("isSupportedPythonVersion", () => {
  it("accepts Python 3.9 and newer", () => {
    expect(isSupportedPythonVersion("Python 3.9.6")).toBe(true);
    expect(isSupportedPythonVersion("Python 3.11.12")).toBe(true);
  });

  it("rejects Python versions below 3.9", () => {
    expect(isSupportedPythonVersion("Python 3.8.18")).toBe(false);
    expect(isSupportedPythonVersion("Python 2.7.18")).toBe(false);
  });

  it("rejects unparseable version output", () => {
    expect(isSupportedPythonVersion("something else")).toBe(false);
  });
});

describe("requireSupportedPython", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the detected version when it is supported", () => {
    vi.mocked(execSync).mockReturnValue("Python 3.11.12");

    expect(requireSupportedPython("python3")).toBe("Python 3.11.12");

    expect(execSync).toHaveBeenCalledWith("python3 --version", {
      encoding: "utf-8",
      stdio: "pipe",
    });
  });

  it("throws when the detected version is below the supported floor", () => {
    vi.mocked(execSync).mockReturnValue("Python 3.8.18");

    expect(() => requireSupportedPython("python3")).toThrow(
      'Python 3.8.18 detected via "python3", but Trellis init requires Python ≥ 3.9.',
    );
  });

  it("throws when the command is missing", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("command not found");
    });

    expect(() => requireSupportedPython("python")).toThrow(
      'Python command "python" not found. Trellis init requires Python ≥ 3.9.',
    );
  });
});
