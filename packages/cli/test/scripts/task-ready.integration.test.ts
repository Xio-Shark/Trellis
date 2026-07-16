/**
 * Integration tests for `task.py ready` / `drift` / `deps` (parallel MVP A).
 *
 * Stamps templates into a temp git-less repo and exercises real python3
 * task.py against fixture parent/child trees.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function setupRepo(tmp: string): void {
  fs.mkdirSync(path.join(tmp, ".trellis", "scripts"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(tmp, ".trellis", "scripts"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tmp, ".trellis", "tasks"), { recursive: true });
}

function writeTask(
  repo: string,
  name: string,
  data: Record<string, unknown>,
  prdExtra = "",
): void {
  const dir = path.join(repo, ".trellis", "tasks", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "task.json"), JSON.stringify(data, null, 2));
  fs.writeFileSync(
    path.join(dir, "prd.md"),
    `# ${name}\n\n## Goal\n\ntest\n\n${prdExtra}`,
  );
}

function runTask(
  repo: string,
  ...args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    "python3",
    [path.join(repo, ".trellis", "scripts", "task.py"), ...args],
    { cwd: repo, encoding: "utf-8" },
  );
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

const describeIfPython = hasPython() ? describe : describe.skip;

describeIfPython("task.py ready / drift / deps", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-ready-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("marks empty depends_on children ready; blocked until deps completed", () => {
    writeTask(tmp, "parent-task", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["child-a", "child-b", "child-c"],
      depends_on: [],
    });
    writeTask(
      tmp,
      "child-a",
      {
        id: "a",
        name: "a",
        title: "A",
        status: "planning",
        parent: "parent-task",
        children: [],
        depends_on: [],
        isolation: "worktree",
      },
      `## Dependencies
- depends_on: _(none)_
- isolation: worktree
- parallel_group: wave-1
`,
    );
    writeTask(
      tmp,
      "child-b",
      {
        id: "b",
        name: "b",
        title: "B",
        status: "planning",
        parent: "parent-task",
        children: [],
        depends_on: [],
        isolation: "worktree",
      },
      `## Dependencies
- depends_on: _(none)_
- isolation: worktree
- parallel_group: wave-1
`,
    );
    writeTask(
      tmp,
      "child-c",
      {
        id: "c",
        name: "c",
        title: "C",
        status: "planning",
        parent: "parent-task",
        children: [],
        depends_on: ["child-a", "child-b"],
        isolation: "worktree",
      },
      `## Dependencies
- depends_on: \`child-a\`, \`child-b\`
- isolation: worktree
- parallel_group: wave-2
`,
    );

    const ready1 = runTask(tmp, "ready", "parent-task");
    expect(ready1.status).toBe(0);
    expect(ready1.stdout).toMatch(/Ready \(2\)/);
    expect(ready1.stdout).toContain("child-a");
    expect(ready1.stdout).toContain("child-b");
    expect(ready1.stdout).toMatch(/Blocked \(1\)/);
    expect(ready1.stdout).toContain("child-c");
    expect(ready1.stdout).toContain("waiting on: child-a");

    // Complete A and B → C becomes ready
    for (const name of ["child-a", "child-b"]) {
      const p = path.join(tmp, ".trellis", "tasks", name, "task.json");
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      data.status = "completed";
      fs.writeFileSync(p, JSON.stringify(data, null, 2));
    }

    const ready2 = runTask(tmp, "ready", "parent-task");
    expect(ready2.status).toBe(0);
    expect(ready2.stdout).toMatch(/Ready \(1\)/);
    expect(ready2.stdout).toContain("child-c");
    expect(ready2.stdout).toMatch(/Blocked \(0\)/);
  });

  it("fail-closes on depends_on cycle in parent subgraph", () => {
    writeTask(tmp, "parent-cycle", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["loop-a", "loop-b"],
      depends_on: [],
    });
    writeTask(tmp, "loop-a", {
      id: "a",
      name: "a",
      title: "A",
      status: "planning",
      parent: "parent-cycle",
      children: [],
      depends_on: ["loop-b"],
      isolation: "shared",
    });
    writeTask(tmp, "loop-b", {
      id: "b",
      name: "b",
      title: "B",
      status: "planning",
      parent: "parent-cycle",
      children: [],
      depends_on: ["loop-a"],
      isolation: "shared",
    });

    const r = runTask(tmp, "ready", "parent-cycle");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/CYCLE DETECTED/i);
  });

  it("treats legacy tasks without depends_on/isolation as empty deps", () => {
    writeTask(tmp, "parent-legacy", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["legacy-child"],
    });
    // No depends_on / isolation fields at all
    writeTask(tmp, "legacy-child", {
      id: "legacy",
      name: "legacy",
      title: "Legacy",
      status: "planning",
      parent: "parent-legacy",
      children: [],
    });

    const r = runTask(tmp, "ready", "parent-legacy");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Ready \(1\)/);
    expect(r.stdout).toContain("legacy-child");
    expect(r.stdout).toContain("isolation=(unset)");
  });

  it("drift warns on json vs markdown mismatch without blocking ready", () => {
    writeTask(tmp, "parent-drift", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["drift-child"],
      depends_on: [],
    });
    writeTask(
      tmp,
      "drift-child",
      {
        id: "d",
        name: "d",
        title: "D",
        status: "planning",
        parent: "parent-drift",
        children: [],
        depends_on: [],
        isolation: "worktree",
      },
      `## Dependencies
- depends_on: \`other-task\`
- isolation: shared
`,
    );

    const drift = runTask(tmp, "drift", "parent-drift");
    expect(drift.status).toBe(1);
    expect(drift.stdout).toMatch(/Drift/);
    expect(drift.stdout).toContain("depends_on");
    expect(drift.stdout).toContain("isolation");

    const ready = runTask(tmp, "ready", "parent-drift");
    expect(ready.status).toBe(0);
    expect(ready.stdout).toContain("drift-child");
  });

  it("deps shows reverse dependents", () => {
    writeTask(tmp, "dep-a", {
      id: "a",
      name: "a",
      title: "A",
      status: "planning",
      children: [],
      depends_on: [],
    });
    writeTask(tmp, "dep-b", {
      id: "b",
      name: "b",
      title: "B",
      status: "planning",
      children: [],
      depends_on: ["dep-a"],
      isolation: "shared",
    });

    const r = runTask(tmp, "deps", "dep-a");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("dep-b");
  });
});
