import type {
  EnvironmentId,
  ProviderConsumeResetCreditInput,
  ServerProvider,
  ServerProviderResetCredits,
  ServerProviderUsageWindow,
  ThreadId,
  ThreadUsageAccountEstimate,
} from "@t3tools/contracts";
import {
  collectProviderUsageLimits,
  formatDuration,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { ChevronDownIcon, RotateCwIcon, TicketIcon } from "lucide-react";
import { useState } from "react";

import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { ThreadDetailsSection } from "../components/chat/ThreadDetailsSection";
import {
  ThreadDetailsUsage,
  type ThreadDetailsUsageInput,
} from "../components/chat/ThreadDetailsUsage";
import { providerClients } from "../components/settings/providerDriverMeta";
import { Button } from "../components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { barColor, ResetCreditDialog, useResetCredit } from "../components/usage/UsageLimits";
import { useNowMinute } from "../hooks/useNowMinute";
import { cn } from "../lib/utils";
import {
  deriveProviderInstanceEntries,
  normalizeProviderAccentColor,
  type ProviderInstanceEntry,
  shouldShowInstanceBadge,
} from "../providerInstances";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const RELATIVE_RESET_MS = 30 * MINUTE_MS;

function providerLabel(provider: ServerProvider, providers: readonly ServerProvider[]) {
  const driver = providerClients.get(provider.driver)?.label ?? String(provider.driver);
  const sameDriver = providers.filter((other) => other.driver === provider.driver).length > 1;
  const instance = provider.displayName?.trim() || String(provider.instanceId);
  return sameDriver && instance.toLowerCase() !== driver.toLowerCase()
    ? `${driver} · ${instance}`
    : driver;
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/** 24-hour time; later days add the weekday, and anything within 30 minutes is relative. */
function formatResetTime(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (at - now < RELATIVE_RESET_MS) return `in ${formatDuration(at - now)}`;
  const time = timeFormatter.format(at);
  return new Date(at).toDateString() === new Date(now).toDateString()
    ? time
    : `${weekdayFormatter.format(at)} ${time}`;
}

function formatPercent(value: number): string {
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

/** Custom: usage limits for every enabled provider, the thread's own provider first. */
export function AllProvidersUsage({
  environmentId,
  threadId,
  providerInstanceId,
  providers,
  sources,
}: Omit<ThreadDetailsUsageInput, "contextWindow"> & {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
}) {
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const { data: estimate } = useEnvironmentQuery(
    threadId === null
      ? null
      : serverEnvironment.threadUsageEstimate({ environmentId, input: { threadId } }),
  );
  const withLimits = providers.filter((provider) => provider.enabled && provider.usageLimits);
  const ordered = [
    ...withLimits.filter((provider) => provider.instanceId === providerInstanceId),
    ...withLimits.filter((provider) => provider.instanceId !== providerInstanceId),
  ];
  const [showAll, setShowAll] = useState(false);
  const entries = deriveProviderInstanceEntries(providers);
  const rows = ordered.flatMap((provider) => {
    const entry = entries.find((candidate) => candidate.instanceId === provider.instanceId);
    // Only this instance's data: another report entry may be a different login or workspace.
    const report = collectProviderUsageLimits(provider.instanceId, providers, sources, now);
    const limits =
      report?.accounts.find((account) => account.instanceId === provider.instanceId)?.limits ??
      provider.usageLimits;
    if (entry === undefined || limits === undefined) return [];
    const primary = limits.windows.find((window) => window.kind === "session") ?? limits.windows[0];
    const secondary =
      limits.windows.find((window) => window.kind === "weekly" && window !== primary) ??
      limits.windows.find((window) => window !== primary);
    if (limits.unavailable || primary === undefined) {
      return [
        <ThreadDetailsUsage
          key={provider.instanceId}
          providerInstanceId={provider.instanceId}
          providers={providers}
          sources={sources}
          title={providerLabel(provider, withLimits)}
        />,
      ];
    }
    return [
      <AccountUsageRow
        key={provider.instanceId}
        environmentId={environmentId}
        entry={entry}
        showBadge={shouldShowInstanceBadge(entry, entries)}
        label={providerLabel(provider, withLimits)}
        primary={primary}
        secondary={secondary}
        resetCredits={limits.resetCredits}
        estimate={estimate?.accounts.find((account) => account.instanceId === provider.instanceId)}
        now={now}
      />,
    ];
  });
  if (rows.length === 0) return null;
  const hidden = rows.length - 1;
  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title="Usage limits"
      showHeading={false}
    >
      <div className="flex flex-col gap-1.5">
        {showAll ? rows : rows.slice(0, 1)}
        {hidden > 0 ? (
          <Button
            size="xs"
            variant="ghost"
            className="self-start"
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            <ChevronDownIcon className={cn(showAll && "rotate-180")} aria-hidden />
            {showAll
              ? "Hide other accounts"
              : `${hidden} more ${hidden === 1 ? "account" : "accounts"}`}
          </Button>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

function AccountUsageRow({
  environmentId,
  entry,
  showBadge,
  label,
  primary,
  secondary,
  resetCredits,
  estimate,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly entry: ProviderInstanceEntry;
  readonly showBadge: boolean;
  readonly label: string;
  readonly primary: ServerProviderUsageWindow;
  readonly secondary: ServerProviderUsageWindow | undefined;
  readonly resetCredits: ServerProviderResetCredits | undefined;
  readonly estimate: ThreadUsageAccountEstimate | undefined;
  readonly now: number;
}) {
  const color = normalizeProviderAccentColor(entry.accentColor) ?? barColor(entry.driverKind);
  const threadPercent = (window: ServerProviderUsageWindow) =>
    estimate?.windows.find((candidate) => candidate.id === window.id)?.threadPercent ?? null;
  const weeklyOut = secondary !== undefined && remainingPercent(secondary) <= 0;
  // While the longer window is used up, the session reset changes nothing, so only its reset shows.
  const shownPrimary = weeklyOut ? undefined : primary;
  const bars = (
    <span className="flex min-w-0 flex-col gap-0.5">
      <UsageBar
        window={primary}
        threadPercent={threadPercent(primary)}
        color={color}
        now={now}
        blockedBy={weeklyOut ? secondary : undefined}
      />
      {secondary ? (
        <UsageBar
          window={secondary}
          threadPercent={threadPercent(secondary)}
          color={color}
          now={now}
          secondary
        />
      ) : null}
    </span>
  );

  return (
    <div className="flex min-w-0 flex-col gap-1 px-2.5">
      <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
        <span aria-label={label} className="flex shrink-0">
          <ProviderInstanceIcon
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            accentColor={entry.accentColor}
            acpRegistryAgentId={entry.acpRegistryAgentId}
            acpRegistryIconUrl={entry.acpRegistryIconUrl}
            showBadge={showBadge}
            size="compact"
          />
        </span>
        {shownPrimary?.resetsAt || secondary?.resetsAt ? (
          <RotateCwIcon aria-label="Resets" className="ms-1 size-3 shrink-0" />
        ) : null}
        {shownPrimary ? (
          <ResetTime window={shownPrimary} now={now} className="font-medium text-foreground" />
        ) : null}
        {shownPrimary?.resetsAt && secondary?.resetsAt ? (
          <span aria-hidden className="opacity-50">
            ·
          </span>
        ) : null}
        {secondary ? (
          <ResetTime
            window={secondary}
            now={now}
            className={weeklyOut ? "truncate font-medium text-foreground" : "truncate"}
          />
        ) : null}
        {resetCredits && resetCredits.availableCount > 0 ? (
          <ResetTicketButton
            environmentId={environmentId}
            input={{ instanceId: entry.instanceId }}
            credits={resetCredits}
          />
        ) : null}
      </div>
      {estimate && estimate.prompts.length > 0 ? (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={`${label}: usage by prompt`}
                className="block w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              />
            }
          >
            {bars}
          </PopoverTrigger>
          <PopoverPopup side="left" align="start" sideOffset={16} width="md">
            <PromptBreakdown
              label={label}
              color={color}
              estimate={estimate}
              sessionWindowId={primary.kind === "session" ? primary.id : null}
            />
          </PopoverPopup>
        </Popover>
      ) : (
        bars
      )}
    </div>
  );
}

function ResetTime({
  window,
  now,
  className,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly className?: string;
}) {
  if (!window.resetsAt) return null;
  const text = formatResetTime(window.resetsAt, now);
  return (
    <span className={className} aria-label={`${window.label} resets ${text}`}>
      {text}
    </span>
  );
}

/** Remaining usage and this thread's share; a used-up bar refills toward its reset. */
function UsageBar({
  window,
  threadPercent,
  color,
  now,
  secondary = false,
  blockedBy,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly threadPercent: number | null;
  readonly color: string;
  readonly now: number;
  readonly secondary?: boolean;
  /** A used-up longer window: this bar stays empty, and only that window's bar shows the timer. */
  readonly blockedBy?: ServerProviderUsageWindow | undefined;
}) {
  const left = blockedBy ? 0 : remainingPercent(window);
  const thread = Math.max(0, Math.min(threadPercent ?? 0, 100 - left));
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  const durationMs = (window.windowDurationMins ?? 0) * MINUTE_MS;
  const exhausted = left <= 0;
  // A used-up weekly bar only starts refilling in the last day before its reset.
  const refillMs = secondary ? Math.min(durationMs, DAY_MS) : durationMs;
  const refilled =
    refillMs > 0 && resetsAt > now
      ? Math.max(0, Math.min(100, 100 - ((resetsAt - now) / refillMs) * 100))
      : null;
  const description = exhausted
    ? blockedBy
      ? `${window.label}: unavailable until the ${blockedBy.label.toLowerCase()} limit resets`
      : `${window.label}: used up`
    : `${window.label}: ${left}% left${threadPercent === null ? "" : `, ~${formatPercent(thread)} by this thread`}`;
  return (
    <span
      role="img"
      aria-label={description}
      className={cn(
        "relative block overflow-hidden bg-muted-foreground/20",
        secondary ? "h-2.5" : "h-[18px]",
      )}
    >
      {exhausted ? (
        // Out of usage: the bar becomes a timer that fills toward the reset.
        refilled !== null && !blockedBy ? (
          <span
            className="absolute inset-y-0 left-0 bg-muted-foreground/45"
            style={{ width: `${refilled}%` }}
          />
        ) : null
      ) : (
        <>
          <span
            className="absolute inset-y-0 left-0"
            style={{ width: `${left}%`, background: color }}
          />
          {thread > 0 ? (
            <span
              className="absolute inset-y-0"
              style={{
                left: `${left}%`,
                width: `${thread}%`,
                background: `color-mix(in oklab, ${color} 42%, transparent)`,
              }}
            />
          ) : null}
        </>
      )}
      {secondary ? null : (
        <span
          className={cn(
            "absolute inset-y-0 right-1.5 flex items-center text-2xs font-semibold tabular-nums",
            exhausted ? "text-error-foreground" : "text-white mix-blend-difference",
          )}
        >
          {left}%
        </span>
      )}
    </span>
  );
}

function ResetTicketButton({
  environmentId,
  input,
  credits,
}: {
  readonly environmentId: EnvironmentId;
  readonly input: ProviderConsumeResetCreditInput;
  readonly credits: ServerProviderResetCredits;
}) {
  const { canManageProviders, confirming, setConfirming, busy, status, redeem } = useResetCredit(
    environmentId,
    input,
  );
  return (
    <span className="ms-auto flex shrink-0 items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="ghost"
              disabled={busy || !canManageProviders}
              onClick={() => setConfirming(true)}
            />
          }
        >
          {busy ? (
            "Using…"
          ) : (
            <>
              <TicketIcon aria-label="Use a reset credit" /> {credits.availableCount}
            </>
          )}
        </TooltipTrigger>
        <TooltipPopup>
          {status ??
            `${credits.availableCount} ${credits.availableCount === 1 ? "reset credit" : "reset credits"} banked`}
        </TooltipPopup>
      </Tooltip>
      <ResetCreditDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => void redeem()}
        disabled={!canManageProviders}
      />
    </span>
  );
}

function PromptBreakdown({
  label,
  color,
  estimate,
  sessionWindowId,
}: {
  readonly label: string;
  readonly color: string;
  readonly estimate: ThreadUsageAccountEstimate;
  readonly sessionWindowId: string | null;
}) {
  const session = estimate.windows.find((window) => window.id === sessionWindowId);
  const sessionStart = session ? Date.parse(session.startsAt) : null;
  const maxCost = Math.max(...estimate.prompts.map((prompt) => prompt.costUsd), 0);
  const dividerIndex =
    sessionStart === null
      ? -1
      : estimate.prompts.findIndex((prompt) => Date.parse(prompt.startedAt) < sessionStart);
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="font-medium">Session usage by prompt</span>
        <span className="truncate text-muted-foreground">
          {label}
          {session?.threadPercent != null
            ? ` · this thread ~${formatPercent(session.threadPercent)}`
            : ""}
        </span>
      </div>
      <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
        {estimate.prompts.map((prompt, index) => (
          <div key={prompt.runId}>
            {index === dividerIndex && session ? (
              <div className="my-1.5 flex items-center gap-1.5 text-2xs text-muted-foreground after:h-px after:flex-1 after:bg-border">
                <RotateCwIcon aria-hidden className="size-2.5" />
                Before {timeFormatter.format(Date.parse(session.startsAt))}
              </div>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <div
                    tabIndex={0}
                    className="grid grid-cols-[minmax(0,1fr)_5.5rem_3rem] items-center gap-2 rounded-md px-1 py-0.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  />
                }
              >
                <span className="truncate text-foreground/85">
                  {prompt.title || "Untitled prompt"}
                </span>
                <span className="h-1.5">
                  <span
                    className="block h-full min-w-px"
                    style={{
                      width: maxCost > 0 ? `${(prompt.costUsd / maxCost) * 100}%` : 0,
                      background: color,
                    }}
                  />
                </span>
                <span className="text-end text-2xs text-muted-foreground tabular-nums">
                  {prompt.sessionPercent === null
                    ? "n/a"
                    : `~${formatPercent(prompt.sessionPercent)}`}
                </span>
              </TooltipTrigger>
              <TooltipPopup side="left">
                <div className="flex flex-col gap-0.5 tabular-nums">
                  {prompt.sessionPercent !== null ? (
                    <span className="text-foreground">
                      ~{formatPercent(prompt.sessionPercent)} of session
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">
                    {formatTokens(prompt.inputTokens)} in · {formatTokens(prompt.cachedInputTokens)}{" "}
                    cached · {formatTokens(prompt.cacheWriteTokens)} written ·{" "}
                    {formatTokens(prompt.outputTokens)} out
                  </span>
                  <span className="text-muted-foreground">
                    ≈ ${prompt.costUsd.toFixed(2)} API-equivalent
                  </span>
                </div>
              </TooltipPopup>
            </Tooltip>
          </div>
        ))}
      </div>
      <span className="mt-1.5 text-2xs text-muted-foreground">
        Estimated from each prompt's tokens.
      </span>
    </div>
  );
}
