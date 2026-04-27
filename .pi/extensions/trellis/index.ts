import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

type JsonObject = Record<string, unknown>;
type TextContent = { type: "text"; text: string };

interface PiToolResult {
  content: TextContent[];
  details?: JsonObject;
}

interface PiExtensionContext {
  hasUI?: boolean;
  sessionManager?: {
    getSessionId?: () => string;
    getSessionFile?: () => string | undefined;
  };
  ui?: {
    notify?: (message: string, type?: "info" | "warning" | "error") => void;
  };
}

interface PiBeforeAgentStartEvent {
  systemPrompt?: string;
}

interface PiContextEvent {
  messages?: unknown[];
}

interface PiToolCallEvent {
  toolName?: string;
  input?: JsonObject;
}

interface SubagentInput {
  agent?: string;
  prompt?: string;
  mode?: "single" | "parallel" | "chain";
  prompts?: string[];
}

const TRELLIS_AGENT_JSONL: Record<string, string> = {
  "trellis-implement": "implement.jsonl",
  implement: "implement.jsonl",
  "trellis-check": "check.jsonl",
  check: "check.jsonl",
};

function findProjectRoot(startDir: string): string {
  let current = resolve(startDir);
  while (true) {
    if (
      existsSync(join(current, ".trellis")) ||
      existsSync(join(current, ".pi"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(startDir);
    current = parent;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function stripMarkdownFrontmatter(content: string): string {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (match ? normalized.slice(match[0].length) : normalized).trimStart();
}

function toPiPromptArgument(prompt: string): string {
  return prompt.startsWith("-") ? `\n${prompt}` : prompt;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeKey(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 160);
}

function hashValue(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function createProcessContextKey(projectRoot: string): string {
  return `pi_process_${hashValue(
    [projectRoot, process.pid, Date.now(), randomBytes(8).toString("hex")].join(":"),
  )}`;
}

function callString(callback: (() => string | undefined) | undefined): string | null {
  if (!callback) return null;
  try {
    return stringValue(callback());
  } catch {
    return null;
  }
}

function lookupString(data: unknown, keys: string[]): string | null {
  if (!isJsonObject(data)) return null;
  for (const key of keys) {
    const value = stringValue(data[key]);
    if (value) return value;
  }
  for (const nestedKey of ["input", "properties", "event", "hook_input", "hookInput"]) {
    const nested = data[nestedKey];
    const value = lookupString(nested, keys);
    if (value) return value;
  }
  return null;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (!isJsonObject(block)) return "";
      return block.type === "text" && typeof block.text === "string"
        ? block.text
        : "";
    })
    .join("");
}

function extractFinalAssistantText(output: string): string | null {
  let finalText = "";

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed) as JsonObject;
      const message = isJsonObject(event.message) ? event.message : null;
      if (message?.role !== "assistant") continue;

      const text = extractTextContent(message.content);
      if (text) finalText = text;
    } catch {
      // Pi can print non-JSON diagnostics around JSON mode; keep scanning.
    }
  }

  return finalText || null;
}

function formatPiOutput(stdout: string, stderr: string): string {
  return extractFinalAssistantText(stdout) ?? (stdout || stderr);
}

function normalizeTaskRef(raw: string): string | null {
  let normalized = raw.trim().replace(/\\/g, "/");
  if (!normalized) return null;
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (normalized.startsWith("tasks/")) normalized = `.trellis/${normalized}`;
  return normalized;
}

function taskRefToDir(projectRoot: string, taskRef: string): string {
  if (taskRef.startsWith("/")) return taskRef;
  if (taskRef.startsWith(".trellis/")) return join(projectRoot, taskRef);
  return join(projectRoot, ".trellis", "tasks", taskRef);
}

function resolveContextKey(
  input: unknown,
  ctx?: PiExtensionContext,
  fallback?: string | null,
): string | null {
  const override = stringValue(process.env.TRELLIS_CONTEXT_ID);
  if (override) return sanitizeKey(override) || hashValue(override);

  const sessionId =
    callString(ctx?.sessionManager?.getSessionId) ??
    stringValue(process.env.PI_SESSION_ID) ??
    stringValue(process.env.PI_SESSIONID) ??
    lookupString(input, ["session_id", "sessionId", "sessionID"]);
  if (sessionId) return `pi_${sanitizeKey(sessionId) || hashValue(sessionId)}`;

  const transcriptPath =
    callString(ctx?.sessionManager?.getSessionFile) ??
    lookupString(input, [
      "transcript_path",
      "transcriptPath",
      "transcript",
    ]);
  if (transcriptPath) return `pi_transcript_${hashValue(transcriptPath)}`;

  return fallback ?? null;
}

function readCurrentTask(
  projectRoot: string,
  platformInput?: unknown,
  ctx?: PiExtensionContext,
  contextKeyOverride?: string | null,
): string | null {
  const contextKey = resolveContextKey(platformInput, ctx, contextKeyOverride);
  if (contextKey) {
    try {
      const rawContext = readText(
        join(projectRoot, ".trellis", ".runtime", "sessions", `${contextKey}.json`),
      );
      const context = JSON.parse(rawContext) as JsonObject;
      const taskRef = normalizeTaskRef(stringValue(context.current_task) ?? "");
      if (taskRef) return taskRefToDir(projectRoot, taskRef);
    } catch {
      // Missing or malformed session context means no active task.
    }
  }

  return null;
}

function readJsonlFiles(
  projectRoot: string,
  taskDir: string,
  jsonlName: string,
): string {
  const jsonlPath = join(taskDir, jsonlName);
  const lines = readText(jsonlPath).split(/\r?\n/);
  const chunks: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as JsonObject;
      const file = typeof row.file === "string" ? row.file : "";
      if (!file) continue;
      const content = readText(join(projectRoot, file));
      if (content) {
        chunks.push(`## ${file}\n\n${content}`);
      }
    } catch {
      // Seed rows and malformed lines must not block sub-agent startup.
    }
  }

  return chunks.join("\n\n---\n\n");
}

function buildTrellisContext(
  projectRoot: string,
  agent: string,
  platformInput?: unknown,
  ctx?: PiExtensionContext,
  contextKey?: string | null,
): string {
  const taskDir = readCurrentTask(projectRoot, platformInput, ctx, contextKey);
  if (!taskDir) {
    return "No active Trellis task found. Read .trellis/ before proceeding.";
  }

  const prd = readText(join(taskDir, "prd.md"));
  const info = readText(join(taskDir, "info.md"));
  const jsonlName = TRELLIS_AGENT_JSONL[agent] ?? "";
  const specContext = jsonlName
    ? readJsonlFiles(projectRoot, taskDir, jsonlName)
    : "";

  return [
    "## Trellis Task Context",
    `Task directory: ${taskDir}`,
    "",
    "### prd.md",
    prd || "(missing)",
    info ? "\n### info.md\n" + info : "",
    specContext ? "\n### Curated Spec / Research Context\n" + specContext : "",
  ].join("\n");
}

function readAgentDefinition(projectRoot: string, agent: string): string {
  const normalized = agent.startsWith("trellis-") ? agent : `trellis-${agent}`;
  return stripMarkdownFrontmatter(
    readText(join(projectRoot, ".pi", "agents", `${normalized}.md`)),
  );
}

function commandStartsWithTrellisContext(command: string): boolean {
  const trimmed = command.trimStart();
  return (
    /^export\s+TRELLIS_CONTEXT_ID=/.test(trimmed) ||
    /^TRELLIS_CONTEXT_ID=/.test(trimmed) ||
    /^env\s+.*\bTRELLIS_CONTEXT_ID=/.test(trimmed)
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function injectTrellisContextIntoBash(
  event: unknown,
  contextKey: string,
): boolean {
  const toolCall = event as PiToolCallEvent;
  if (toolCall.toolName !== "bash" || !isJsonObject(toolCall.input)) {
    return false;
  }

  const rawCommand = toolCall.input.command;
  if (typeof rawCommand !== "string" || !rawCommand.trim()) {
    return false;
  }
  if (commandStartsWithTrellisContext(rawCommand)) {
    return false;
  }

  toolCall.input.command = `export TRELLIS_CONTEXT_ID=${shellQuote(contextKey)}; ${rawCommand}`;
  return true;
}

function runPi(
  projectRoot: string,
  prompt: string,
  contextKey?: string | null,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "pi",
      ["--mode", "json", "-p", "--no-session", toPiPromptArgument(prompt)],
      {
        cwd: projectRoot,
        env: contextKey
          ? { ...process.env, TRELLIS_CONTEXT_ID: contextKey }
          : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf-8");
      const err = Buffer.concat(stderr).toString("utf-8");
      if (code === 0) {
        resolvePromise(formatPiOutput(out, err));
      } else {
        reject(new Error(err || `pi exited with code ${code ?? "unknown"}`));
      }
    });
  });
}

function buildSubagentPrompt(
  projectRoot: string,
  input: SubagentInput,
  contextKey?: string | null,
): string {
  const agent = input.agent ?? "trellis-implement";
  const normalized = agent.startsWith("trellis-") ? agent : `trellis-${agent}`;
  const definition = readAgentDefinition(projectRoot, normalized);
  const context = buildTrellisContext(
    projectRoot,
    normalized,
    input,
    undefined,
    contextKey,
  );
  const prompt = input.prompt ?? "";

  return [
    "## Trellis Agent Definition",
    definition || "(missing agent definition)",
    "",
    context,
    "",
    "## Delegated Task",
    prompt,
  ].join("\n");
}

async function runSubagent(
  projectRoot: string,
  input: SubagentInput,
  contextKey?: string | null,
): Promise<string> {
  const mode = input.mode ?? "single";
  if (mode === "parallel") {
    const prompts = input.prompts ?? (input.prompt ? [input.prompt] : []);
    const outputs = await Promise.all(
      prompts.map((prompt) =>
        runPi(
          projectRoot,
          buildSubagentPrompt(projectRoot, { ...input, prompt }, contextKey),
          contextKey,
        ),
      ),
    );
    return outputs.join("\n\n---\n\n");
  }

  if (mode === "chain") {
    let previous = "";
    const prompts = input.prompts ?? (input.prompt ? [input.prompt] : []);
    for (const prompt of prompts) {
      previous = await runPi(
        projectRoot,
        buildSubagentPrompt(projectRoot, {
          ...input,
          prompt: previous
            ? `${prompt}\n\nPrevious output:\n${previous}`
            : prompt,
        }, contextKey),
        contextKey,
      );
    }
    return previous;
  }

  return runPi(
    projectRoot,
    buildSubagentPrompt(projectRoot, input, contextKey),
    contextKey,
  );
}

export default function trellisExtension(pi: {
  registerTool?: (tool: JsonObject) => void;
  on?: (
    event: string,
    handler: (event: unknown, ctx?: PiExtensionContext) => unknown,
  ) => void;
  cwd?: string;
}): void {
  const projectRoot = findProjectRoot(pi.cwd ?? process.cwd());
  const processContextKey = createProcessContextKey(projectRoot);
  let currentContextKey: string | null = null;

  const getContextKey = (input?: unknown, ctx?: PiExtensionContext): string => {
    const contextKey = resolveContextKey(
      input,
      ctx,
      currentContextKey ?? processContextKey,
    );
    currentContextKey = contextKey ?? processContextKey;
    return currentContextKey;
  };

  pi.registerTool?.({
    name: "subagent",
    label: "Subagent",
    description: "Run a Trellis project sub-agent with active task context.",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "Agent name, such as trellis-implement or trellis-check.",
        },
        prompt: {
          type: "string",
          description: "Task prompt for the sub-agent.",
        },
        mode: {
          type: "string",
          enum: ["single", "parallel", "chain"],
          description: "Delegation mode.",
        },
        prompts: {
          type: "array",
          items: { type: "string" },
          description: "Prompts for parallel or chain mode.",
        },
      },
      required: ["prompt"],
    },
    execute: async (
      _toolCallId: string,
      input: SubagentInput,
      _signal?: AbortSignal,
      _onUpdate?: (partialResult: PiToolResult) => void,
      ctx?: PiExtensionContext,
    ): Promise<PiToolResult> => {
      const contextKey = getContextKey(input, ctx);
      const output = await runSubagent(projectRoot, input, contextKey);
      return {
        content: [{ type: "text", text: output }],
        details: {
          agent: input.agent ?? "trellis-implement",
          mode: input.mode ?? "single",
        },
      };
    },
  });

  pi.on?.("session_start", (event, ctx) => {
    getContextKey(event, ctx);
    ctx?.ui?.notify?.(
      "Trellis project context is available. Use /trellis-continue to resume the current task.",
      "info",
    );
  });
  pi.on?.("before_agent_start", (event, ctx) => {
    const contextKey = getContextKey(event, ctx);
    const current = (event as PiBeforeAgentStartEvent).systemPrompt ?? "";
    const context = buildTrellisContext(
      projectRoot,
      "trellis-implement",
      event,
      ctx,
      contextKey,
    );
    return {
      systemPrompt: [current, context].filter(Boolean).join("\n\n"),
    };
  });
  pi.on?.("context", (event, ctx) => {
    getContextKey(event, ctx);
    const messages = (event as PiContextEvent).messages;
    return Array.isArray(messages) ? { messages } : undefined;
  });
  pi.on?.("input", (event, ctx) => {
    getContextKey(event, ctx);
    return { action: "continue" };
  });
  pi.on?.("tool_call", (event, ctx) => {
    const contextKey = getContextKey(event, ctx);
    injectTrellisContextIntoBash(event, contextKey);
    return undefined;
  });
}
