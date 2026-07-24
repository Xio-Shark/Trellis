/**
 * Integration tests for `task.py plan-import` (parallel-plan.v1).
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

function run(
  cwd: string,
  cmd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function setupGitRepo(tmp: string): void {
  fs.mkdirSync(path.join(tmp, ".trellis", "scripts"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(tmp, ".trellis", "scripts"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tmp, ".trellis", "tasks"), { recursive: true });
  run(tmp, "git", ["init"]);
  run(tmp, "git", ["config", "user.email", "test@example.com"]);
  run(tmp, "git", ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(tmp, "README.md"), "hi\n");
  run(tmp, "git", ["add", "README.md"]);
  run(tmp, "git", ["commit", "-m", "init"]);
}

function writeParent(repo: string, name: string): void {
  const dir = path.join(repo, ".trellis", "tasks", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "task.json"),
    JSON.stringify(
      {
        id: name,
        name,
        title: "Parent",
        status: "planning",
        priority: "P1",
        children: [],
        depends_on: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, "prd.md"), `# ${name}\n`);
}

function runTask(
  repo: string,
  ...args: string[]
): { status: number | null; stdout: string; stderr: string } {
  return run(repo, "python3", [
    path.join(repo, ".trellis", "scripts", "task.py"),
    ...args,
  ]);
}

function mmdd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

const describeIfPython = hasPython() ? describe : describe.skip;

describeIfPython("task.py plan-import", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-plan-import-"));
    setupGitRepo(tmp);
    writeParent(tmp, "parent-task");
  });

  afterEach(() => {
    // Remove worktrees first so rmSync does not fight git locks.
    const wtRoot = path.join(tmp, ".trellis", "worktrees");
    if (fs.existsSync(wtRoot)) {
      for (const name of fs.readdirSync(wtRoot)) {
        run(tmp, "git", [
          "worktree",
          "remove",
          "--force",
          path.join(wtRoot, name),
        ]);
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("dry-run then --yes materializes a∥b → c with worktrees; ready/drift ok", () => {
    const planPath = path.join(tmp, "plan.json");
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        version: "parallel-plan.v1",
        children: [
          {
            slug: "child-a",
            title: "A",
            depends_on: [],
            isolation: "worktree",
            write_scope: ["src/a/**"],
          },
          {
            slug: "child-b",
            title: "B",
            depends_on: [],
            isolation: "worktree",
            write_scope: ["src/b/**"],
          },
          {
            slug: "child-c",
            title: "C",
            depends_on: ["child-a", "child-b"],
            isolation: "shared",
          },
        ],
      }),
    );

    const dry = runTask(tmp, "plan-import", "parent-task", planPath);
    expect(dry.status).toBe(0);
    expect(dry.stderr).toContain("DRY-RUN");
    expect(fs.existsSync(path.join(tmp, ".trellis", "tasks", `${mmdd()}-child-a`))).toBe(
      false,
    );

    const yes = runTask(tmp, "plan-import", "parent-task", planPath, "--yes");
    expect(yes.status).toBe(0);
    expect(yes.stderr).toContain("Materialized 3 children");

    const prefix = mmdd();
    const aDir = path.join(tmp, ".trellis", "tasks", `${prefix}-child-a`);
    const aJson = JSON.parse(fs.readFileSync(path.join(aDir, "task.json"), "utf-8"));
    expect(aJson.isolation).toBe("worktree");
    expect(aJson.write_scope).toEqual(["src/a/**"]);
    expect(aJson.worktree_path).toContain(`${prefix}-child-a`);
    expect(fs.existsSync(path.join(tmp, aJson.worktree_path))).toBe(true);

    const ready = runTask(tmp, "ready", "parent-task");
    expect(ready.status).toBe(0);
    expect(ready.stdout + ready.stderr).toMatch(/Ready \(2\)/);
    expect(ready.stdout + ready.stderr).toMatch(/Blocked \(1\)/);

    const drift = runTask(tmp, "drift", "parent-task");
    expect(drift.status).toBe(0);
    expect(drift.stdout + drift.stderr).toContain("No drift detected");
  });

  it("rejects cycles with zero materialization", () => {
    const planPath = path.join(tmp, "cycle.json");
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        version: "parallel-plan.v1",
        children: [
          { slug: "x", title: "X", depends_on: ["y"], isolation: "shared" },
          { slug: "y", title: "Y", depends_on: ["x"], isolation: "shared" },
        ],
      }),
    );
    const r = runTask(tmp, "plan-import", "parent-task", planPath, "--yes");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/cycle/i);
    expect(fs.existsSync(path.join(tmp, ".trellis", "tasks", `${mmdd()}-x`))).toBe(
      false,
    );
  });

  it("rejects unknown depends_on slug", () => {
    const planPath = path.join(tmp, "bad.json");
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        version: "parallel-plan.v1",
        children: [
          {
            slug: "z",
            title: "Z",
            depends_on: ["missing"],
            isolation: "shared",
          },
        ],
      }),
    );
    const r = runTask(tmp, "plan-import", "parent-task", planPath, "--yes");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown sibling slug/);
  });
});
