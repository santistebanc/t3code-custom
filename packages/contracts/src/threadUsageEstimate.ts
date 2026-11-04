import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ThreadUsageEstimateInput = Schema.Struct({ threadId: ThreadId });
export type ThreadUsageEstimateInput = typeof ThreadUsageEstimateInput.Type;

export const ThreadUsagePromptEstimate = Schema.Struct({
  runId: RunId,
  userMessageId: MessageId,
  /** The prompt's first line, shortened. */
  title: Schema.String,
  startedAt: IsoDateTime,
  /** Null until the account has enough usage in its session window to calibrate. */
  sessionPercent: Schema.NullOr(Schema.Number),
  costUsd: Schema.Number,
  inputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  cacheWriteTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
});
export type ThreadUsagePromptEstimate = typeof ThreadUsagePromptEstimate.Type;

export const ThreadUsageWindowEstimate = Schema.Struct({
  id: TrimmedNonEmptyString,
  startsAt: IsoDateTime,
  /** This thread's estimated share of the window, in the window's percent units. */
  threadPercent: Schema.NullOr(Schema.Number),
});
export type ThreadUsageWindowEstimate = typeof ThreadUsageWindowEstimate.Type;

export const ThreadUsageAccountEstimate = Schema.Struct({
  instanceId: ProviderInstanceId,
  windows: Schema.Array(ThreadUsageWindowEstimate),
  /** Newest first. */
  prompts: Schema.Array(ThreadUsagePromptEstimate),
});
export type ThreadUsageAccountEstimate = typeof ThreadUsageAccountEstimate.Type;

/** Per-prompt usage estimated from each prompt's priced tokens, calibrated per limit window. */
export const ThreadUsageEstimate = Schema.Struct({
  accounts: Schema.Array(ThreadUsageAccountEstimate),
});
export type ThreadUsageEstimate = typeof ThreadUsageEstimate.Type;
