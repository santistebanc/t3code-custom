import type { ServerProvider } from "@t3tools/contracts";

import { providerClients } from "../components/settings/providerDriverMeta";
import {
  ThreadDetailsUsage,
  type ThreadDetailsUsageInput,
} from "../components/chat/ThreadDetailsUsage";

function providerLabel(provider: ServerProvider, providers: readonly ServerProvider[]) {
  const driver = providerClients.get(provider.driver)?.label ?? String(provider.driver);
  const sameDriver = providers.filter((other) => other.driver === provider.driver).length > 1;
  const instance = provider.displayName?.trim() || String(provider.instanceId);
  return sameDriver && instance.toLowerCase() !== driver.toLowerCase()
    ? `${driver} · ${instance}`
    : driver;
}

/** Custom: usage limits for every enabled provider, the thread's own provider first. */
export function AllProvidersUsage({
  providerInstanceId,
  providers,
  sources,
}: Omit<ThreadDetailsUsageInput, "contextWindow">) {
  const withLimits = providers.filter((provider) => provider.enabled && provider.usageLimits);
  const ordered = [
    ...withLimits.filter((provider) => provider.instanceId === providerInstanceId),
    ...withLimits.filter((provider) => provider.instanceId !== providerInstanceId),
  ];
  return ordered.map((provider) => (
    <ThreadDetailsUsage
      key={provider.instanceId}
      providerInstanceId={provider.instanceId}
      providers={providers}
      sources={sources}
      title={providerLabel(provider, withLimits)}
    />
  ));
}
