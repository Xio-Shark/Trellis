/**
 * Fixture-based tests for the persisted-session adapters.
 *
 * The adapters derive session-store paths from `os.homedir()` at module-load
 * time (`internal/paths.ts`), so `node:os` is mocked via `vi.hoisted` to point
 * `homedir()` at a per-suite tmpdir before any mem module resolves.
 *
 * Migrated from the CLI `mem-platforms` suite when the adapters moved into
 * `@mindfoldhq/trellis-core/mem`.
 */

import {
  describe,
  it,
  expect,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

const { fakeHome, snapshotTestState } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const f = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const o = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require("node:path") as typeof import("node:path");
  const fakeHome = f.mkdtempSync(p.join(o.tmpdir(), "trellis-mem-home-"));
  return {
    fakeHome,
    snapshotTestState: {
      unstablePath: null as string | null,
      mainDbStatReads: 0,
    },
  };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => fakeHome };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    statSync: (...args: Parameters<typeof actual.statSync>) => {
      const stat = actual.statSync(...args);
      if (String(args[0]) !== snapshotTestState.unstablePath) return stat;
      snapshotTestState.mainDbStatReads += 1;
      if (snapshotTestState.mainDbStatReads % 2 !== 0) return stat;

      const changed = Object.create(stat) as typeof stat;
      Object.defineProperty(changed, "mtimeMs", {
        value: stat.mtimeMs + snapshotTestState.mainDbStatReads,
      });
      return changed;
    },
  };
});

const { claudeListSessions, claudeExtractDialogue, claudeSearch } =
  await import("../../src/mem/adapters/claude.js");
const { claudeProjectDirFromCwd } =
  await import("../../src/mem/internal/paths.js");
const { codexListSessions, codexExtractDialogue, codexSearch } =
  await import("../../src/mem/adapters/codex.js");
const { opencodeListSessions, opencodeExtractDialogue, opencodeSearch } =
  await import("../../src/mem/adapters/opencode.js");
const { piListSessions, piExtractDialogue, piSearch } =
  await import("../../src/mem/adapters/pi.js");
const {
  zcodeListSessions,
  zcodeExtractDialogue,
  zcodeSearch,
  collectZcodeTurnsAndEvents,
} = await import("../../src/mem/adapters/zcode.js");
const { ZCODE_DB } = await import("../../src/mem/internal/paths.js");

import type { MemFilter } from "../../src/mem/types.js";

/** Minimal global-scope filter; overrides merge in. */
function mkFilter(overrides: Partial<MemFilter> = {}): MemFilter {
  return { platform: "all", limit: 50, cwd: undefined, ...overrides };
}

// =============================================================================
// shared fixture helpers
// =============================================================================

const CLAUDE_PROJECTS = nodePath.join(fakeHome, ".claude", "projects");
const CODEX_SESSIONS = nodePath.join(fakeHome, ".codex", "sessions");
const PI_SESSIONS = nodePath.join(fakeHome, ".pi", "agent", "sessions");

function writeJsonl(file: string, lines: readonly unknown[]): void {
  nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
  nodeFs.writeFileSync(
    file,
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

function writeJson(file: string, obj: unknown): void {
  nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
  nodeFs.writeFileSync(file, JSON.stringify(obj));
}

function rimraf(p: string): void {
  nodeFs.rmSync(p, { recursive: true, force: true });
}

afterAll(() => {
  rimraf(fakeHome);
});

// =============================================================================
// claudeProjectDirFromCwd — cwd → on-disk dir-name sanitization
//
// Claude replaces every path separator (`/` and Windows `\`), drive colon
// (`:`), `_`, and `.` with `-`. Confirmed empirically against a real
// `~/.claude/projects/` (e.g. `/Users/x/.codex/...` → `-Users-x--codex-...`,
// `snap_note` → `snap-note`). Regression guard for #300: the old `/[/_]/g`
// regex missed `\` and `:`, so Windows cwds resolved to a non-existent dir and
// `mem list --cwd` silently returned 0.
// =============================================================================

describe("claudeProjectDirFromCwd", () => {
  const dirName = (cwd: string): string =>
    nodePath.basename(claudeProjectDirFromCwd(cwd));

  it("sanitizes a POSIX cwd (separators + underscore)", () => {
    expect(dirName("/Users/me/workspace/snap_note")).toBe(
      "-Users-me-workspace-snap-note",
    );
  });

  it("sanitizes a Windows backslash path", () => {
    expect(dirName("D:\\code\\2026\\myapp")).toBe("D--code-2026-myapp");
  });

  it("sanitizes a drive-letter colon", () => {
    expect(dirName("C:\\Users\\me\\repo")).toBe("C--Users-me-repo");
  });

  it("sanitizes underscore and dot in a Windows path", () => {
    expect(dirName("D:\\code\\my_app\\.trellis")).toBe(
      "D--code-my-app--trellis",
    );
  });

  it("sanitizes mixed forward/back separators", () => {
    expect(dirName("D:/code\\2026/my_app")).toBe("D--code-2026-my-app");
  });
});

// =============================================================================
// Claude Code adapter
// =============================================================================

describe("claudeListSessions / claudeExtractDialogue", () => {
  const projectCwd = "/tmp/test-project";
  const encodedCwd = projectCwd.replace(/[/\\:_.]/g, "-");
  const projectDir = nodePath.join(CLAUDE_PROJECTS, encodedCwd);
  const sessionId = "11111111-1111-1111-1111-111111111111";
  const sessionFile = nodePath.join(projectDir, `${sessionId}.jsonl`);

  beforeEach(() => {
    nodeFs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rimraf(CLAUDE_PROJECTS);
  });

  it("returns no sessions when ~/.claude/projects/ doesn't exist", () => {
    rimraf(CLAUDE_PROJECTS);
    expect(claudeListSessions(mkFilter())).toEqual([]);
  });

  it("lists a session and reads cwd/timestamp from the first event when index is missing", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "hello" },
      },
    ]);
    const found = claudeListSessions(mkFilter()).find(
      (s) => s.id === sessionId,
    );
    expect(found).toBeDefined();
    expect(found?.platform).toBe("claude");
    expect(found?.cwd).toBe(projectCwd);
    expect(found?.created).toBe("2026-04-15T10:00:00Z");
  });

  it("merges sessions-index.json metadata (title, cwd, created)", () => {
    writeJsonl(sessionFile, [
      { type: "user", message: { role: "user", content: "hi" } },
    ]);
    writeJson(nodePath.join(projectDir, "sessions-index.json"), {
      entries: [
        {
          id: sessionId,
          cwd: projectCwd,
          created: "2026-04-15T08:00:00Z",
          title: "fixed bug in foo",
        },
      ],
    });
    const found = claudeListSessions(mkFilter()).find(
      (s) => s.id === sessionId,
    );
    expect(found?.title).toBe("fixed bug in foo");
    expect(found?.cwd).toBe(projectCwd);
  });

  it("filters by --since (excludes sessions whose entire lifetime predates the window)", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: "old session" },
      },
    ]);
    const oldT = new Date("2026-01-01T00:00:00Z");
    nodeFs.utimesSync(sessionFile, oldT, oldT);
    const r = claudeListSessions(mkFilter({ since: new Date("2026-04-01") }));
    expect(r.find((s) => s.id === sessionId)).toBeUndefined();
  });

  it("scopes to --cwd by encoding cwd to the on-disk dir name", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "x" },
      },
    ]);
    const otherEncoded = "/tmp/other".replace(/[/\\:_.]/g, "-");
    const otherFile = nodePath.join(
      CLAUDE_PROJECTS,
      otherEncoded,
      "22222222-2222-2222-2222-222222222222.jsonl",
    );
    writeJsonl(otherFile, [
      {
        type: "user",
        cwd: "/tmp/other",
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "x" },
      },
    ]);
    const ids = claudeListSessions(mkFilter({ cwd: projectCwd })).map(
      (s) => s.id,
    );
    expect(ids).toContain(sessionId);
    expect(ids).not.toContain("22222222-2222-2222-2222-222222222222");
  });

  it("falls back to scanning all project dirs when the derived dir name doesn't exist (#300)", () => {
    // Simulate a future Claude naming scheme the derive fn can't reproduce: the
    // on-disk dir name is unrelated to `claudeProjectDirFromCwd(scopedCwd)`, so
    // the fast-path existsSync miss must NOT silently return 0 — the all-dirs
    // scan + per-session `sameProject(cwd, f.cwd)` filter still finds it.
    const scopedCwd = "/srv/projects/some-app";
    const mismatchedDir = nodePath.join(CLAUDE_PROJECTS, "opaque-hash-9f8e7d");
    const scopedFile = nodePath.join(
      mismatchedDir,
      "33333333-3333-3333-3333-333333333333.jsonl",
    );
    writeJsonl(scopedFile, [
      {
        type: "user",
        cwd: scopedCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "scoped session" },
      },
    ]);
    // a session in a different project must still be excluded by the scope
    const otherFile = nodePath.join(
      CLAUDE_PROJECTS,
      "another-opaque-hash",
      "44444444-4444-4444-4444-444444444444.jsonl",
    );
    writeJsonl(otherFile, [
      {
        type: "user",
        cwd: "/srv/projects/other-app",
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "other session" },
      },
    ]);

    // sanity: the derived dir really does not exist on disk
    expect(nodeFs.existsSync(claudeProjectDirFromCwd(scopedCwd))).toBe(false);

    const ids = claudeListSessions(mkFilter({ cwd: scopedCwd })).map(
      (s) => s.id,
    );
    expect(ids).toContain("33333333-3333-3333-3333-333333333333");
    expect(ids).not.toContain("44444444-4444-4444-4444-444444444444");
  });

  it("extractDialogue keeps user/assistant text turns and strips injection tags", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: {
          role: "user",
          content:
            "real question<system-reminder>secret</system-reminder> here",
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", text: "thinking aloud" },
            { type: "text", text: "real answer" },
            { type: "tool_use", input: { foo: 1 } },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "out" }],
        },
      },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const turns = claudeExtractDialogue(s);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: "user", text: "real question here" });
    expect(turns[1]).toEqual({ role: "assistant", text: "real answer" });
  });

  it("extractDialogue collapses pre-compact turns into a single [compact summary] turn", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "first turn" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "first answer" }],
        },
      },
      {
        type: "user",
        isCompactSummary: true,
        message: {
          role: "user",
          content: "summary of the previous conversation",
        },
      },
      {
        type: "user",
        message: { role: "user", content: "post-compact question" },
      },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const turns = claudeExtractDialogue(s);
    expect(turns.map((t) => t.text)).toEqual([
      "[compact summary]\nsummary of the previous conversation",
      "post-compact question",
    ]);
  });

  it("drops AGENTS.md preamble turns from the user side", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: {
          role: "user",
          content: "# AGENTS.md instructions for /repo - rules go here",
        },
      },
      {
        type: "user",
        message: { role: "user", content: "actual user question" },
      },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(claudeExtractDialogue(s).map((t) => t.text)).toEqual([
      "actual user question",
    ]);
  });

  it("returns empty turns array for a session with no parseable content", () => {
    writeJsonl(sessionFile, [
      { type: "user", cwd: projectCwd, timestamp: "2026-04-15T10:00:00Z" },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(claudeExtractDialogue(s)).toEqual([]);
  });

  it("claudeSearch counts keyword occurrences across user + assistant turns", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "memory leak in heap" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "the memory subsystem allocates" }],
        },
      },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const hit = claudeSearch(s, "memory");
    expect(hit.userCount).toBe(1);
    expect(hit.asstCount).toBe(1);
    expect(hit.count).toBe(2);
  });
});

// =============================================================================
// Codex adapter
// =============================================================================

describe("codexListSessions / codexExtractDialogue", () => {
  const sessionId = "abc-codex-session";
  const projectCwd = "/tmp/codex-project";
  const fileName = `rollout-2026-04-15T10-00-00-${sessionId}.jsonl`;
  const sessionFile = nodePath.join(
    CODEX_SESSIONS,
    "2026",
    "04",
    "15",
    fileName,
  );

  beforeEach(() => {
    nodeFs.mkdirSync(nodePath.dirname(sessionFile), { recursive: true });
  });

  afterEach(() => {
    rimraf(CODEX_SESSIONS);
  });

  it("returns no sessions when ~/.codex/sessions/ doesn't exist", () => {
    rimraf(CODEX_SESSIONS);
    expect(codexListSessions(mkFilter())).toEqual([]);
  });

  it("lists sessions, picking up cwd from the first payload", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        type: "session_meta",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        type: "event_msg",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    expect(s?.platform).toBe("codex");
    expect(s?.cwd).toBe(projectCwd);
  });

  it("filters codex sessions by --cwd", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
    ]);
    const otherFile = nodePath.join(
      CODEX_SESSIONS,
      "2026",
      "04",
      "15",
      `rollout-2026-04-15T11-00-00-other.jsonl`,
    );
    writeJsonl(otherFile, [
      {
        timestamp: "2026-04-15T11:00:00Z",
        payload: { id: "other", cwd: "/elsewhere" },
      },
    ]);
    const ids = codexListSessions(mkFilter({ cwd: projectCwd })).map(
      (s) => s.id,
    );
    expect(ids).toContain(sessionId);
    expect(ids).not.toContain("other");
  });

  it("extractDialogue keeps user/assistant messages, drops developer/system", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "system prompt" }],
        },
      },
      {
        timestamp: "2026-04-15T10:00:02Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello world" }],
        },
      },
      {
        timestamp: "2026-04-15T10:00:03Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hi back" }],
        },
      },
      {
        timestamp: "2026-04-15T10:00:04Z",
        payload: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: "should be dropped" }],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(codexExtractDialogue(s)).toEqual([
      { role: "user", text: "hello world" },
      { role: "assistant", text: "hi back" },
    ]);
  });

  it("extractDialogue strips injection tags from inlined preamble content", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "real question<workflow-state>x</workflow-state> trailing",
            },
          ],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(codexExtractDialogue(s)).toEqual([
      { role: "user", text: "real question trailing" },
    ]);
  });

  it("extractDialogue rebuilds turn list from a `compacted` event's replacement_history", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "pre-compact turn" }],
        },
      },
      {
        timestamp: "2026-04-15T10:00:02Z",
        type: "compacted",
        payload: {
          replacement_history: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "summary of earlier" }],
            },
          ],
        },
      },
      {
        timestamp: "2026-04-15T10:00:03Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "post-compact turn" }],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(codexExtractDialogue(s).map((t) => t.text)).toEqual([
      "[compact]\nsummary of earlier",
      "post-compact turn",
    ]);
  });

  it("extractDialogue drops bootstrap (large INSTRUCTIONS) user turn", () => {
    const huge = "<INSTRUCTIONS>\n" + "x".repeat(5000) + "\n</INSTRUCTIONS>";
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: huge }],
        },
      },
      {
        timestamp: "2026-04-15T10:00:02Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "real question" }],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(codexExtractDialogue(s)).toEqual([
      { role: "user", text: "real question" },
    ]);
  });

  it("codexSearch returns SearchHit with correct counts", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "memory leak in heap" }],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const hit = codexSearch(s, "memory");
    expect(hit.userCount).toBe(1);
    expect(hit.count).toBe(1);
  });
});

// =============================================================================
// Pi adapter
// =============================================================================

function piProjectDir(cwd: string): string {
  const safe = `--${nodePath
    .resolve(cwd)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;
  return nodePath.join(PI_SESSIONS, safe);
}

describe("piListSessions / piExtractDialogue", () => {
  const projectCwd = "/tmp/pi-project";
  const projectDir = piProjectDir(projectCwd);
  const sessionId = "018f0000-pi-session";
  const sessionFile = nodePath.join(
    projectDir,
    `2026-06-18_${sessionId}.jsonl`,
  );

  afterEach(() => {
    rimraf(nodePath.join(fakeHome, ".pi"));
    rimraf(nodePath.join(fakeHome, ".pi-custom-sessions"));
  });

  it("returns no sessions when the Pi sessions root doesn't exist", () => {
    rimraf(PI_SESSIONS);
    expect(piListSessions(mkFilter())).toEqual([]);
  });

  it("lists metadata and uses the latest session_info.name as title", () => {
    writeJsonl(sessionFile, [
      {
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-06-18T10:00:00.000Z",
        cwd: projectCwd,
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-06-18T10:00:01.000Z",
        message: { role: "user", content: "hello pi" },
      },
      {
        type: "session_info",
        id: "n1",
        parentId: "u1",
        timestamp: "2026-06-18T10:00:02.000Z",
        name: "Pi memory task",
      },
    ]);

    const found = piListSessions(mkFilter({ cwd: projectCwd })).find(
      (s) => s.id === sessionId,
    );
    expect(found).toBeDefined();
    expect(found?.platform).toBe("pi");
    expect(found?.cwd).toBe(projectCwd);
    expect(found?.created).toBe("2026-06-18T10:00:00.000Z");
    expect(found?.title).toBe("Pi memory task");
  });

  it("lists sessions from settings-configured custom session roots", () => {
    const customRoot = nodePath.join(fakeHome, ".pi-custom-sessions");
    const customFile = nodePath.join(
      customRoot,
      `2026-06-18_${sessionId}.jsonl`,
    );
    writeJson(nodePath.join(fakeHome, ".pi", "agent", "settings.json"), {
      sessionDir: customRoot,
    });
    writeJsonl(customFile, [
      {
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-06-18T10:00:00.000Z",
        cwd: projectCwd,
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-06-18T10:00:01.000Z",
        message: { role: "user", content: "custom root" },
      },
    ]);

    const found = piListSessions(mkFilter({ cwd: projectCwd })).find(
      (s) => s.id === sessionId,
    );
    expect(found?.filePath).toBe(customFile);
  });

  it("extractDialogue keeps cleaned user/assistant text and drops tools, output, thinking, and images", () => {
    writeJsonl(sessionFile, [
      {
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-06-18T10:00:00.000Z",
        cwd: projectCwd,
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-06-18T10:00:01.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "real question<workflow>x</workflow>" },
            { type: "image", data: "base64", mimeType: "image/png" },
          ],
        },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-06-18T10:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: "real answer" },
            {
              type: "toolCall",
              name: "bash",
              arguments: { command: "echo x" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "b1",
        parentId: "a1",
        timestamp: "2026-06-18T10:00:03.000Z",
        message: {
          role: "bashExecution",
          command: "echo x",
          output: "secret output",
        },
      },
      {
        type: "message",
        id: "t1",
        parentId: "b1",
        timestamp: "2026-06-18T10:00:04.000Z",
        message: {
          role: "toolResult",
          content: [{ type: "text", text: "tool result" }],
        },
      },
    ]);

    const s = piListSessions(mkFilter({ cwd: projectCwd })).find(
      (x) => x.id === sessionId,
    );
    expect(s).toBeDefined();
    if (!s) return;
    expect(piExtractDialogue(s)).toEqual([
      { role: "user", text: "real question" },
      { role: "assistant", text: "real answer" },
    ]);
  });

  it("extractDialogue follows only the active branch and excludes abandoned branch text", () => {
    writeJsonl(sessionFile, [
      {
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-06-18T10:00:00.000Z",
        cwd: projectCwd,
      },
      {
        type: "message",
        id: "root",
        parentId: null,
        timestamp: "2026-06-18T10:00:01.000Z",
        message: { role: "user", content: "root prompt" },
      },
      {
        type: "message",
        id: "abandoned",
        parentId: "root",
        timestamp: "2026-06-18T10:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "abandoned-only text" }],
        },
      },
      {
        type: "branch_summary",
        id: "summary",
        parentId: "root",
        timestamp: "2026-06-18T10:00:03.000Z",
        fromId: "abandoned",
        summary: "summary of abandoned branch",
      },
      {
        type: "message",
        id: "active",
        parentId: "summary",
        timestamp: "2026-06-18T10:00:04.000Z",
        message: { role: "user", content: "active branch" },
      },
    ]);

    const s = piListSessions(mkFilter({ cwd: projectCwd })).find(
      (x) => x.id === sessionId,
    );
    expect(s).toBeDefined();
    if (!s) return;
    expect(piExtractDialogue(s).map((t) => t.text)).toEqual([
      "root prompt",
      "[branch summary]\nsummary of abandoned branch",
      "active branch",
    ]);
    expect(piSearch(s, "abandoned-only").count).toBe(0);
  });

  it("compaction emits summary first and excludes discarded pre-compaction dialogue", () => {
    writeJsonl(sessionFile, [
      {
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-06-18T10:00:00.000Z",
        cwd: projectCwd,
      },
      {
        type: "message",
        id: "drop",
        parentId: null,
        timestamp: "2026-06-18T10:00:01.000Z",
        message: { role: "user", content: "discarded pre compact secret" },
      },
      {
        type: "message",
        id: "keep",
        parentId: "drop",
        timestamp: "2026-06-18T10:00:02.000Z",
        message: { role: "user", content: "kept context" },
      },
      {
        type: "compaction",
        id: "compact",
        parentId: "keep",
        timestamp: "2026-06-18T10:00:03.000Z",
        summary: "compact summary",
        firstKeptEntryId: "keep",
        tokensBefore: 100,
      },
      {
        type: "message",
        id: "after",
        parentId: "compact",
        timestamp: "2026-06-18T10:00:04.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "post compact answer" }],
        },
      },
    ]);

    const s = piListSessions(mkFilter({ cwd: projectCwd })).find(
      (x) => x.id === sessionId,
    );
    expect(s).toBeDefined();
    if (!s) return;
    expect(piExtractDialogue(s).map((t) => t.text)).toEqual([
      "[compact summary]\ncompact summary",
      "kept context",
      "post compact answer",
    ]);
    expect(piSearch(s, "discarded").count).toBe(0);
  });
});

// =============================================================================
// OpenCode adapter (degraded — silent no-op; the "unavailable" notice is a CLI
// presentation concern, see packages/cli/src/commands/mem.ts).
// =============================================================================

describe("opencode adapter (degraded no-op)", () => {
  it("opencodeListSessions returns []", () => {
    expect(opencodeListSessions(mkFilter())).toEqual([]);
  });

  it("opencodeExtractDialogue returns [] for any session", () => {
    expect(
      opencodeExtractDialogue({
        platform: "opencode",
        id: "ses_x",
        filePath: "/tmp/opencode.db",
      }),
    ).toEqual([]);
  });

  it("opencodeSearch returns an empty hit", () => {
    const hit = opencodeSearch("anything");
    expect(hit.count).toBe(0);
    expect(hit.totalTurns).toBe(0);
  });
});

// =============================================================================
// ZCode adapter — reads from `~/.zcode/cli/db/db.sqlite` via the zero-dependency
// SQLite parser. Fixtures are built with the system python sqlite3 module; the
// whole block is skipped when no python interpreter is available so CI without
// python does not regress.
// =============================================================================

/** Detect a python launcher with the sqlite3 stdlib module. */
function findPythonForZcode(): string[] | null {
  const { execFileSync } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:child_process") as typeof import("node:child_process");
  const candidates =
    process.platform === "win32" ? ["py", "python"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ["-c", "import sqlite3"], { stdio: "ignore" });
      return [cmd];
    } catch {
      /* next */
    }
  }
  return null;
}

const ZCODE_PY = findPythonForZcode();

/** Build a ZCode-shaped SQLite db at ZCODE_DB with session/message/part rows.
 * Columns are kept to the subset the adapter reads. */
function buildZcodeDb(opts: {
  sessions?: {
    id: string;
    title?: string;
    directory?: string;
    time_created?: number;
    time_updated?: number;
  }[];
  messages?: {
    id: string;
    session_id: string;
    time_created: number;
    role: string;
  }[];
  parts?: {
    message_id: string;
    time_created: number;
    data: Record<string, unknown>;
  }[];
}): void {
  if (!ZCODE_PY || ZCODE_PY.length === 0) throw new Error("python unavailable");
  const pyCmd = ZCODE_PY[0];
  if (!pyCmd) throw new Error("python unavailable");
  const { execFileSync } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:child_process") as typeof import("node:child_process");
  nodeFs.mkdirSync(nodePath.dirname(ZCODE_DB), { recursive: true });
  const payload = JSON.stringify(opts);
  const script = `
import sqlite3, json, os
os.makedirs(os.path.dirname(${JSON.stringify(ZCODE_DB)}), exist_ok=True)
if os.path.exists(${JSON.stringify(ZCODE_DB)}):
    os.remove(${JSON.stringify(ZCODE_DB)})
db = sqlite3.connect(${JSON.stringify(ZCODE_DB)})
db.execute("CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER)")
db.execute("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)")
db.execute("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)")
spec = json.loads(${JSON.stringify(payload)})
message_sessions = {m["id"]: m["session_id"] for m in spec.get("messages", [])}
for s in spec.get("sessions", []):
    db.execute("INSERT INTO session (id,title,directory,time_created,time_updated) VALUES (?,?,?,?,?)",
               (s["id"], s.get("title"), s.get("directory"), s.get("time_created", 1000), s.get("time_updated", 2000)))
for m in spec.get("messages", []):
    data = json.dumps({"role": m["role"]})
    db.execute("INSERT INTO message (id,session_id,time_created,data) VALUES (?,?,?,?)",
               (m["id"], m["session_id"], m["time_created"], data))
for i, p in enumerate(spec.get("parts", [])):
    pid = f"part_{i}_{p['message_id']}"
    db.execute("INSERT INTO part (id,message_id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?,?)",
               (pid, p["message_id"], message_sessions.get(p["message_id"], ""), p["time_created"], p["time_created"], json.dumps(p["data"])))
db.commit()
db.close()
`;
  execFileSync(pyCmd, ["-c", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function rimrafZcodeDb(): void {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      nodeFs.rmSync(ZCODE_DB + ext, { force: true });
    } catch {
      /* ignore */
    }
  }
}

describe.skipIf(!ZCODE_PY)("zcodeListSessions / zcodeExtractDialogue", () => {
  beforeEach(() => rimrafZcodeDb());
  afterEach(() => rimrafZcodeDb());

  it("returns [] when the db is absent", () => {
    expect(zcodeListSessions(mkFilter())).toEqual([]);
  });

  it("lists sessions with id/title/cwd from the session table", () => {
    buildZcodeDb({
      sessions: [
        {
          id: "sess_a",
          title: "hello",
          directory: "/proj/a",
          time_created: 1000,
          time_updated: 2000,
        },
        {
          id: "sess_b",
          title: "world",
          directory: "/proj/b",
          time_created: 3000,
          time_updated: 4000,
        },
      ],
    });
    const rows = zcodeListSessions(mkFilter({ cwd: undefined }));
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.id === "sess_a");
    expect(a?.title).toBe("hello");
    expect(a?.cwd).toBe("/proj/a");
    expect(a?.platform).toBe("zcode");
  });

  it("filters by --cwd (sameProject)", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/proj/a", time_created: 1, time_updated: 2 },
        { id: "s2", directory: "/proj/b", time_created: 1, time_updated: 2 },
      ],
    });
    const rows = zcodeListSessions(
      mkFilter({ cwd: "/proj/a", platform: "zcode" }),
    );
    expect(rows.map((r) => r.id)).toEqual(["s1"]);
  });

  it("extracts user/assistant text from parts, skipping non-text types", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "user" },
        { id: "m2", session_id: "s1", time_created: 20, role: "assistant" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: { type: "text", text: "hi there" },
        },
        {
          message_id: "m1",
          time_created: 11,
          data: { type: "reasoning", text: "ignored" },
        },
        {
          message_id: "m2",
          time_created: 20,
          data: { type: "text", text: "hello back" },
        },
      ],
    });
    const turns = zcodeExtractDialogue({
      platform: "zcode",
      id: "s1",
      filePath: ZCODE_DB,
    });
    expect(turns).toEqual([
      { role: "user", text: "hi there" },
      { role: "assistant", text: "hello back" },
    ]);
  });

  it("strips injection tags from extracted text", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "user" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: {
            type: "text",
            text: "real question<workflow-state>x</workflow-state> trailing",
          },
        },
      ],
    });
    const turns = zcodeExtractDialogue({
      platform: "zcode",
      id: "s1",
      filePath: ZCODE_DB,
    });
    expect(turns[0]?.text).toBe("real question trailing");
  });

  it("detects task.py create/start commands in Bash tool parts", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "user" },
        { id: "m2", session_id: "s1", time_created: 20, role: "assistant" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: { type: "text", text: "go" },
        },
        {
          message_id: "m2",
          time_created: 20,
          data: {
            type: "tool",
            tool: "Bash",
            state: {
              input: {
                command:
                  'py ./.trellis/scripts/task.py create "my task" --slug my-task',
              },
            },
          },
        },
        {
          message_id: "m2",
          time_created: 21,
          data: {
            type: "tool",
            tool: "Bash",
            state: {
              input: {
                command:
                  "py ./.trellis/scripts/task.py start .trellis/tasks/01-01-my-task",
              },
            },
          },
        },
      ],
    });
    const { events, turns } = collectZcodeTurnsAndEvents({
      platform: "zcode",
      id: "s1",
      filePath: ZCODE_DB,
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.action).toBe("create");
    expect(events[0]?.slug).toBe("my-task");
    expect(events[1]?.action).toBe("start");
    expect(events[1]?.taskDir).toContain("my-task");
    // turnIndex is the turn count at the time the tool ran. m1 ("go") was
    // pushed as turn 0, so both tool events on m2 (which has no text) fire at
    // turnIndex=1. This locks the ZCode turnIndex semantics documented in
    // zcode.ts (text-then-tool within a message).
    expect(events[0]?.turnIndex).toBe(1);
    expect(events[1]?.turnIndex).toBe(1);
    expect(turns).toEqual([{ role: "user", text: "go" }]);
  });

  it("drops bootstrap turns (large INSTRUCTIONS block)", () => {
    // isBootstrapTurn: >4000 chars and starts with <INSTRUCTIONS> → dropped.
    const huge = "<INSTRUCTIONS>" + "x".repeat(4500);
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "user" },
        { id: "m2", session_id: "s1", time_created: 20, role: "assistant" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: { type: "text", text: huge },
        },
        {
          message_id: "m2",
          time_created: 20,
          data: { type: "text", text: "real reply" },
        },
      ],
    });
    const turns = zcodeExtractDialogue({
      platform: "zcode",
      id: "s1",
      filePath: ZCODE_DB,
    });
    // The bootstrap user turn is dropped; only the assistant reply survives.
    expect(turns).toEqual([{ role: "assistant", text: "real reply" }]);
  });

  it("joins multiple text parts of one message with blank-line separator", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "assistant" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: { type: "text", text: "first" },
        },
        {
          message_id: "m1",
          time_created: 11,
          data: { type: "text", text: "second" },
        },
      ],
    });
    const turns = zcodeExtractDialogue({
      platform: "zcode",
      id: "s1",
      filePath: ZCODE_DB,
    });
    expect(turns).toEqual([{ role: "assistant", text: "first\n\nsecond" }]);
  });

  it("uses the latest compaction summary and drops pre-compaction turns/events", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m_old", session_id: "s1", time_created: 10, role: "user" },
        {
          id: "m_old_tool",
          session_id: "s1",
          time_created: 20,
          role: "assistant",
        },
        {
          id: "m_marker",
          session_id: "s1",
          time_created: 30,
          role: "assistant",
        },
        { id: "m_summary", session_id: "s1", time_created: 40, role: "user" },
        {
          id: "m_after",
          session_id: "s1",
          time_created: 50,
          role: "assistant",
        },
        {
          id: "m_after_tool",
          session_id: "s1",
          time_created: 60,
          role: "assistant",
        },
      ],
      parts: [
        {
          message_id: "m_old",
          time_created: 10,
          data: { type: "text", text: "old-secret should disappear" },
        },
        {
          message_id: "m_old_tool",
          time_created: 20,
          data: {
            type: "tool",
            tool: "Bash",
            state: {
              input: {
                command:
                  'py ./.trellis/scripts/task.py create "old task" --slug old-task',
              },
            },
          },
        },
        {
          message_id: "m_marker",
          time_created: 30,
          data: {
            type: "compaction",
            replace: true,
            summaryMessageId: "m_summary",
          },
        },
        {
          message_id: "m_summary",
          time_created: 40,
          data: { type: "text", text: "summary of earlier work" },
        },
        {
          message_id: "m_summary",
          time_created: 41,
          data: {
            type: "compaction",
            tail_start_id: "m_old_tool",
            compactBoundary: {
              keptMessageCount: 0,
              lastSummarizedMessageId: "m_old_tool",
              summaryMessageIds: ["m_summary"],
            },
          },
        },
        {
          message_id: "m_after",
          time_created: 50,
          data: { type: "text", text: "after compact retained" },
        },
        {
          message_id: "m_after_tool",
          time_created: 60,
          data: {
            type: "tool",
            tool: "Bash",
            state: {
              input: {
                command:
                  "py ./.trellis/scripts/task.py start .trellis/tasks/01-01-new-task",
              },
            },
          },
        },
      ],
    });

    const session = {
      platform: "zcode" as const,
      id: "s1",
      filePath: ZCODE_DB,
    };
    expect(zcodeExtractDialogue(session)).toEqual([
      { role: "user", text: "[compact summary]\nsummary of earlier work" },
      { role: "assistant", text: "after compact retained" },
    ]);
    expect(zcodeSearch(session, "old-secret").count).toBe(0);

    const { events, turns } = collectZcodeTurnsAndEvents(session);
    expect(turns.map((t) => t.text)).toEqual([
      "[compact summary]\nsummary of earlier work",
      "after compact retained",
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("start");
    expect(events[0]?.taskDir).toContain("new-task");
    expect(events[0]?.turnIndex).toBe(2);
  });

  it("degrades to [] when the db file is corrupt", () => {
    // Write a non-SQLite file at ZCODE_DB so openSqliteReadOnly throws.
    nodeFs.mkdirSync(nodePath.dirname(ZCODE_DB), { recursive: true });
    nodeFs.writeFileSync(ZCODE_DB, "not a sqlite file");
    // list and extract both catch SqliteParseError → [] (not throw).
    const warnings: { code: string; message: string }[] = [];
    expect(zcodeListSessions(mkFilter({ cwd: undefined }), warnings)).toEqual(
      [],
    );
    const turns = zcodeExtractDialogue(
      {
        platform: "zcode",
        id: "anything",
        filePath: ZCODE_DB,
      },
      warnings,
    );
    expect(turns).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("zcode-db-unreadable");
  });

  it("fails closed with a retry warning when the snapshot stays unstable", () => {
    buildZcodeDb({
      sessions: [
        {
          id: "unstable-1",
          title: "unstable",
          directory: "/project",
          time_created: 1,
          time_updated: 2,
        },
      ],
    });
    try {
      snapshotTestState.unstablePath = ZCODE_DB;
      snapshotTestState.mainDbStatReads = 0;
      const warnings: { code: string; message: string }[] = [];
      expect(zcodeListSessions(mkFilter({ cwd: undefined }), warnings)).toEqual(
        [],
      );
      expect(warnings).toEqual([
        {
          code: "zcode-db-snapshot-unstable",
          message: `ZCode 正在写入，请重试。 (${ZCODE_DB})`,
        },
      ]);
    } finally {
      snapshotTestState.unstablePath = null;
    }
  });

  it("warns when the ZCode schema drops a required column", () => {
    buildZcodeDb({
      sessions: [
        {
          id: "schema-1",
          title: "schema drift",
          directory: "/project",
          time_created: 1,
          time_updated: 2,
        },
      ],
    });
    const pyCmd = ZCODE_PY && ZCODE_PY[0];
    if (!pyCmd) throw new Error("python unavailable");
    const { execFileSync } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:child_process") as typeof import("node:child_process");
    execFileSync(
      pyCmd,
      [
        "-c",
        `import sqlite3; db=sqlite3.connect(${JSON.stringify(ZCODE_DB)}); db.execute('ALTER TABLE session RENAME COLUMN directory TO project_dir'); db.commit(); db.close()`,
      ],
      { stdio: "ignore" },
    );

    const warnings: { code: string; message: string }[] = [];
    expect(zcodeListSessions(mkFilter({ cwd: undefined }), warnings)).toEqual(
      [],
    );
    expect(warnings[0]?.code).toBe("zcode-db-unreadable");
    expect(warnings[0]?.message).toContain("directory");
  });

  it("excludes subagent_child sessions from list", () => {
    // The buildZcodeDb helper writes a session table without task_type; this
    // test needs that column, so build the fixture with a custom python pass.
    const { execFileSync } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:child_process") as typeof import("node:child_process");
    const pyCmd = ZCODE_PY && ZCODE_PY[0];
    if (!pyCmd) throw new Error("python unavailable");
    nodeFs.mkdirSync(nodePath.dirname(ZCODE_DB), { recursive: true });
    const script = `
import sqlite3, os
if os.path.exists(${JSON.stringify(ZCODE_DB)}):
    os.remove(${JSON.stringify(ZCODE_DB)})
db = sqlite3.connect(${JSON.stringify(ZCODE_DB)})
db.execute("CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT)")
db.execute("INSERT INTO session (id,title,directory,time_created,time_updated,task_type) VALUES (?,?,?,?,?,?)",
           ("interactive-1", "main chat", "/p", 1, 2, "interactive"))
db.execute("INSERT INTO session (id,title,directory,time_created,time_updated,task_type) VALUES (?,?,?,?,?,?)",
           ("child-1", "subagent", "/p", 1, 2, "subagent_child"))
db.commit()
db.close()
`;
    const pyDir = nodeFs.mkdtempSync(
      nodePath.join(nodePath.dirname(ZCODE_DB), "py-zc-"),
    );
    const pyFile = nodePath.join(pyDir, "b.py");
    nodeFs.writeFileSync(pyFile, script);
    try {
      execFileSync(pyCmd, [pyFile], { stdio: "ignore" });
    } finally {
      nodeFs.rmSync(pyDir, { recursive: true, force: true });
    }
    const rows = zcodeListSessions(mkFilter({ cwd: undefined }));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("interactive-1");
    expect(ids).not.toContain("child-1");
  });

  it("search counts user/assistant occurrences", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "user" },
        { id: "m2", session_id: "s1", time_created: 20, role: "assistant" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: { type: "text", text: "find the hook bug" },
        },
        {
          message_id: "m2",
          time_created: 20,
          data: { type: "text", text: "the hook is here" },
        },
      ],
    });
    const hit = zcodeSearch(
      { platform: "zcode", id: "s1", filePath: ZCODE_DB },
      "hook",
    );
    expect(hit.count).toBeGreaterThanOrEqual(2);
    expect(hit.userCount).toBe(1);
    expect(hit.asstCount).toBe(1);
  });
});
