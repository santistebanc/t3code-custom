// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import {
  PromptContextError,
  PromptContextSnapshot,
  type ThreadId,
  type PromptContextReadInput,
  type PromptContextReadResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ServerConfig } from "../config.ts";

const encodeSnapshot = Schema.encodeEffect(Schema.fromJsonString(PromptContextSnapshot));
const decodeSnapshot = Schema.decodeEffect(Schema.fromJsonString(PromptContextSnapshot));

const hash = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
const snapshotName = /^[0-9]+-[a-f0-9]{64}\.json$/;

export class PromptContext extends Context.Service<
  PromptContext,
  {
    readonly capture: (snapshot: PromptContextSnapshot) => Effect.Effect<void, PromptContextError>;
    readonly read: (
      input: typeof PromptContextReadInput.Type,
    ) => Effect.Effect<typeof PromptContextReadResult.Type, PromptContextError>;
  }
>()("t3/provider/PromptContext") {}

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const directory = (threadId: ThreadId) =>
    path.join(config.stateDir, "prompt-context", hash(threadId));
  const capture = Effect.fn("PromptContext.capture")(
    function* (snapshot: PromptContextSnapshot) {
      const dir = directory(snapshot.threadId);
      yield* fs.makeDirectory(dir, { recursive: true });
      const name = `${String(snapshot.ordinal).padStart(10, "0")}-${hash(snapshot.runId)}.json`;
      const target = path.join(dir, name);
      const text = yield* encodeSnapshot(snapshot);
      yield* fs.writeFileString(`${target}.tmp`, text);
      yield* fs.rename(`${target}.tmp`, target);
    },
    Effect.mapError(() => new PromptContextError({ message: "Could not save prompt context." })),
  );
  const read = Effect.fn("PromptContext.read")(
    function* (input: typeof PromptContextReadInput.Type) {
      const dir = directory(input.threadId);
      const files = yield* fs.readDirectory(dir).pipe(
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound" ? Effect.succeed([] as string[]) : Effect.fail(error),
        }),
      );
      const snapshots = files
        .filter((name) => snapshotName.test(name))
        .sort()
        .reverse()
        .map((name) => ({
          id: name.slice(0, -5),
          ordinal: Number(name.split("-")[0]),
        }));
      const selected =
        input.snapshotId === undefined
          ? snapshots[0]
          : snapshots.find((item) => item.id === input.snapshotId);
      if (!selected) return { snapshots, snapshot: null };
      const text = yield* fs.readFileString(path.join(dir, `${selected.id}.json`));
      const snapshot = yield* decodeSnapshot(text);
      return { snapshots, snapshot };
    },
    Effect.mapError(() => new PromptContextError({ message: "Could not read prompt context." })),
  );
  return PromptContext.of({ capture, read });
});

export const layer = Layer.effect(PromptContext, make);
