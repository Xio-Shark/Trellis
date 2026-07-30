/**
 * Integration test for the Kiro output branch of the shared per-turn and
 * session-start hooks.
 *
 * Kiro adds a hook's stdout directly to the conversation context (no JSON
 * envelope). `inject-workflow-state.py` and `session-start.py` therefore have
 * a `platform == "kiro"` branch that prints bare text instead of the
 * Claude-style `{"hookSpecificOutput": ...}` JSON used by every other
 * platform. This test stamps the real templates and runs the actual scripts to
 * verify the branch is plain text for Kiro and that non-Kiro platforms keep the
 * JSON envelope (isolation guard).
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
const SHARED_HOOKS = path.resolve(
  __dirname,
  "../../src/templates/shared-hooks",
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
  // workflow.md with a no_task breadcrumb so the body is deterministic.
  fs.writeFileSync(
    path.join(tmp, ".trellis", "workflow.md"),
    [
      "# Workflow",
      "",
      "## Phase Index",
      "",
      "[workflow-state:no_task]",
      "No active task. Classify the turn before creating a Trellis task.",
      "[/workflow-state:no_task]",
      "",
      "## Phase 1: Plan",
      "",
    ].join("\n"),
  );
}

function runTaskWorkflow(tmp: string, ...args: string[]) {
  return spawnSync(
    "python3",
    [path.join(tmp, ".trellis", "scripts", "task.py"), "workflow", ...args],
    {
      cwd: tmp,
      encoding: "utf-8",
      env: { ...process.env, TRELLIS_CONTEXT_ID: "kiro_test-session" },
    },
  );
}

function setupSelectedWorkflow(tmp: string): void {
  const taskDir = path.join(tmp, ".trellis", "tasks", "demo-task");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, "task.json"),
    JSON.stringify({
      id: "demo-task",
      status: "in_progress",
    }),
  );
  fs.mkdirSync(path.join(tmp, ".trellis", "workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".trellis", "workflows", "tdd.md"),
    [
      "# TDD Workflow",
      "",
      "## Phase Index",
      "TDD_SELECTED_PHASE_INDEX",
      "",
      "[workflow-state:in_progress]",
      "TDD_SELECTED_BREADCRUMB",
      "[/workflow-state:in_progress]",
      "",
      "## Phase 1: Plan",
    ].join("\n"),
  );
  const sessionsDir = path.join(tmp, ".trellis", ".runtime", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, "kiro_test-session.json"),
    JSON.stringify({ current_task: "demo-task" }),
  );
}

function runHook(
  tmp: string,
  script: string,
  platformEnvVar: string,
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(
    "python3",
    [path.join(SHARED_HOOKS, script)],
    {
      cwd: tmp,
      encoding: "utf-8",
      input: JSON.stringify({
        hook_event_name: "userPromptSubmit",
        cwd: tmp,
        session_id: "test-session",
        prompt: "hi",
      }),
      env: { ...process.env, [platformEnvVar]: tmp },
    },
  );
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

const describeFn = hasPython() ? describe : describe.skip;

describeFn("Kiro hook output branch", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-kiro-hook-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("inject-workflow-state.py emits plain-text breadcrumb for Kiro", () => {
    const { stdout, status } = runHook(
      tmp,
      "inject-workflow-state.py",
      "KIRO_PROJECT_DIR",
    );
    expect(status).toBe(0);
    expect(stdout).toContain("<workflow-state>");
    expect(stdout).toContain("Status: no_task");
    // Plain text — NOT the Claude-style JSON envelope.
    expect(stdout).not.toContain("hookSpecificOutput");
    expect(stdout).not.toContain("additionalContext");
  });

  it("inject-workflow-state.py keeps JSON envelope for non-Kiro (isolation)", () => {
    const { stdout, status } = runHook(
      tmp,
      "inject-workflow-state.py",
      "CLAUDE_PROJECT_DIR",
    );
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    expect(parsed.hookSpecificOutput?.additionalContext).toContain(
      "<workflow-state>",
    );
  });

  it("session-start.py emits plain-text overview for Kiro", () => {
    const { stdout, status } = runHook(
      tmp,
      "session-start.py",
      "KIRO_PROJECT_DIR",
    );
    expect(status).toBe(0);
    expect(stdout).toContain("<session-context>");
    expect(stdout).not.toContain("hookSpecificOutput");
    expect(stdout).not.toContain("additional_context");
  });

  it("session-start.py keeps JSON envelope for non-Kiro (isolation)", () => {
    const { stdout, status } = runHook(
      tmp,
      "session-start.py",
      "CLAUDE_PROJECT_DIR",
    );
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    expect(parsed.hookSpecificOutput?.additionalContext).toContain(
      "<session-context>",
    );
  });

  it("uses the active task's selected workflow in per-turn and session-start hooks", () => {
    setupSelectedWorkflow(tmp);
    const selected = runTaskWorkflow(tmp, "tdd");
    expect(selected.status).toBe(0);

    const perTurn = runHook(
      tmp,
      "inject-workflow-state.py",
      "KIRO_PROJECT_DIR",
    );
    expect(perTurn.status).toBe(0);
    expect(perTurn.stdout).toContain("TDD_SELECTED_BREADCRUMB");

    const sessionStart = runHook(tmp, "session-start.py", "KIRO_PROJECT_DIR");
    expect(sessionStart.status).toBe(0);
    expect(sessionStart.stdout).toContain("TDD_SELECTED_PHASE_INDEX");

    const cleared = runTaskWorkflow(tmp, "--clear");
    expect(cleared.status).toBe(0);
    const task = JSON.parse(
      fs.readFileSync(
        path.join(tmp, ".trellis", "tasks", "demo-task", "task.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(task.workflow).toBeUndefined();

    expect(runTaskWorkflow(tmp, "tdd\n").status).toBe(1);
  });

  it("warns once for each explicitly present invalid workflow value", () => {
    setupSelectedWorkflow(tmp);
    const taskJson = path.join(
      tmp,
      ".trellis",
      "tasks",
      "demo-task",
      "task.json",
    );

    for (const workflow of ["", null, 42]) {
      fs.writeFileSync(
        taskJson,
        JSON.stringify({ id: "demo-task", status: "in_progress", workflow }),
      );
      const result = runHook(
        tmp,
        "inject-workflow-state.py",
        "KIRO_PROJECT_DIR",
      );
      const warnings = result.stderr.trim().split(/\r?\n/).filter(Boolean);
      expect(result.status).toBe(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("invalid workflow id");
    }
  });
});
