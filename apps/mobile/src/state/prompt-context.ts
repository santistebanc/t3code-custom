import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";

export const promptContext = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:prompt-context",
  tag: WS_METHODS.promptContextRead,
  staleTimeMs: 0,
  idleTtlMs: 0,
});
