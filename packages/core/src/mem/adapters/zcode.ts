/**
 * ZCode (Zhipu) persisted-session reader.
 *
 * ZCode stores sessions in a SQLite database at `~/.zcode/cli/db/db.sqlite`
 * (WAL mode). The three tables this adapter reads are:
 *
 *   - `session`  — id / title / directory (workspace cwd) / time_created /
 *                  time_updated / task_type
 *   - `message`  — id / session_id / time_created / data (JSON: {role, ...})
 *   - `part`     — message_id / time_created / data (JSON: {type, text|tool, ...})
 *                  plus compaction markers that replace earlier dialogue with
 *                  a summary message.
 *
 * The older `~/.zcode/v2/sessions/*.json` layout is abandoned by current ZCode,
 * and `~/.zcode/cli/rollout/*.jsonl` is a non-persistent model-IO stream that
 * gets cleaned up periodically — neither is read here. SQLite is the single
 * complete source of truth (see `docs-hlaia/06-...` for the investigation).
 *
 * SQLite access is via the zero-dependency parser in `internal/sqlite-readonly.ts`
 * — `better-sqlite3` was rejected because its native build chain broke npm
 * install on Windows for the OpenCode adapter.
 */

import * as fs from "node:fs";

import { stripInjectionTags, isBootstrapTurn } from "../dialogue.js";
import { inRangeOverlap, sameProject } from "../filter.js";
import {
  openSqliteReadOnly,
  SqliteParseError,
  SqliteSnapshotUnstableError,
  type SqliteRow,
} from "../internal/sqlite-readonly.js";
import { ZCODE_DB } from "../internal/paths.js";
import { parseTaskPyCommandsAll } from "../phase.js";
import { searchInDialogue } from "../search.js";
import type {
  DialogueRole,
  DialogueTurn,
  MemFilter,
  MemSessionInfo,
  MemWarning,
  SearchHit,
  TaskPyEvent,
} from "../types.js";

// ---------- loose external shapes ----------

interface ZcodeMessageData {
  role?: string;
}

interface ZcodeTextPart {
  type?: string;
  text?: string;
}

interface ZcodeToolPart {
  type?: string;
  tool?: string;
  state?: { input?: { command?: string } };
}

interface ZcodePartData {
  type?: string;
  text?: string;
  tool?: string;
  state?: { input?: { command?: string } };
  summaryMessageId?: unknown;
  tail_start_id?: unknown;
  compactBoundary?: unknown;
}

function parseDialogueRole(v: unknown): DialogueRole | undefined {
  return v === "user" || v === "assistant" ? v : undefined;
}

/** Safely parse the JSON stored in a `data` column. Returns null on failure. */
function parseDataJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ---------- shared scan helpers ----------

interface ZcodeMessageRow {
  id: string;
  time_created: number;
  role: DialogueRole;
}

interface ZcodePartRow {
  message_id: string;
  time_created: number;
  data: Record<string, unknown>;
}

/**
 * All sessions' messages + parts read from one db, grouped by session id.
 * This full-db shape is used only by the search-scoped store; extract/context
 * paths instead scan and retain just the requested session's rows.
 */
interface ZcodeSessionStore {
  /** sessionId → that session's messages in time order. */
  messagesBySession: Map<string, ZcodeMessageRow[]>;
  /** messageId → that message's parts in time order (across all sessions). */
  partsByMsg: Map<string, ZcodePartRow[]>;
}

const ZCODE_DB_UNREADABLE_WARNING_CODE = "zcode-db-unreadable";
const ZCODE_DB_SNAPSHOT_UNSTABLE_WARNING_CODE =
  "zcode-db-snapshot-unstable";

function emptySessionStore(): ZcodeSessionStore {
  return { messagesBySession: new Map(), partsByMsg: new Map() };
}

function pushDbWarning(
  warnings: MemWarning[],
  dbPath: string,
  error: SqliteParseError,
): void {
  const isSnapshotUnstable = error instanceof SqliteSnapshotUnstableError;
  const code = isSnapshotUnstable
    ? ZCODE_DB_SNAPSHOT_UNSTABLE_WARNING_CODE
    : ZCODE_DB_UNREADABLE_WARNING_CODE;
  if (warnings.some((warning) => warning.code === code)) return;
  warnings.push({
    code,
    message: isSnapshotUnstable
      ? `ZCode 正在写入，请重试。 (${dbPath})`
      : `cannot read ZCode session database (${dbPath}): ${error.message}`,
  });
}

function requireTables(
  db: ReturnType<typeof openSqliteReadOnly>,
  names: readonly string[],
): void {
  const available = new Set(db.listTables().map((table) => table.name));
  const missing = names.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new SqliteParseError(
      `ZCode database schema is missing table(s): ${missing.join(", ")}`,
    );
  }
}

function requireTableColumns(
  db: ReturnType<typeof openSqliteReadOnly>,
  tableName: string,
  names: readonly string[],
): void {
  const table = db.listTables().find((item) => item.name === tableName);
  if (!table) {
    throw new SqliteParseError(
      `ZCode database schema is missing table: ${tableName}`,
    );
  }
  const missing = names.filter((name) => {
    const pattern = new RegExp(
      `(?:\\(|,)\\s*["\`\\[]?${name}(?:["\`\\]]|\\b)`,
      "i",
    );
    return !pattern.test(table.sql);
  });
  if (missing.length > 0) {
    throw new SqliteParseError(
      `ZCode table ${tableName} is missing column(s): ${missing.join(", ")}`,
    );
  }
}

function requireRowColumns(
  rows: readonly SqliteRow[],
  tableName: string,
  names: readonly string[],
): void {
  const first = rows[0];
  if (!first) return;
  const missing = names.filter((name) => !(name in first));
  if (missing.length > 0) {
    throw new SqliteParseError(
      `ZCode table ${tableName} is missing column(s): ${missing.join(", ")}`,
    );
  }
}

function buildSessionStore(
  allMessages: readonly SqliteRow[],
  allParts: readonly SqliteRow[],
): ZcodeSessionStore {
  const messagesBySession = new Map<string, ZcodeMessageRow[]>();
  for (const row of allMessages) {
    const sessionId = typeof row.session_id === "string" ? row.session_id : "";
    if (!sessionId) continue;
    const data = parseDataJson(row.data) as ZcodeMessageData | null;
    const role = parseDialogueRole(data?.role);
    if (!role) continue;
    const tc = typeof row.time_created === "number" ? row.time_created : 0;
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    const list = messagesBySession.get(sessionId) ?? [];
    list.push({ id, time_created: tc, role });
    messagesBySession.set(sessionId, list);
  }
  for (const list of messagesBySession.values()) {
    list.sort((a, b) => a.time_created - b.time_created);
  }

  const partsByMsg = new Map<string, ZcodePartRow[]>();
  for (const row of allParts) {
    const msgId = typeof row.message_id === "string" ? row.message_id : "";
    if (!msgId) continue;
    const data = parseDataJson(row.data);
    if (!data) continue;
    const tc = typeof row.time_created === "number" ? row.time_created : 0;
    const list = partsByMsg.get(msgId) ?? [];
    list.push({ message_id: msgId, time_created: tc, data });
    partsByMsg.set(msgId, list);
  }
  for (const list of partsByMsg.values()) {
    list.sort((a, b) => a.time_created - b.time_created);
  }

  return { messagesBySession, partsByMsg };
}

/** Search-scoped whole-db store. It is explicitly prepared/released by the
 * orchestrator; one-session extract/context calls never populate it. */
let preparedStore: { dbPath: string; store: ZcodeSessionStore } | null = null;

/** Load a full-db search store for `dbPath`. Returns a degraded empty store
 * when the db is missing/corrupt so callers never crash. */
function loadSessionStore(
  dbPath: string,
  warnings: MemWarning[],
): ZcodeSessionStore {
  if (!fs.existsSync(dbPath)) return emptySessionStore();
  let allMessages: SqliteRow[];
  let allParts: SqliteRow[];
  try {
    const db = openSqliteReadOnly(dbPath);
    try {
      requireTables(db, ["message", "part"]);
      requireTableColumns(db, "message", ["id", "session_id", "data"]);
      requireTableColumns(db, "part", ["message_id", "data"]);
      allMessages = db.scanTable("message");
      allParts = db.scanTable("part");
      requireRowColumns(allMessages, "message", ["id", "session_id", "data"]);
      requireRowColumns(allParts, "part", ["message_id", "data"]);
    } finally {
      db.close();
    }
  } catch (e) {
    if (e instanceof SqliteParseError) {
      pushDbWarning(warnings, dbPath, e);
      return emptySessionStore();
    }
    throw e;
  }
  return buildSessionStore(allMessages, allParts);
}

export function prepareZcodeSessionStore(
  dbPath: string,
  warnings: MemWarning[],
): void {
  preparedStore = { dbPath, store: loadSessionStore(dbPath, warnings) };
}

export function releaseZcodeSessionStore(): void {
  preparedStore = null;
}

/** Read one session with row filtering unless a search-scoped whole-db store
 * has been prepared by the orchestrator. */
function readSessionMessages(
  dbPath: string,
  sessionId: string,
  warnings: MemWarning[],
): { messages: ZcodeMessageRow[]; partsByMsg: Map<string, ZcodePartRow[]> } {
  if (preparedStore?.dbPath === dbPath) {
    return {
      messages: preparedStore.store.messagesBySession.get(sessionId) ?? [],
      partsByMsg: preparedStore.store.partsByMsg,
    };
  }
  if (!fs.existsSync(dbPath)) return { messages: [], partsByMsg: new Map() };

  let store: ZcodeSessionStore;
  try {
    const db = openSqliteReadOnly(dbPath);
    try {
      requireTables(db, ["message", "part"]);
      requireTableColumns(db, "message", ["id", "session_id", "data"]);
      requireTableColumns(db, "part", ["message_id", "data"]);
      const messages = db.scanTable(
        "message",
        (row) => row.session_id === sessionId,
      );
      const messageIds = new Set(
        messages
          .map((row) => row.id)
          .filter((id): id is string => typeof id === "string"),
      );
      const parts = db.scanTable(
        "part",
        (row) =>
          typeof row.message_id === "string" && messageIds.has(row.message_id),
      );
      requireRowColumns(messages, "message", ["id", "session_id", "data"]);
      requireRowColumns(parts, "part", ["message_id", "data"]);
      store = buildSessionStore(messages, parts);
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof SqliteParseError) {
      pushDbWarning(warnings, dbPath, error);
      return { messages: [], partsByMsg: new Map() };
    }
    throw error;
  }
  return {
    messages: store.messagesBySession.get(sessionId) ?? [],
    partsByMsg: store.partsByMsg,
  };
}

interface EffectiveZcodeMessages {
  messages: ZcodeMessageRow[];
  compactSummaryMessageId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCompactionSummaryPart(data: Record<string, unknown>): boolean {
  return (
    data.type === "compaction" &&
    (typeof data.tail_start_id === "string" || isRecord(data.compactBoundary))
  );
}

function compactionMarkerSummaryId(
  data: Record<string, unknown>,
): string | undefined {
  return data.type === "compaction" &&
    data.replace === true &&
    typeof data.summaryMessageId === "string"
    ? data.summaryMessageId
    : undefined;
}

/**
 * ZCode compaction writes two markers:
 * - an assistant marker with `replace: true` and `summaryMessageId`
 * - a summary message carrying text plus a `compaction` part with
 *   `tail_start_id` / `compactBoundary`
 *
 * The effective conversation starts at the latest summary message. Earlier
 * messages were summarized and must not leak into extract/search/phase slicing.
 */
function effectiveMessagesForSession(
  messages: readonly ZcodeMessageRow[],
  partsByMsg: Map<string, ZcodePartRow[]>,
): EffectiveZcodeMessages {
  let startIndex = 0;
  let compactSummaryMessageId: string | undefined;
  const markerSummaryIds = new Set<string>();

  for (const [index, msg] of messages.entries()) {
    if (markerSummaryIds.has(msg.id)) {
      startIndex = index;
      compactSummaryMessageId = msg.id;
    }
    for (const part of partsByMsg.get(msg.id) ?? []) {
      const markerSummaryId = compactionMarkerSummaryId(part.data);
      if (markerSummaryId) markerSummaryIds.add(markerSummaryId);
      if (isCompactionSummaryPart(part.data)) {
        startIndex = index;
        compactSummaryMessageId = msg.id;
        break;
      }
    }
  }

  return {
    messages: messages.slice(startIndex),
    compactSummaryMessageId,
  };
}

function buildTextTurn(
  msg: ZcodeMessageRow,
  parts: readonly ZcodePartRow[],
  compactSummaryMessageId: string | undefined,
): DialogueTurn | null {
  const collected: string[] = [];
  let totalRaw = 0;
  for (const part of parts) {
    const pd = part.data as ZcodePartData;
    if (pd.type !== "text") continue;
    const txt = typeof pd.text === "string" ? pd.text : "";
    if (!txt) continue;
    totalRaw += txt.length;
    collected.push(stripInjectionTags(txt));
  }
  if (!collected.length) return null;

  const merged = collected.join("\n\n");
  const isCompactSummary = msg.id === compactSummaryMessageId;
  if (!isCompactSummary && isBootstrapTurn(merged, totalRaw)) return null;

  const text = isCompactSummary ? `[compact summary]\n${merged}` : merged;
  return text.trim() ? { role: msg.role, text } : null;
}

// ---------- list ----------

export function zcodeListSessions(
  f: MemFilter,
  warnings: MemWarning[] = [],
): MemSessionInfo[] {
  if (!fs.existsSync(ZCODE_DB)) return [];
  let rows: SqliteRow[];
  try {
    const db = openSqliteReadOnly(ZCODE_DB);
    try {
      requireTables(db, ["session"]);
      requireTableColumns(db, "session", [
        "id",
        "directory",
        "time_created",
        "time_updated",
      ]);
      rows = db.scanTable("session");
      requireRowColumns(rows, "session", [
        "id",
        "directory",
        "time_created",
        "time_updated",
      ]);
    } finally {
      db.close();
    }
  } catch (e) {
    if (e instanceof SqliteParseError) {
      pushDbWarning(warnings, ZCODE_DB, e);
      return [];
    }
    throw e;
  }

  const out: MemSessionInfo[] = [];
  for (const row of rows) {
    // `subagent_child` sessions are sub-agent conversations (Explore/research
    // dispatches). Exclude them from the default list — they are noise for
    // daily-review workflows, which care about the user's interactive sessions.
    // They are excluded across list/search/extract; relax this filter if a
    // future workflow needs to inspect sub-agent runs.
    const taskType = typeof row.task_type === "string" ? row.task_type : "";
    if (taskType === "subagent_child") continue;

    const directory =
      typeof row.directory === "string" ? row.directory : undefined;
    if (f.cwd && !sameProject(directory, f.cwd)) continue;

    const created = toIso(row.time_created);
    const updated = toIso(row.time_updated) ?? created;
    if (!inRangeOverlap(created, updated, f)) continue;

    out.push({
      platform: "zcode",
      id: typeof row.id === "string" ? row.id : "",
      title: typeof row.title === "string" ? row.title : undefined,
      cwd: directory,
      created,
      updated,
      filePath: ZCODE_DB,
    });
  }
  return out;
}

function toIso(epochMs: unknown): string | undefined {
  return typeof epochMs === "number" && epochMs > 0
    ? new Date(epochMs).toISOString()
    : undefined;
}

// ---------- extract ----------

/**
 * Build cleaned dialogue turns from a session's messages + parts. Each message
 * is one turn; its text is the concatenation of its `text`-typed parts after
 * injection-tag stripping. Messages with no surviving text are dropped.
 */
export function zcodeExtractDialogue(
  s: MemSessionInfo,
  warnings: MemWarning[] = [],
): DialogueTurn[] {
  const { messages, partsByMsg } = readSessionMessages(
    s.filePath,
    s.id,
    warnings,
  );
  const effective = effectiveMessagesForSession(messages, partsByMsg);
  const turns: DialogueTurn[] = [];

  for (const msg of effective.messages) {
    const parts = partsByMsg.get(msg.id) ?? [];
    const turn = buildTextTurn(msg, parts, effective.compactSummaryMessageId);
    if (turn) turns.push(turn);
  }
  return turns;
}

export function zcodeSearch(
  s: MemSessionInfo,
  kw: string,
  warnings: MemWarning[] = [],
): SearchHit {
  return searchInDialogue(zcodeExtractDialogue(s, warnings), kw);
}

// ---------- phase slicing (task.py boundary detection) ----------

/**
 * Single pass over messages + parts. Emits both the cleaned dialogue turns and
 * the list of `task.py create|start` invocations found in `Bash` tool parts
 * (`{type:"tool", tool:"Bash", state:{input:{command:"..."}}}`). `turnIndex`
 * for each event is the turn count at the time the tool ran.
 *
 * Compaction: ZCode writes a summary message with a `compaction` part carrying
 * `tail_start_id` / `compactBoundary`; earlier messages are replaced by that
 * summary. We slice to the latest summary message before collecting turns and
 * task events, so stale pre-compaction `task.py` boundaries do not leak into
 * phase slicing.
 *
 * turnIndex note (differs slightly from claude/codex): in ZCode a message's
 * text parts and tool parts are siblings within one message. This loop pushes
 * the message's text turn *before* recording its tool events, so a tool event
 * on message M has turnIndex = (turns including M's text). claude/codex
 * instead record the event before pushing the text, so their turnIndex is one
 * less. Both are internally self-consistent for brainstorm-window slicing
 * (create and start use the same convention within a platform), so phase
 * boundaries compute correctly. The ZCode ordering reflects real time order
 * (the assistant writes, then the tool runs). Do not "align" this without also
 * adjusting the test expectations.
 */
export function collectZcodeTurnsAndEvents(
  s: MemSessionInfo,
  warnings: MemWarning[] = [],
): {
  turns: DialogueTurn[];
  events: TaskPyEvent[];
} {
  const { messages, partsByMsg } = readSessionMessages(
    s.filePath,
    s.id,
    warnings,
  );
  const effective = effectiveMessagesForSession(messages, partsByMsg);
  const turns: DialogueTurn[] = [];
  const events: TaskPyEvent[] = [];

  for (const msg of effective.messages) {
    const parts = partsByMsg.get(msg.id) ?? [];
    // First emit any text the message produced (so turnIndex reflects turns
    // accumulated so far before tool events are recorded).
    const turn = buildTextTurn(msg, parts, effective.compactSummaryMessageId);
    if (turn) turns.push(turn);

    // Then scan for Bash tool parts carrying task.py commands.
    for (const part of parts) {
      const pd = part.data as ZcodeToolPart;
      if (pd.type !== "tool") continue;
      if (pd.tool !== "Bash" && pd.tool !== "bash") continue;
      const cmd = pd.state?.input?.command;
      if (typeof cmd !== "string" || !cmd) continue;
      const parsedAll = parseTaskPyCommandsAll(cmd);
      const ts = toIso(part.time_created) ?? "";
      for (const parsed of parsedAll) {
        const ev: TaskPyEvent = {
          action: parsed.action,
          timestamp: ts,
          turnIndex: turns.length,
          ...(parsed.action === "create"
            ? { slug: parsed.slug }
            : { taskDir: parsed.taskDir }),
        };
        events.push(ev);
      }
    }
  }

  return { turns, events };
}

/** Re-exported so callers needing loose shapes can import from one place. */
export type { ZcodeTextPart, ZcodeToolPart };
