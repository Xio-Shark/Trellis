/**
 * Integration tests for Phase C (xio worker) + L4 (`task.py integrate`).
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

function readJson(repo: string, name: string): Record<string, unknown> {
  const p = path.join(repo, ".trellis", "tasks", name, "task.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function git(repo: string, args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

const describeIfPython = hasPython() ? describe : describe.skip;

describeIfPython("task.py Phase C worker + L4 integrate", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-integrate-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("dry-run dispatch injects Active task context for xio or channel", () => {
    fs.writeFileSync(
      path.join(tmp, ".trellis", "config.yaml"),
      "parallel:\n  worker: channel\n",
    );
    writeTask(tmp, "parent-task", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["child-a"],
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
        worktree_path: "wt-a",
      },
      `## Dependencies\n- depends_on: _(none)_\n- isolation: worktree\n`,
    );
    fs.writeFileSync(
      path.join(tmp, ".trellis", "tasks", "child-a", "design.md"),
      "# Design\n\nphase-c context\n",
    );

    const r = runTask(tmp, ["dispatch-ready", "parent-task"], {
      TRELLIS_DISPATCH_BACKEND: "mock",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Worker:\s*channel/);
    expect(r.stdout).toMatch(/Active task:/);
    expect(r.stdout).toMatch(/--file/);
  });

  it("parallel.worker=channel is honored when configured", () => {
    fs.writeFileSync(
      path.join(tmp, ".trellis", "config.yaml"),
      "parallel:\n  worker: channel\n",
    );
    writeTask(tmp, "parent-task", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["child-a"],
    });
    writeTask(tmp, "child-a", {
      id: "a",
      name: "a",
      title: "A",
      status: "planning",
      parent: "parent-task",
      children: [],
      depends_on: [],
      isolation: "shared",
    });
    const r = runTask(tmp, ["dispatch-ready", "parent-task"], {
      TRELLIS_DISPATCH_BACKEND: "mock",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Worker:\s*channel/);
    expect(r.stdout).toMatch(/trellis channel run/);
  });

  it("integrate is no-op for parents without worktree children", () => {
    writeTask(tmp, "parent-shared", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["docs-child"],
      base_branch: "main",
    });
    writeTask(tmp, "docs-child", {
      id: "docs",
      name: "docs",
      title: "Docs",
      status: "completed",
      parent: "parent-shared",
      children: [],
      depends_on: [],
      isolation: "shared",
    });
    const r = runTask(tmp, ["integrate", "parent-shared"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no-op|No-op/i);
    const meta = readJson(tmp, "parent-shared").meta as Record<string, unknown>;
    expect(meta.integrate_ok).toBe(true);
    expect(meta.integrate_noop).toBe(true);
  });

  it("parent archive blocked until integrate when worktree children exist", () => {
    writeTask(tmp, "parent-wt", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["child-a"],
      base_branch: "main",
    });
    writeTask(tmp, "child-a", {
      id: "a",
      name: "a",
      title: "A",
      status: "completed",
      parent: "parent-wt",
      children: [],
      depends_on: [],
      isolation: "worktree",
      worktree_path: "wt-a",
      branch: "feat/a",
    });
    const arch = runTask(tmp, ["archive", "parent-wt"]);
    expect(arch.status).toBe(1);
    expect(arch.stderr + arch.stdout).toMatch(/integrate/i);
  });

  it("integrate dry-run plans merge without mutating meta", () => {
    git(tmp, ["init"]);
    git(tmp, ["config", "user.email", "test@example.com"]);
    git(tmp, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(tmp, "README.md"), "base\n");
    git(tmp, ["add", "README.md"]);
    git(tmp, ["commit", "-m", "init"]);
    // rename default branch to main if needed
    try {
      git(tmp, ["branch", "-M", "main"]);
    } catch {
      /* already main */
    }
    git(tmp, ["checkout", "-b", "feat/a"]);
    fs.writeFileSync(path.join(tmp, "a.txt"), "from-a\n");
    git(tmp, ["add", "a.txt"]);
    git(tmp, ["commit", "-m", "a"]);
    git(tmp, ["checkout", "main"]);

    writeTask(tmp, "parent-wt", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["child-a"],
      base_branch: "main",
    });
    writeTask(tmp, "child-a", {
      id: "a",
      name: "a",
      title: "A",
      status: "completed",
      parent: "parent-wt",
      children: [],
      depends_on: [],
      isolation: "worktree",
      worktree_path: "wt-a",
      branch: "feat/a",
    });

    const dry = runTask(tmp, ["integrate", "parent-wt", "--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/dry-run/i);
    expect(dry.stdout).toMatch(/feat\/a/);
    const meta = readJson(tmp, "parent-wt").meta as
      | Record<string, unknown>
      | undefined;
    expect(meta?.integrate_ok).toBeUndefined();
  });

  it("integrate merges branch, verifies, and unlocks archive", () => {
    git(tmp, ["init"]);
    git(tmp, ["config", "user.email", "test@example.com"]);
    git(tmp, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(tmp, "README.md"), "base\n");
    git(tmp, ["add", "README.md"]);
    git(tmp, ["commit", "-m", "init"]);
    try {
      git(tmp, ["branch", "-M", "main"]);
    } catch {
      /* already main */
    }
    git(tmp, ["checkout", "-b", "feat/a"]);
    fs.writeFileSync(path.join(tmp, "a.txt"), "from-a\n");
    git(tmp, ["add", "a.txt"]);
    git(tmp, ["commit", "-m", "a"]);
    git(tmp, ["checkout", "main"]);

    fs.writeFileSync(
      path.join(tmp, ".trellis", "config.yaml"),
      "parallel:\n  verify_command: \"true\"\n",
    );
    writeTask(tmp, "parent-wt", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["child-a"],
      base_branch: "main",
    });
    writeTask(tmp, "child-a", {
      id: "a",
      name: "a",
      title: "A",
      status: "completed",
      parent: "parent-wt",
      children: [],
      depends_on: [],
      isolation: "worktree",
      worktree_path: "wt-a",
      branch: "feat/a",
    });

    const integ = runTask(tmp, ["integrate", "parent-wt"]);
    expect(integ.status).toBe(0);
    expect(integ.stdout).toMatch(/integrated/i);
    expect(fs.existsSync(path.join(tmp, "a.txt"))).toBe(true);
    const meta = readJson(tmp, "parent-wt").meta as Record<string, unknown>;
    expect(meta.integrate_ok).toBe(true);

    const arch = runTask(tmp, ["archive", "parent-wt", "--no-commit"]);
    expect(arch.status).toBe(0);
  });

  it("integrate conflict degrades to serial fix task", () => {
    git(tmp, ["init"]);
    git(tmp, ["config", "user.email", "test@example.com"]);
    git(tmp, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(tmp, "conflict.txt"), "base\n");
    git(tmp, ["add", "conflict.txt"]);
    git(tmp, ["commit", "-m", "init"]);
    try {
      git(tmp, ["branch", "-M", "main"]);
    } catch {
      /* already main */
    }
    git(tmp, ["checkout", "-b", "feat/a"]);
    fs.writeFileSync(path.join(tmp, "conflict.txt"), "from-a\n");
    git(tmp, ["add", "conflict.txt"]);
    git(tmp, ["commit", "-m", "a"]);
    git(tmp, ["checkout", "main"]);
    git(tmp, ["checkout", "-b", "feat/b"]);
    fs.writeFileSync(path.join(tmp, "conflict.txt"), "from-b\n");
    git(tmp, ["add", "conflict.txt"]);
    git(tmp, ["commit", "-m", "b"]);
    git(tmp, ["checkout", "main"]);
    // Put main ahead with conflicting content via merging feat/b first conceptually:
    // leave main clean; integrate will merge feat/a then we simulate by having
    // main already contain from-b.
    git(tmp, ["merge", "--no-ff", "-m", "pre", "feat/b"]);

    fs.writeFileSync(
      path.join(tmp, ".trellis", "config.yaml"),
      "parallel:\n  verify_command: \"true\"\n",
    );
    writeTask(tmp, "parent-wt", {
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: ["child-a"],
      base_branch: "main",
    });
    writeTask(tmp, "child-a", {
      id: "a",
      name: "a",
      title: "A",
      status: "completed",
      parent: "parent-wt",
      children: [],
      depends_on: [],
      isolation: "worktree",
      branch: "feat/a",
    });

    const integ = runTask(tmp, ["integrate", "parent-wt"]);
    expect(integ.status).toBe(1);
    expect(integ.stdout + integ.stderr).toMatch(/conflict|serial fix/i);
    const parent = readJson(tmp, "parent-wt");
    const meta = parent.meta as Record<string, unknown>;
    expect(meta.integrate_conflict).toBe(true);
    const children = parent.children as string[];
    expect(children.some((c) => c.includes("integrate-fix"))).toBe(true);
  });
});
