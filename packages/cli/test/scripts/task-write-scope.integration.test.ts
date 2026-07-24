/**
 * Integration tests for write_scope conflict guard (plan-import + dispatch gate).
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
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function setupGitRepo(tmp: string): void {
  fs.mkdirSync(path.join(tmp, ".trellis", "scripts"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(tmp, ".trellis", "scripts"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tmp, ".trellis", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "src", "shared"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "src", "shared", "a.ts"), "export {}\n");
  fs.writeFileSync(path.join(tmp, "README.md"), "hi\n");
  run(tmp, "git", ["init"]);
  run(tmp, "git", ["config", "user.email", "test@example.com"]);
  run(tmp, "git", ["config", "user.name", "test"]);
  run(tmp, "git", ["add", "."]);
  run(tmp, "git", ["commit", "-m", "init"]);
}

function writeParent(repo: string): void {
  const dir = path.join(repo, ".trellis", "tasks", "parent-task");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "task.json"),
    JSON.stringify({
      id: "parent",
      name: "parent",
      title: "Parent",
      status: "planning",
      children: [],
      depends_on: [],
    }),
  );
}

function runTask(repo: string, ...args: string[]) {
  return run(repo, "python3", [
    path.join(repo, ".trellis", "scripts", "task.py"),
    ...args,
  ]);
}

const describeIfPython = hasPython() ? describe : describe.skip;

describeIfPython("write_scope conflict guard", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-scope-"));
    setupGitRepo(tmp);
    writeParent(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects edge-free overlapping write_scope at plan-import", () => {
    const plan = path.join(tmp, "overlap.json");
    fs.writeFileSync(
      plan,
      JSON.stringify({
        version: "parallel-plan.v1",
        children: [
          {
            slug: "a",
            title: "A",
            depends_on: [],
            isolation: "worktree",
            write_scope: ["src/**"],
          },
          {
            slug: "b",
            title: "B",
            depends_on: [],
            isolation: "worktree",
            write_scope: ["src/shared/**"],
          },
        ],
      }),
    );
    const r = runTask(tmp, "plan-import", "parent-task", plan, "--yes");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/write_scope overlap/);
    expect(r.stderr).toMatch(/add a depends_on edge|narrow/);
  });

  it("accepts overlap when a depends_on edge orders the pair", () => {
    const plan = path.join(tmp, "edged.json");
    fs.writeFileSync(
      plan,
      JSON.stringify({
        version: "parallel-plan.v1",
        children: [
          {
            slug: "a",
            title: "A",
            depends_on: [],
            isolation: "worktree",
            write_scope: ["src/**"],
          },
          {
            slug: "b",
            title: "B",
            depends_on: ["a"],
            isolation: "worktree",
            write_scope: ["src/shared/**"],
          },
        ],
      }),
    );
    const r = runTask(tmp, "plan-import", "parent-task", plan);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("DRY-RUN");
  });

  it("requires write_scope for isolation=worktree", () => {
    const plan = path.join(tmp, "noscope.json");
    fs.writeFileSync(
      plan,
      JSON.stringify({
        version: "parallel-plan.v1",
        children: [
          { slug: "z", title: "Z", depends_on: [], isolation: "worktree" },
        ],
      }),
    );
    const r = runTask(tmp, "plan-import", "parent-task", plan, "--yes");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/requires non-empty write_scope/);
  });
});
