/**
 * Integration tests for `task.py dispatch-ready` (parallel Phase B).
 *
 * Uses TRELLIS_DISPATCH_BACKEND=mock so no real channel/trellis CLI spawn.
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
  fs.mkdirSync(path.join(tmp, "wt-a"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "wt-b"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "wt-c"), { recursive: true });
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
  args: string[],
  env: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    "python3",
    [path.join(repo, ".trellis", "scripts", "task.py"), ...args],
    {
      cwd: repo,
      encoding: "utf-8",
      env: { ...process.env, ...env },
    },
  );
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function readStatus(repo: string, name: string): string {
  const p = path.join(repo, ".trellis", "tasks", name, "task.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")).status;
}

const describeIfPython = hasPython() ? describe : describe.skip;

describeIfPython("task.py dispatch-ready", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-dispatch-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function seedWaveFixture(opts?: {
    failA?: boolean;
    drift?: boolean;
    worktreeA?: string | null;
  }): void {
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
        worktree_path: opts?.worktreeA === null ? null : opts?.worktreeA ?? "wt-a",
        meta: opts?.failA ? { dispatch_fail: true } : {},
      },
      opts?.drift
        ? `## Dependencies
- depends_on: \`other\`
- isolation: shared
`
        : `## Dependencies
- depends_on: _(none)_
- isolation: worktree
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
        worktree_path: "wt-b",
        meta: {},
      },
      `## Dependencies
- depends_on: _(none)_
- isolation: worktree
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
        worktree_path: "wt-c",
        meta: {},
      },
      `## Dependencies
- depends_on: \`child-a\`, \`child-b\`
- isolation: worktree
`,
    );
  }

  it("dry-run prints plan and does not change statuses", () => {
    seedWaveFixture();
    const r = runTask(tmp, ["dispatch-ready", "parent-task"], {
      TRELLIS_DISPATCH_BACKEND: "mock",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/DRY-RUN/);
    expect(r.stdout).toMatch(/Planned spawns \(2\)/);
    expect(r.stdout).toContain("child-a");
    expect(r.stdout).toContain("child-b");
    expect(r.stdout).toContain("child-c");
    expect(r.stdout).toMatch(/waiting on/);
    expect(r.stdout).toMatch(/Dry-run only/);
    expect(readStatus(tmp, "child-a")).toBe("planning");
    expect(readStatus(tmp, "child-c")).toBe("planning");
  });

  it("mock --yes completes wave1 then wave2", () => {
    seedWaveFixture();
    const r = runTask(tmp, ["dispatch-ready", "parent-task", "--yes"], {
      TRELLIS_DISPATCH_BACKEND: "mock",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/EXECUTE/);
    expect(readStatus(tmp, "child-a")).toBe("completed");
    expect(readStatus(tmp, "child-b")).toBe("completed");
    expect(readStatus(tmp, "child-c")).toBe("completed");
  });

  it("failure does not unlock downstream and blocks parent archive", () => {
    seedWaveFixture({ failA: true });
    const r = runTask(tmp, ["dispatch-ready", "parent-task", "--yes"], {
      TRELLIS_DISPATCH_BACKEND: "mock",
    });
    expect(r.status).toBe(1);
    expect(readStatus(tmp, "child-a")).toBe("failed");
    // B may still complete in the same wave (parallel); C must stay blocked.
    expect(readStatus(tmp, "child-c")).toBe("planning");

    const arch = runTask(tmp, ["archive", "parent-task"]);
    expect(arch.status).toBe(1);
    expect(arch.stderr + arch.stdout).toMatch(/cannot complete|failed children/i);
  });

  it("worktree without worktree_path fails closed on --yes", () => {
    seedWaveFixture({ worktreeA: null });
    // Clear worktree_path explicitly
    const p = path.join(tmp, ".trellis", "tasks", "child-a", "task.json");
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    data.worktree_path = null;
    fs.writeFileSync(p, JSON.stringify(data, null, 2));

    const dry = runTask(tmp, ["dispatch-ready", "parent-task"], {
      TRELLIS_DISPATCH_BACKEND: "mock",
    });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/cwd ERROR|worktree_path/i);

    const exec = runTask(tmp, ["dispatch-ready", "parent-task", "--yes"], {
      TRELLIS_DISPATCH_BACKEND: "mock",
    });
    expect(exec.status).toBe(1);
    expect(readStatus(tmp, "child-c")).toBe("planning");
  });

  it("drift_fail_closed blocks --yes when dual-write drifts", () => {
    seedWaveFixture({ drift: true });
    fs.writeFileSync(
      path.join(tmp, ".trellis", "config.yaml"),
      "parallel:\n  drift_fail_closed: true\n",
    );
    const r = runTask(tmp, ["dispatch-ready", "parent-task", "--yes"], {
      TRELLIS_DISPATCH_BACKEND: "mock",
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/drift fail-closed/i);
    expect(readStatus(tmp, "child-a")).toBe("planning");
  });

  it("legacy parent without depends graph still dry-runs cleanly", () => {
    writeTask(tmp, "parent-legacy", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["legacy-child"],
    });
    writeTask(tmp, "legacy-child", {
      id: "legacy",
      name: "legacy",
      title: "Legacy",
      status: "planning",
      parent: "parent-legacy",
      children: [],
    });
    const r = runTask(tmp, ["dispatch-ready", "parent-legacy"], {
      TRELLIS_DISPATCH_BACKEND: "mock",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Planned spawns \(1\)/);
    expect(r.stdout).toContain("legacy-child");
    expect(readStatus(tmp, "legacy-child")).toBe("planning");
  });
});
