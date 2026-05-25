import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Project root detection
// ---------------------------------------------------------------------------

function findProjectRoot(startDir: string): string | null {
   let current = startDir;
   while (true) {
      if (existsSync(join(current, ".trellis"))) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
   }
   return null;
}

// ---------------------------------------------------------------------------
// Active task resolution
// ---------------------------------------------------------------------------

function resolveActiveTaskStatus(
   projectRoot: string,
): { status: string; taskDir: string | null } {
   const sessionsDir = join(projectRoot, ".trellis", ".runtime", "sessions");
   if (!existsSync(sessionsDir)) return { status: "no_task", taskDir: null };

   let sessionFiles: string[];
   try {
      sessionFiles = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
   } catch {
      return { status: "no_task", taskDir: null };
   }
   if (sessionFiles.length === 0) return { status: "no_task", taskDir: null };

   if (sessionFiles.length > 1) {
      sessionFiles.sort((a, b) => {
         const ma = statSync(join(sessionsDir, a)).mtimeMs;
         const mb = statSync(join(sessionsDir, b)).mtimeMs;
         return mb - ma;
      });
   }

   const sessionFile = sessionFiles[0];
   let sessionData: Record<string, unknown>;
   try {
      sessionData = JSON.parse(
         readFileSync(join(sessionsDir, sessionFile), "utf-8"),
      );
   } catch {
      return { status: "no_task", taskDir: null };
   }

   const currentTask = sessionData.current_task;
   if (typeof currentTask !== "string" || !currentTask)
      return { status: "no_task", taskDir: null };

   const taskDir = join(projectRoot, currentTask);
   const taskJsonPath = join(taskDir, "task.json");
   if (!existsSync(taskJsonPath)) return { status: "no_task", taskDir: null };

   let taskData: Record<string, unknown>;
   try {
      taskData = JSON.parse(readFileSync(taskJsonPath, "utf-8"));
   } catch {
      return { status: "no_task", taskDir: null };
   }

   return {
      status: typeof taskData.status === "string" ? taskData.status : "planning",
      taskDir,
   };
}

// ---------------------------------------------------------------------------
// Task context — prd.md, info.md, and jsonl-referenced spec/research files
// ---------------------------------------------------------------------------

function buildTaskContext(projectRoot: string, taskDir: string): string {
   const parts: string[] = [];

   let prd = "";
   try { prd = readFileSync(join(taskDir, "prd.md"), "utf-8"); } catch { }
   if (prd.trim()) parts.push(`## PRD\n\n${prd.trim()}`);

   let info = "";
   try { info = readFileSync(join(taskDir, "info.md"), "utf-8"); } catch { }
   if (info.trim()) parts.push(`## Info\n\n${info.trim()}`);

   for (const jsonlName of ["implement.jsonl", "check.jsonl"]) {
      const jsonlPath = join(taskDir, jsonlName);
      if (!existsSync(jsonlPath)) continue;

      let lines: string[];
      try {
         lines = readFileSync(jsonlPath, "utf-8").split(/\r?\n/);
      } catch {
         continue;
      }

      const fileChunks: string[] = [];
      for (const line of lines) {
         const trimmed = line.trim();
         if (!trimmed) continue;
         try {
            const row = JSON.parse(trimmed) as Record<string, unknown>;
            const file = typeof row.file === "string" ? row.file.trim() : "";
            if (!file) continue;
            let content = "";
            try { content = readFileSync(join(projectRoot, file), "utf-8"); } catch { }
            if (content.trim()) {
               fileChunks.push(`### ${file}\n\n${content.trim()}`);
            }
         } catch {
            // seed rows and malformed lines are non-fatal
         }
      }

      if (fileChunks.length > 0) {
         parts.push(`## ${jsonlName}\n\n${fileChunks.join("\n\n---\n\n")}`);
      }
   }

   return parts.length > 0
      ? `<task-context>\n${parts.join("\n\n")}\n</task-context>`
      : "";
}

// ---------------------------------------------------------------------------
// Session overview — spawns get_context.py; non-fatal fallback on failure
// ---------------------------------------------------------------------------

const SESSION_OVERVIEW_TIMEOUT_MS = 5000;
const SESSION_OVERVIEW_FALLBACK =
   "Trellis workflow system active. Use skills and agents as directed by the workflow state.";

function buildSessionOverview(projectRoot: string): string {
   const script = join(projectRoot, ".trellis", "scripts", "get_context.py");
   if (!existsSync(script)) return SESSION_OVERVIEW_FALLBACK;

   try {
      const result = spawnSync("python3", [script, "--mode", "session-overview"], {
         cwd: projectRoot,
         encoding: "utf-8",
         timeout: SESSION_OVERVIEW_TIMEOUT_MS,
         windowsHide: true,
      });
      if (result.status !== 0 || !result.stdout?.trim()) {
         return SESSION_OVERVIEW_FALLBACK;
      }
      return result.stdout.trim();
   } catch {
      return SESSION_OVERVIEW_FALLBACK;
   }
}

// ---------------------------------------------------------------------------
// Per-turn cache — prevents double-spawn when input + before_agent_start
// fire in the same turn
// ---------------------------------------------------------------------------

class TurnContextCache {
   private key: string | null = null;
   private timestamp = 0;
   private workflowMsg = "";
   private taskContext = "";
   private static readonly TTL_MS = 1500;

   get(projectRoot: string): { workflowMsg: string; taskContext: string } {
      const now = Date.now();
      if (
         this.key === projectRoot &&
         now - this.timestamp < TurnContextCache.TTL_MS
      ) {
         return { workflowMsg: this.workflowMsg, taskContext: this.taskContext };
      }

      const { status, taskDir } = resolveActiveTaskStatus(projectRoot);

      const workflowPath = join(projectRoot, ".trellis", "workflow.md");
      let workflowMd = "";
      try { workflowMd = readFileSync(workflowPath, "utf-8"); } catch { }

      let workflowBody = "";
      if (workflowMd) {
         const blocks = parseWorkflowStateBlocks(workflowMd);
         const activeBlock = blocks.find((b) => b.status === status);
         if (activeBlock) {
            workflowBody = `[workflow-state:${activeBlock.status}]\n${activeBlock.content}\n[/workflow-state:${activeBlock.status}]`;
         }
      }
      if (!workflowBody) {
         workflowBody = "Refer to workflow.md for current step.";
      }

      const overview = buildSessionOverview(projectRoot);
      this.workflowMsg = `<workflow-state>\n${workflowBody}\n</workflow-state>\n\n<session-overview>\n${overview}\n</session-overview>`;
      this.taskContext = taskDir ? buildTaskContext(projectRoot, taskDir) : "";

      this.key = projectRoot;
      this.timestamp = now;
      return { workflowMsg: this.workflowMsg, taskContext: this.taskContext };
   }
}

// ---------------------------------------------------------------------------
// Workflow-state tag parsing
// ---------------------------------------------------------------------------

const WORKFLOW_STATE_RE =
   /\[workflow-state:([A-Za-z0-9_-]+)\]\s*\n([\s\S]*?)\n\s*\[\/workflow-state:\1\]/g;

interface WorkflowStateBlock {
   status: string;
   content: string;
}

function parseWorkflowStateBlocks(markdown: string): WorkflowStateBlock[] {
   const blocks: WorkflowStateBlock[] = [];
   for (const match of markdown.matchAll(WORKFLOW_STATE_RE)) {
      blocks.push({
         status: match[1],
         content: match[2].trim(),
      });
   }
   return blocks;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function(pi: ExtensionAPI): void {
   pi.setLabel("Trellis");

   let projectRoot: string | null = null;
   const turnCache = new TurnContextCache();

   pi.on("session_start", async (_event, ctx) => {
      projectRoot = findProjectRoot(ctx.cwd);
      if (projectRoot) {
         ctx.ui.notify("Trellis workflow system available", "info");
      }
   });

   pi.on("before_agent_start", async (_event, ctx) => {
      if (!projectRoot) {
         projectRoot = findProjectRoot(ctx.cwd);
      }
      if (!projectRoot) return;

      const cached = turnCache.get(projectRoot);

      if (cached.taskContext) {
         await pi.sendMessage({
            customType: "trellis-task-context",
            content: cached.taskContext,
            display: false,
         });
      }

      return {
         message: {
            customType: "trellis-workflow-state",
            content: cached.workflowMsg,
            display: false,
         },
      };
   });

   pi.on("input", async (_event, ctx) => {
      if (!projectRoot) {
         projectRoot = findProjectRoot(ctx.cwd);
      }
      if (!projectRoot) return { action: "continue" };
      const cached = turnCache.get(projectRoot);
      if (cached.workflowMsg) {
         return {
            action: "continue",
            message: {
               customType: "trellis-workflow-state",
               content: cached.workflowMsg,
               display: false,
            },
         };
      }
      return { action: "continue" };
   });
}
