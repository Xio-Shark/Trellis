import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  collectReferencedAgents,
  collectMissingAgents,
} from "../../src/utils/agent-refs.js";

describe("collectReferencedAgents", () => {
  it("extracts names from `--agent <name>` flags", () => {
    const body = "Run `trellis channel spawn --agent implement` then check.";
    expect(collectReferencedAgents(body)).toEqual(["implement"]);
  });

  it("extracts names from `--agent=<name>` form", () => {
    const body = "use --agent=check for reviews";
    expect(collectReferencedAgents(body)).toEqual(["check"]);
  });

  it("extracts names from `.trellis/agents/<name>.md` literal paths", () => {
    const body = "Defined in .trellis/agents/architect.md";
    expect(collectReferencedAgents(body)).toEqual(["architect"]);
  });

  it("deduplicates and sorts results across both surface forms", () => {
    const body = `
      trellis channel spawn --agent implement
      trellis channel spawn --agent check
      see .trellis/agents/implement.md for details
      another reference: --agent check
    `;
    expect(collectReferencedAgents(body)).toEqual(["check", "implement"]);
  });

  it("returns empty array when no references are present", () => {
    expect(collectReferencedAgents("just normal text, no agents here")).toEqual(
      [],
    );
  });

  it("ignores names with path-traversal characters", () => {
    // `agent-loader.ts` rejects these, so we silently drop them here too.
    const body = "--agent ../escape";
    expect(collectReferencedAgents(body)).not.toContain("../escape");
  });
});

describe("collectMissingAgents", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-agent-refs-"));
    fs.mkdirSync(path.join(cwd, ".trellis", "agents"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("returns referenced names that are not on disk", () => {
    fs.writeFileSync(
      path.join(cwd, ".trellis", "agents", "implement.md"),
      "---\nname: implement\n---\n",
    );
    const body = "--agent implement --agent check";
    expect(collectMissingAgents(cwd, body)).toEqual(["check"]);
  });

  it("returns [] when every referenced agent exists", () => {
    fs.writeFileSync(
      path.join(cwd, ".trellis", "agents", "implement.md"),
      "---\nname: implement\n---\n",
    );
    fs.writeFileSync(
      path.join(cwd, ".trellis", "agents", "check.md"),
      "---\nname: check\n---\n",
    );
    const body = "--agent implement --agent check";
    expect(collectMissingAgents(cwd, body)).toEqual([]);
  });

  it("recognizes the nested `<name>/AGENT.md` layout", () => {
    fs.mkdirSync(path.join(cwd, ".trellis", "agents", "designer"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(cwd, ".trellis", "agents", "designer", "AGENT.md"),
      "---\nname: designer\n---\n",
    );
    expect(collectMissingAgents(cwd, "--agent designer")).toEqual([]);
  });

  it("returns [] when the workflow body has no references", () => {
    expect(collectMissingAgents(cwd, "plain text, no agents")).toEqual([]);
  });
});
