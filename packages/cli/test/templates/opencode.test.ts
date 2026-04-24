import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contextCollector } from "../../src/templates/opencode/lib/trellis-context.js";
import {
  buildSessionContext,
  hasInjectedTrellisContext,
} from "../../src/templates/opencode/plugins/session-start.js";

interface TestContextCollector {
  processed: Set<string>;
  markProcessed(directory: string, sessionID: string): void;
  isProcessed(directory: string, sessionID: string): boolean;
  clear(directory: string, sessionID: string): void;
}

describe("opencode session context dedupe", () => {
  let collector: TestContextCollector;

  beforeEach((): void => {
    collector = contextCollector as TestContextCollector;
  });

  afterEach((): void => {
    collector.clear("session-a");
    collector.clear("session-b");
    collector.processed.clear();
  });

  it("tracks processed sessions in memory for the active process", () => {
    expect(collector.isProcessed("session-a")).toBe(false);

    collector.markProcessed("session-a");
    expect(collector.isProcessed("session-a")).toBe(true);

    collector.clear("session-a");

    expect(collector.isProcessed("session-a")).toBe(false);
  });

  it("does not treat a different session id as already processed", () => {
    collector.markProcessed("session-a");

    expect(collector.isProcessed("session-b")).toBe(false);
  });
});

describe("opencode session-start history detection", () => {
  it("includes the one-shot first-reply notice in injected context", () => {
    const context = buildSessionContext({
      directory: "/tmp/trellis-opencode-test",
      getCurrentTask: () => null,
      readFile: () => "",
      readProjectFile: () => "",
      resolveTaskDir: () => null,
      runScript: () => "",
    });

    expect(context).toContain("<first-reply-notice>");
    expect(context).toContain(
      "Trellis SessionStart 已注入：workflow、当前任务状态、开发者身份、git 状态、active tasks、spec 索引已加载。",
    );
    expect(context).toContain("This notice is one-shot");
    expect(context.indexOf("<first-reply-notice>")).toBeLessThan(
      context.indexOf("<guidelines>"),
    );
  });

  it("detects persisted Trellis context from metadata", () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [
          {
            type: "text",
            text: "hello",
            metadata: {
              trellis: {
                sessionStart: true,
              },
            },
          },
        ],
      },
    ];

    expect(hasInjectedTrellisContext(messages)).toBe(true);
  });

  it("ignores unrelated user messages", () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [
          {
            type: "text",
            text: "normal prompt",
          },
        ],
      },
    ];

    expect(hasInjectedTrellisContext(messages)).toBe(false);
  });
});
