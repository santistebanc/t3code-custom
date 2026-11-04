import {
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
  type ThreadId,
  type ThreadUsageAccountEstimate,
  type ThreadUsageEstimate,
  type ThreadUsagePromptEstimate,
  UsageReadError,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { type InstanceUsageCost, UsageService } from "./UsageService.ts";

const MINUTE_MS = 60_000;
const isoAt = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
// Transcript lines can land just after the provider reports the turn complete.
const RUN_END_GRACE_MS = 5_000;

type EstimatedWindow = Pick<
  ServerProviderUsageWindow,
  "id" | "kind" | "usedPercent" | "resetsAt" | "windowDurationMins"
>;

export interface ThreadUsageAccountInput {
  readonly instanceId: ProviderInstanceId;
  readonly windows: ReadonlyArray<EstimatedWindow>;
  readonly runs: ReadonlyArray<
    Pick<
      OrchestrationV2Run,
      "id" | "userMessageId" | "startedAt" | "workStartedAt" | "completedAt" | "providerThreadId"
    >
  >;
  readonly sessionIdByProviderThread: ReadonlyMap<string, string>;
  readonly titleByMessageId: ReadonlyMap<string, string>;
  readonly costs: ReadonlyArray<InstanceUsageCost>;
  /** Last calibrated percent-per-dollar by window id, used while a window has no usage yet. */
  readonly previousRatios: ReadonlyMap<string, number>;
  readonly now: number;
}

const TITLE_MAX_LENGTH = 120;
function promptTitle(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH - 1)}…` : line;
}

/** The session and weekly windows the panel draws, with the start each one implies. */
function estimatedWindows(windows: ReadonlyArray<EstimatedWindow>, now: number) {
  return (["session", "weekly"] as const).flatMap((kind) => {
    const window = windows.find((candidate) => candidate.kind === kind);
    if (window?.resetsAt === undefined || window.windowDurationMins === undefined) return [];
    const resetsAtMs = Date.parse(window.resetsAt);
    if (!Number.isFinite(resetsAtMs) || resetsAtMs <= now) return [];
    return [{ window, startMs: resetsAtMs - window.windowDurationMins * MINUTE_MS }];
  });
}

export function estimateAccountUsage(input: ThreadUsageAccountInput): {
  readonly account: ThreadUsageAccountEstimate;
  readonly ratios: ReadonlyMap<string, number>;
} {
  const windows = estimatedWindows(input.windows, input.now);
  const ratios = new Map<string, number>();
  for (const { window, startMs } of windows) {
    let total = 0;
    for (const cost of input.costs) if (cost.timestampMs >= startMs) total += cost.costUsd;
    const ratio =
      total > 0 && window.usedPercent > 0
        ? window.usedPercent / total
        : input.previousRatios.get(window.id);
    if (ratio !== undefined) ratios.set(window.id, ratio);
  }

  const started = input.runs
    .flatMap((run) => {
      const start = run.workStartedAt ?? run.startedAt;
      const sessionId =
        run.providerThreadId === null
          ? undefined
          : input.sessionIdByProviderThread.get(run.providerThreadId);
      if (start === null || sessionId === undefined) return [];
      return [
        {
          run,
          sessionId,
          startMs: DateTime.toEpochMillis(start),
          endMs: run.completedAt === null ? input.now : DateTime.toEpochMillis(run.completedAt),
        },
      ];
    })
    .toSorted((a, b) => a.startMs - b.startMs);

  const session = windows.find(({ window }) => window.kind === "session");
  const sessionRatio = session === undefined ? undefined : ratios.get(session.window.id);
  const windowCost = new Map(windows.map(({ window }) => [window.id, 0]));
  const prompts: Array<ThreadUsagePromptEstimate> = [];
  for (const [index, entry] of started.entries()) {
    const nextStartMs = started[index + 1]?.startMs ?? Number.POSITIVE_INFINITY;
    const endMs = Math.min(entry.endMs + RUN_END_GRACE_MS, nextStartMs);
    let costUsd = 0;
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let cacheWriteTokens = 0;
    let outputTokens = 0;
    for (const cost of input.costs) {
      if (
        cost.sessionId !== entry.sessionId ||
        cost.timestampMs < entry.startMs ||
        cost.timestampMs >= endMs
      ) {
        continue;
      }
      costUsd += cost.costUsd;
      inputTokens += cost.totals.uncachedInputTokens;
      cachedInputTokens += cost.totals.cachedInputTokens;
      cacheWriteTokens += cost.totals.cacheCreationTokens;
      outputTokens += cost.totals.outputTokens;
      for (const { window, startMs } of windows) {
        if (cost.timestampMs >= startMs) {
          windowCost.set(window.id, (windowCost.get(window.id) ?? 0) + cost.costUsd);
        }
      }
    }
    prompts.push({
      runId: entry.run.id,
      userMessageId: entry.run.userMessageId,
      title: input.titleByMessageId.get(entry.run.userMessageId) ?? "",
      startedAt: isoAt(entry.startMs),
      sessionPercent: sessionRatio === undefined ? null : costUsd * sessionRatio,
      costUsd,
      inputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens,
    });
  }

  return {
    ratios,
    account: {
      instanceId: input.instanceId,
      windows: windows.map(({ window, startMs }) => {
        const ratio = ratios.get(window.id);
        return {
          id: window.id,
          startsAt: isoAt(startMs),
          threadPercent: ratio === undefined ? null : (windowCost.get(window.id) ?? 0) * ratio,
        };
      }),
      prompts: prompts.toReversed(),
    },
  };
}

/** Built where its callers live; keeps calibrations across requests while the server runs. */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const usage = yield* UsageService;
  const ratiosByInstance = new Map<ProviderInstanceId, ReadonlyMap<string, number>>();

  const estimate = Effect.fn("ThreadUsageEstimator.estimate")(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<ThreadUsageEstimate, UsageReadError> {
    const records = yield* orchestrator
      .getThreadRecords(threadId, ["runs", "providerThreads", "messages"])
      .pipe(
        Effect.mapError(
          (cause) =>
            new UsageReadError({
              reason: "scanFailed",
              detail: "Thread could not be read.",
              cause,
            }),
        ),
      );
    const providers = yield* providerRegistry.getProviders;
    const now = yield* Clock.currentTimeMillis;
    const sessionIdByProviderThread = new Map(
      records.providerThreads.flatMap((thread: OrchestrationV2ProviderThread) =>
        thread.nativeThreadRef?.nativeId == null
          ? []
          : [[thread.id as string, thread.nativeThreadRef.nativeId] as const],
      ),
    );
    const titleByMessageId = new Map(
      records.messages.flatMap((message) =>
        message.role === "user" ? [[message.id as string, promptTitle(message.text)] as const] : [],
      ),
    );
    const instanceIds = [...new Set(records.runs.map((run) => run.providerInstanceId))];
    const accounts = yield* Effect.forEach(instanceIds, (instanceId) =>
      Effect.gen(function* () {
        const provider = providers.find(
          (candidate: ServerProvider) => candidate.instanceId === instanceId,
        );
        const windows = provider?.usageLimits?.windows ?? [];
        const runs = records.runs.filter((run) => run.providerInstanceId === instanceId);
        const starts = [
          ...estimatedWindows(windows, now).map(({ startMs }) => startMs),
          ...runs.flatMap((run) => {
            const start = run.workStartedAt ?? run.startedAt;
            return start === null ? [] : [DateTime.toEpochMillis(start)];
          }),
        ];
        if (starts.length === 0) return null;
        const costs = yield* usage.readInstanceCosts({ instanceId, sinceMs: Math.min(...starts) });
        const { account, ratios } = estimateAccountUsage({
          instanceId,
          windows,
          runs,
          sessionIdByProviderThread,
          titleByMessageId,
          costs,
          previousRatios: ratiosByInstance.get(instanceId) ?? new Map(),
          now,
        });
        ratiosByInstance.set(instanceId, ratios);
        return account;
      }),
    );
    return { accounts: accounts.filter((account) => account !== null) };
  });

  return { estimate } as const;
});
