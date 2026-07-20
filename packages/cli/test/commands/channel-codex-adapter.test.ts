import { describe, expect, it } from "vitest";

import {
  buildCodexThreadStartParams,
  createCodexCtx,
  parseCodexLine,
  parseCodexSandboxMode,
} from "../../src/commands/channel/adapters/codex.js";

function parse(line: Record<string, unknown>, ctx = createCodexCtx()) {
  return parseCodexLine(JSON.stringify(line), ctx);
}

describe("Codex channel adapter", () => {
  it("classifies streamed commentary deltas by item phase", () => {
    const ctx = createCodexCtx();
    parse(
      {
        method: "item/started",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_commentary",
            text: "",
            phase: "commentary",
          },
        },
      },
      ctx,
    );

    const result = parse(
      {
        method: "item/agentMessage/delta",
        params: {
          itemId: "msg_commentary",
          delta: "checking context",
        },
      },
      ctx,
    );

    expect(result.events).toEqual([
      {
        kind: "progress",
        payload: {
          detail: {
            kind: "commentary",
            phase: "commentary",
            stream_id: "msg_commentary",
            text_delta: "checking context",
          },
        },
      },
    ]);
  });

  it("adds stream ids to interleaved output deltas", () => {
    const ctx = createCodexCtx();
    parse(
      {
        method: "item/started",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_final",
            text: "",
            phase: "final_answer",
          },
        },
      },
      ctx,
    );
    parse(
      {
        method: "item/started",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_commentary",
            text: "",
            phase: "commentary",
          },
        },
      },
      ctx,
    );

    const output = parse(
      {
        method: "item/agentMessage/delta",
        params: { itemId: "msg_final", delta: "final " },
      },
      ctx,
    );
    const commentary = parse(
      {
        method: "item/agentMessage/delta",
        params: { itemId: "msg_commentary", delta: "note " },
      },
      ctx,
    );

    expect(output.events[0]).toMatchObject({
      kind: "progress",
      payload: {
        detail: {
          kind: "output",
          phase: "final_answer",
          stream_id: "msg_final",
          text_delta: "final ",
        },
      },
    });
    expect(commentary.events[0]).toMatchObject({
      kind: "progress",
      payload: {
        detail: {
          kind: "commentary",
          phase: "commentary",
          stream_id: "msg_commentary",
          text_delta: "note ",
        },
      },
    });
  });

  it("keeps unclassified deltas backward compatible while adding stream metadata", () => {
    const result = parse({
      method: "item/agentMessage/delta",
      params: { itemId: "msg_unknown", delta: "hello" },
    });

    expect(result.events).toEqual([
      {
        kind: "progress",
        payload: {
          detail: {
            kind: "output",
            stream_id: "msg_unknown",
            text_delta: "hello",
          },
        },
      },
    ]);
  });

  it("emits done after the final answer when turn/completed arrives first", () => {
    const ctx = createCodexCtx();
    const completed = parse({ method: "turn/completed", params: {} }, ctx);
    expect(completed.events).toEqual([]);

    const final = parse(
      {
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_final",
            text: "DONE",
            phase: "final_answer",
          },
        },
      },
      ctx,
    );

    expect(final.events).toEqual([
      {
        kind: "message",
        payload: { text: "DONE" },
      },
      { kind: "done", payload: {} },
    ]);
  });

  it("emits done immediately when turn/completed arrives after the final answer", () => {
    const ctx = createCodexCtx();
    parse(
      {
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_final",
            text: "DONE",
            phase: "final_answer",
          },
        },
      },
      ctx,
    );

    const completed = parse({ method: "turn/completed", params: {} }, ctx);
    expect(completed.events).toEqual([{ kind: "done", payload: {} }]);
  });

  describe("sandbox override (#413)", () => {
    it("defaults to workspace-write when no sandbox is given", () => {
      const params = buildCodexThreadStartParams("/tmp/proj");
      expect(params.sandbox).toBe("workspace-write");
    });

    it("overrides the sandbox mode when provided", () => {
      const params = buildCodexThreadStartParams(
        "/tmp/proj",
        undefined,
        "danger-full-access",
      );
      expect(params.sandbox).toBe("danger-full-access");
      expect(params.approvalPolicy).toBe("never");
    });

    it("parseCodexSandboxMode accepts documented modes", () => {
      expect(parseCodexSandboxMode(undefined)).toBeUndefined();
      expect(parseCodexSandboxMode("read-only")).toBe("read-only");
      expect(parseCodexSandboxMode("workspace-write")).toBe(
        "workspace-write",
      );
      expect(parseCodexSandboxMode("danger-full-access")).toBe(
        "danger-full-access",
      );
    });

    it("parseCodexSandboxMode rejects unknown values", () => {
      expect(() => parseCodexSandboxMode("yolo")).toThrow(
        /Invalid --sandbox 'yolo'/,
      );
    });
  });
});
