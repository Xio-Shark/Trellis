/**
 * E2E golden: parallel-plan.v1 → plan-import → waves → integrate (mock backend).
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
  env: Record<string, string> = {},
) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function setupGitRepo(tmp: string): void {
  fs.mkdirSync(path.join(tmp, ".trellis", "scripts"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(tmp, ".trellis", "scripts"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tmp, ".trellis", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "src", "a"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "src", "b"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "src", "a", "x.ts"), "export {}\n");
  fs.writeFileSync(path.join(tmp, "src", "b", "y.ts"), "export {}\n");
  fs.writeFileSync(path.join(tmp, "README.md"), "hi\n");
  run(tmp, "git", ["init"]);
  run(tmp, "git", ["config", "user.email", "test@example.com"]);
  run(tmp, "git", ["config", "user.name", "test"]);
  run(tmp, "git", ["add", "."]);
  run(tmp, "git", ["commit", "-m", "init"]);
}

function runTask(repo: string, args: string[], env: Record<string, string> = {}) {
  return run(repo, "python3", [
    path.join(repo, ".trellis", "scripts", "task.py"),
    ...args,
  ], env);
}

function mmdd(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const describeIfPython = hasPython() ? describe : describe.skip;

describeIfPython("parallel DAG e2e golden", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-e2e-parallel-"));
    setupGitRepo(tmp);
    const parent = path.join(tmp, ".trellis", "tasks", "parent-task");
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(
      path.join(parent, "task.json"),
      JSON.stringify({
        id: "parent",
        name: "parent",
        title: "Parent",
        status: "planning",
        children: [],
        depends_on: [],
      }),
    );
    fs.writeFileSync(
      path.join(tmp, ".trellis", "config.yaml"),
      "parallel:\n  max_concurrency: 2\n  verify_command: \"true\"\n",
    );
  });

  afterEach(() => {
    const wtRoot = path.join(tmp, ".trellis", "worktrees");
    if (fs.existsSync(wtRoot)) {
      for (const name of fs.readdirSync(wtRoot)) {
        run(tmp, "git", ["worktree", "remove", "--force", path.join(wtRoot, name)]);
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("plan-import → ready → dispatch waves → integrate dry-run handoff", () => {
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
            write_scope: ["docs/**"],
          },
        ],
      }),
    );

    const imp = runTask(tmp, ["plan-import", "parent-task", planPath, "--yes"]);
    expect(imp.status).toBe(0);

    const ready1 = runTask(tmp, ["ready", "parent-task"]);
    expect(ready1.stdout + ready1.stderr).toMatch(/Ready \(2\)/);
    expect(ready1.stdout + ready1.stderr).toMatch(/Blocked \(1\)/);

    const dispatch = runTask(
      tmp,
      ["dispatch-ready", "parent-task", "--yes"],
      { TRELLIS_DISPATCH_BACKEND: "mock" },
    );
    expect(dispatch.status).toBe(0);
    expect(dispatch.stdout + dispatch.stderr).toMatch(/concurrency cap=2/);
    expect(dispatch.stdout + dispatch.stderr).toMatch(/Integrate handoff/);

    const prefix = mmdd();
    const a = JSON.parse(
      fs.readFileSync(
        path.join(tmp, ".trellis", "tasks", `${prefix}-child-a`, "task.json"),
        "utf-8",
      ),
    );
    const c = JSON.parse(
      fs.readFileSync(
        path.join(tmp, ".trellis", "tasks", `${prefix}-child-c`, "task.json"),
        "utf-8",
      ),
    );
    expect(a.status).toBe("completed");
    expect(c.status).toBe("completed");

    const integ = runTask(tmp, ["integrate", "parent-task", "--dry-run"]);
    expect(integ.status).toBe(0);
  });
});
