import * as Schema from "effect/Schema";
import { ThreadId, RunId } from "./baseSchemas.ts";

export const PromptContextEntry = Schema.Struct({
  source: Schema.String,
  text: Schema.String,
});
export const PromptContextSnapshot = Schema.Struct({
  threadId: ThreadId,
  runId: RunId,
  ordinal: Schema.Number,
  capturedAt: Schema.String,
  entries: Schema.Array(PromptContextEntry),
});
export type PromptContextSnapshot = typeof PromptContextSnapshot.Type;
export const PromptContextReadInput = Schema.Struct({
  threadId: ThreadId,
  snapshotId: Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9]+-[a-f0-9]{64}$/))),
});
export const PromptContextReadResult = Schema.Struct({
  snapshots: Schema.Array(Schema.Struct({ id: Schema.String, ordinal: Schema.Number })),
  snapshot: Schema.NullOr(PromptContextSnapshot),
});
export class PromptContextError extends Schema.TaggedError<PromptContextError>()(
  "PromptContextError",
  {
    message: Schema.String,
  },
) {}
