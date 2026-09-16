/**
 * Persisted Grok CLI session reader.
 *
 * Layout: `~/.grok/sessions/<url-encoded-cwd>/<session-id>/chat_history.jsonl`,
 * with per-session metadata in the sibling `summary.json` (`info.id`,
 * `info.cwd`, `session_summary`, `created_at`, `updated_at`).
 *
 * No database. The sibling `session_search.sqlite` is Grok's own search index
 * and is deliberately ignored — the OpenCode reader was reverted in
 * 0.6.0-beta.4 because a native SQLite dependency broke Windows installs, and
 * nothing here needs one.
 *
 * Event shape — top-level `type`:
 *   user           dialogue, unless it carries `synthetic_reason` (injected
 *                  reminders, project instructions, background-task notices)
 *   assistant      dialogue; `content` is a plain string
 *   reasoning      dropped (encrypted chain-of-thought)
 *   tool_result    dropped
 *   system         dropped (system prompt)
 *   backend_tool_call  dropped
 *
 * Compaction: Grok injects a `synthetic_reason: "compaction_meta"` user event
 * and starts the file from the compacted state. The turns before it are NOT in
 * `chat_history.jsonl`, and the sibling `compaction_checkpoints/*.json` holds
 * the post-compaction seed rather than the lost history — so this adapter marks
 * the boundary and warns instead of pretending the session is whole.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  compactionBoundaryTurn,
  stripInjectionTags,
  isBootstrapTurn,
} from "../dialogue.js";
import { inRangeOverlap, sameProject } from "../filter.js";
import { readJsonFile, readJsonl } from "../internal/jsonl.js";
import { GROK_SESSIONS, grokCwdFromProjectDir } from "../internal/paths.js";
import { parseTaskPyCommandsAll } from "../phase.js";
import { searchInDialogue } from "../search.js";
import type {
  DialogueTurn,
  MemFilter,
  MemSessionInfo,
  MemWarning,
  SearchHit,
  TaskPyEvent,
} from "../types.js";
// Grok encodes tool-call `arguments` exactly like Codex does — a JSON string
// carrying `command` — so the same defensive recovery applies.
import { commandFromCodexArguments } from "./codex.js";

// ---------- loose external shapes ----------

interface GrokContentBlock {
  type?: string;
  text?: string;
}

interface GrokToolCall {
  name?: unknown;
  arguments?: unknown;
}

interface GrokEvent {
  type?: string;
  content?: string | GrokContentBlock[];
  synthetic_reason?: string;
  prompt_index?: number;
  tool_calls?: GrokToolCall[];
}

interface GrokSummary {
  info?: { id?: string; cwd?: string };
  session_summary?: string;
  created_at?: string;
  updated_at?: string;
}

const CHAT_HISTORY = "chat_history.jsonl";
const COMPACTION_META = "compaction_meta";
const WARN_COMPACTION_UNRECOVERABLE = "grok-compaction-unrecoverable";

// ---------- list ----------

/** Yield `<projectDir>/<sessionDir>` pairs that contain a chat history. */
function* grokSessionDirs(f: MemFilter): Generator<{
  projectDir: string;
  sessionDir: string;
}> {
  if (!fs.existsSync(GROK_SESSIONS)) return;
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(GROK_SESSIONS, { withFileTypes: true });
  } catch {
    return;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    // Fast path: the dir name is the cwd, so an out-of-scope project can be
    // skipped without touching its sessions.
    if (f.cwd) {
      const cwd = grokCwdFromProjectDir(project.name);
      if (!sameProject(cwd, f.cwd)) continue;
    }
    const projectDir = path.join(GROK_SESSIONS, project.name);
    let sessions: fs.Dirent[];
    try {
      sessions = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const sessionDir = path.join(projectDir, session.name);
      if (!fs.existsSync(path.join(sessionDir, CHAT_HISTORY))) continue;
      yield { projectDir, sessionDir };
    }
  }
}

export function grokListSessions(f: MemFilter): MemSessionInfo[] {
  const out: MemSessionInfo[] = [];
  for (const { projectDir, sessionDir } of grokSessionDirs(f)) {
    const filePath = path.join(sessionDir, CHAT_HISTORY);
    const summary = readJsonFile<GrokSummary>(
      path.join(sessionDir, "summary.json"),
    );

    const id = summary?.info?.id ?? path.basename(sessionDir);
    const cwd =
      summary?.info?.cwd ?? grokCwdFromProjectDir(path.basename(projectDir));
    if (f.cwd && !sameProject(cwd, f.cwd)) continue;

    const created = summary?.created_at;
    let updated = summary?.updated_at;
    if (!updated) {
      try {
        updated = fs.statSync(filePath).mtime.toISOString();
      } catch {
        updated = undefined;
      }
    }
    if (!inRangeOverlap(created, updated, f)) continue;

    const title = summary?.session_summary?.trim() ?? "";
    out.push({
      platform: "grok",
      id,
      title: title || undefined,
      cwd,
      created,
      updated,
      filePath,
    });
  }
  return out;
}

// ---------- extract ----------

function grokText(content: string | GrokContentBlock[] | undefined): {
  text: string;
  rawLength: number;
} {
  if (typeof content === "string") {
    return { text: stripInjectionTags(content), rawLength: content.length };
  }
  if (!Array.isArray(content)) return { text: "", rawLength: 0 };
  const parts: string[] = [];
  let rawLength = 0;
  for (const block of content) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    rawLength += block.text.length;
    const cleaned = stripInjectionTags(block.text);
    if (cleaned) parts.push(cleaned);
  }
  return { text: parts.join("\n\n"), rawLength };
}

export function grokExtractDialogue(
  s: MemSessionInfo,
  warnings?: MemWarning[],
): DialogueTurn[] {
  return collectGrokTurnsAndEvents(s, warnings).turns;
}

export function grokSearch(s: MemSessionInfo, kw: string): SearchHit {
  // No warnings sink on the search path — it fans out over the whole corpus.
  return searchInDialogue(grokExtractDialogue(s), kw);
}

/**
 * Single pass over `chat_history.jsonl`: cleaned dialogue turns plus the
 * `task.py create|start` invocations found in `run_terminal_command` tool
 * calls, which is what `--phase` slicing needs.
 */
export function collectGrokTurnsAndEvents(
  s: MemSessionInfo,
  warnings?: MemWarning[],
): { turns: DialogueTurn[]; events: TaskPyEvent[] } {
  const turns: DialogueTurn[] = [];
  const events: TaskPyEvent[] = [];
  let compactions = 0;

  readJsonl<GrokEvent>(s.filePath, (obj) => {
    if (obj.type === "user") {
      const reason = obj.synthetic_reason;
      if (reason === COMPACTION_META) {
        compactions++;
        const { text } = grokText(obj.content);
        turns.push(
          compactionBoundaryTurn(
            "context compacted here; Grok starts this file from the compacted state, so earlier turns are not in it",
            text,
          ),
        );
        return;
      }
      // Every other `synthetic_reason` is an injected reminder or a background
      // task notice, not something the user said.
      if (reason !== undefined) return;
      const { text, rawLength } = grokText(obj.content);
      if (text && !isBootstrapTurn(text, rawLength))
        turns.push({ role: "user", text });
      return;
    }

    if (obj.type !== "assistant") return;

    for (const call of obj.tool_calls ?? []) {
      if (call.name !== "run_terminal_command") continue;
      const cmd = commandFromCodexArguments(call.arguments);
      if (!cmd) continue;
      for (const parsed of parseTaskPyCommandsAll(cmd)) {
        events.push({
          action: parsed.action,
          timestamp: "",
          turnIndex: turns.length,
          ...(parsed.action === "create"
            ? { slug: parsed.slug }
            : { taskDir: parsed.taskDir }),
        });
      }
    }

    const { text } = grokText(obj.content);
    if (text) turns.push({ role: "assistant", text });
  });

  if (compactions > 0 && warnings) {
    const archive = path.join(path.dirname(s.filePath), "compaction");
    warnings.push({
      code: WARN_COMPACTION_UNRECOVERABLE,
      message:
        `session ${s.id}: compacted ${compactions} time(s); the turns before each boundary are not in chat_history.jsonl and cannot be recovered as dialogue. ` +
        `Grok keeps a rendered transcript at ${archive}/ if you need to read them.`,
    });
  }

  return { turns, events };
}
