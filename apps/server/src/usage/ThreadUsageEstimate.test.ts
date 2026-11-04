import { MessageId, ProviderInstanceId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { estimateAccountUsage } from "./ThreadUsageEstimate.ts";
import type { InstanceUsageCost } from "./UsageService.ts";

const HOUR = 3_600_000;
const now = Date.parse("2026-11-04T12:00:00Z");
const at = (ms: number) => DateTime.makeUnsafe(ms);
const cost = (timestampMs: number, sessionId: string, costUsd: number): InstanceUsageCost => ({
  timestampMs,
  sessionId,
  costUsd,
  totals: {
    uncachedInputTokens: 10,
    cachedInputTokens: 100,
    cacheCreationTokens: 5,
    outputTokens: 2,
    reasoningTokens: 0,
  },
});
const run = (id: string, startMs: number, endMs: number | null) => ({
  id: RunId.make(id),
  userMessageId: MessageId.make(`message:${id}`),
  startedAt: at(startMs),
  workStartedAt: undefined,
  completedAt: endMs === null ? null : at(endMs),
  providerThreadId: "provider-thread" as never,
});
const windows = [
  {
    id: "five_hour",
    kind: "session" as const,
    usedPercent: 40,
    resetsAt: DateTime.formatIso(at(now + 2 * HOUR)),
    windowDurationMins: 300,
  },
];

describe("estimateAccountUsage", () => {
  it("attributes only this thread's session usage and calibrates against the whole account", () => {
    const { account, ratios } = estimateAccountUsage({
      instanceId: ProviderInstanceId.make("claude"),
      windows,
      runs: [run("a", now - 4 * HOUR, now - 3.5 * HOUR), run("b", now - HOUR, null)],
      sessionIdByProviderThread: new Map([["provider-thread", "session-1"]]),
      titleByMessageId: new Map(),
      costs: [
        // Before the window: counts for the prompt, not the window.
        cost(now - 3.9 * HOUR, "session-1", 2),
        // Another thread running at the same time as prompt b.
        cost(now - 0.5 * HOUR, "other-session", 6),
        cost(now - 0.5 * HOUR, "session-1", 2),
      ],
      previousRatios: new Map(),
      now,
    });
    // 40% over $8 of account usage in the window.
    expect(ratios.get("five_hour")).toBe(5);
    expect(account.windows).toEqual([
      { id: "five_hour", startsAt: "2026-11-04T09:00:00.000Z", threadPercent: 10 },
    ]);
    expect(account.prompts.map((prompt) => [prompt.runId, prompt.sessionPercent])).toEqual([
      ["b", 10],
      ["a", 10],
    ]);
    expect(account.prompts[0]?.cachedInputTokens).toBe(100);
  });

  it("keeps the last calibration while the new window has no usage", () => {
    const { account } = estimateAccountUsage({
      instanceId: ProviderInstanceId.make("claude"),
      windows: [{ ...windows[0]!, usedPercent: 0 }],
      runs: [run("a", now - 6 * HOUR, now - 5.5 * HOUR)],
      sessionIdByProviderThread: new Map([["provider-thread", "session-1"]]),
      titleByMessageId: new Map(),
      costs: [cost(now - 5.8 * HOUR, "session-1", 1)],
      previousRatios: new Map([["five_hour", 3]]),
      now,
    });
    expect(account.prompts[0]?.sessionPercent).toBe(3);
    expect(account.windows[0]?.threadPercent).toBe(0);
  });
});
