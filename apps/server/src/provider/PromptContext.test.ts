import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert } from "@effect/vitest";
import { ThreadId, RunId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PromptContext from "./PromptContext.ts";
import { ServerConfig } from "../config.ts";

const testLayer = PromptContext.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-prompt-context-" })),
  Layer.provide(NodeServices.layer),
);

it.layer(testLayer)("PromptContext", (it) => {
  it.effect("persists exact per-turn entries and isolates threads", () =>
    Effect.gen(function* () {
      const store = yield* PromptContext.PromptContext;
      const threadId = ThreadId.make("../thread");
      const otherThreadId = ThreadId.make("other/thread");
      const first = {
        threadId,
        runId: RunId.make("first"),
        ordinal: 1,
        capturedAt: "2026-11-05T12:00:00Z",
        entries: [{ source: "t3_code_runtime", text: "original instructions" }],
      };
      assert.deepEqual(yield* store.read({ threadId }), { snapshots: [], snapshot: null });
      yield* store.capture(first);
      const saved = yield* store.read({ threadId });
      yield* store.capture({ ...first, runId: RunId.make("second"), ordinal: 2, entries: [] });
      const latest = yield* store.read({ threadId });
      assert.equal(latest.snapshot?.ordinal, 2);
      assert.deepEqual(
        latest.snapshots.map((item) => item.ordinal),
        [2, 1],
      );
      const restored = yield* store.read({ threadId, snapshotId: saved.snapshots[0]!.id });
      assert.deepEqual(restored.snapshot, first);
      assert.deepEqual(yield* store.read({ threadId: otherThreadId }), {
        snapshots: [],
        snapshot: null,
      });
      assert.isNull((yield* store.read({ threadId, snapshotId: "../outside" })).snapshot);
    }),
  );
});
