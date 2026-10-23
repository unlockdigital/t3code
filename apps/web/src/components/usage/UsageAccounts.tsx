import {
  formatResetsIn,
  remainingPercent,
  prepaidCreditPercent,
  usageWindowDetails,
  usageAccountWindows,
  type UsageAccount,
  usageAccountHistory,
  type UsageAccountHistoryEnvironment,
} from "@t3tools/shared/usageLimits";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import {
  ChevronDownIcon,
  KeyRoundIcon,
  LayersIcon,
  ShieldCheckIcon,
  TicketIcon,
} from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { ResetCredits, barColor } from "./UsageLimits";
import type { UsagePagePreferences } from "./usagePagePreferences";

type Density = NonNullable<UsagePagePreferences["density"]>;
const NO_HISTORY: readonly UsageAccountHistoryEnvironment[] = [];

function quotaLabel(account: UsageAccount, window: ReturnType<typeof usageAccountWindows>[number]) {
  return (usageWindowDetails(account.driver, window.id)?.label ?? window.label)
    .replace(/\s*·\s*Reported quota$/, "")
    .replace(
      /^gemini-(.+?)(?:-tiered)?$/,
      (_, model: string) =>
        `Gemini ${model.replaceAll("-", " ").replace(/\b(flash|pro|lite)\b/g, (word) => word[0]!.toUpperCase() + word.slice(1))}`,
    );
}

function AccountRow({
  account,
  now,
  density,
  onFocus,
  historyEnvironments,
  showEnvironment,
}: {
  readonly account: UsageAccount;
  readonly now: number;
  readonly density: Density;
  readonly onFocus: () => void;
  readonly historyEnvironments: readonly UsageAccountHistoryEnvironment[];
  readonly showEnvironment: boolean;
}) {
  const { limits } = account;
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const driver = providerClients.get(account.driver);
  const color = barColor(account.driver);
  const windows = usageAccountWindows(account, now);
  const history = usageAccountHistory(account, historyEnvironments);
  const isApi = account.category === "API key";
  const external = limits?.externalUsage;
  const credits = limits?.creditBalance;
  const prepaidBalance = limits?.prepaidBalance;
  const creditPercent = prepaidCreditPercent(prepaidBalance);
  const creditValue = credits?.unlimited
    ? "Unlimited"
    : credits?.balance !== undefined
      ? Number(credits.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })
      : credits?.hasCredits
        ? "—"
        : "0";
  const summaryLimit = credits || isApi ? 2 : 3;
  const summaryWindows =
    windows.length <= summaryLimit
      ? windows
      : [...windows]
          .sort(
            (left, right) =>
              Number(right.kind === "monthly") - Number(left.kind === "monthly") ||
              remainingPercent(left) - remainingPercent(right),
          )
          .slice(0, summaryLimit);
  const exhaustedCount = windows.filter((window) => remainingPercent(window) === 0).length;
  const historyNotice =
    history.state === "loading"
      ? "Loading usage…"
      : history.state === "shared"
        ? "Shared history · see Cost & Tokens"
        : "No linked usage yet";
  const CategoryIcon = isApi
    ? KeyRoundIcon
    : account.category === "Subscription"
      ? ShieldCheckIcon
      : LayersIcon;
  const providerLabel =
    account.driver === "antigravity" ? "Google" : (driver?.label ?? "Custom provider");
  const quotaRows = (rows: typeof windows) => (
    <dl className="grid min-w-0 gap-x-6 gap-y-3 @min-[34rem]/usage-accounts:grid-cols-2 @min-[48rem]/usage-accounts:grid-cols-3">
      {rows.map((window) => {
        const remaining = remainingPercent(window);
        const reset = formatResetsIn(window, now);
        return (
          <div key={`${window.kind}:${window.id}`} className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <dt className="min-w-0 text-xs text-muted-foreground wrap-anywhere">
                {quotaLabel(account, window)}
              </dt>
              <dd
                className={cn(
                  "max-w-full shrink-0 font-semibold tabular-nums",
                  density === "compact" ? "text-lg" : "text-xl",
                )}
              >
                {remaining}%{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  left{remaining === 0 ? " · Exhausted" : ""}
                </span>
              </dd>
            </div>
            <div aria-hidden className="h-1 overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full"
                style={{ width: `${remaining}%`, backgroundColor: color }}
              />
            </div>
            {reset ? <p className="text-xs text-muted-foreground tabular-nums">{reset}</p> : null}
          </div>
        );
      })}
    </dl>
  );
  return (
    <article
      aria-label={account.label}
      onFocusCapture={onFocus}
      className={cn(
        "min-w-0 rounded-lg border border-border bg-card shadow-xs dark:border-white/15 dark:bg-white/[0.06]",
        density === "compact" ? "text-xs" : "text-sm",
      )}
    >
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 items-center gap-x-4 gap-y-2 @min-[18rem]/usage-accounts:grid-cols-[minmax(0,1fr)_auto] @min-[48rem]/usage-accounts:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]",
          density === "compact" ? "px-3 py-2" : "p-4",
        )}
      >
        <header className="flex min-h-11 min-w-0 flex-col items-start gap-2 @min-[18rem]/usage-accounts:flex-row @min-[18rem]/usage-accounts:items-center">
          {driver ? (
            <ProviderInstanceIcon
              driverKind={account.driver}
              instanceId={account.instanceId}
              displayName={account.label}
              className="size-4 shrink-0"
              iconClassName="size-4"
            />
          ) : (
            <LayersIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-medium text-foreground wrap-anywhere">{account.label}</h3>
            <p className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground [&>span]:min-w-0 [&>span]:wrap-anywhere">
              <span>{providerLabel}</span>
              <span aria-hidden>·</span>
              <CategoryIcon className="size-3" aria-hidden />
              <span>{isApi ? "API" : account.category}</span>
              {showEnvironment ? <span>· {account.environmentLabel}</span> : null}
              {account.status !== "Connected" ? <span>· {account.status}</span> : null}
              {exhaustedCount > 0 ? (
                <span className="font-medium text-foreground">· {exhaustedCount} exhausted</span>
              ) : null}
              {limits?.resetCredits?.availableCount ? (
                <span className="inline-flex items-center gap-1">
                  <TicketIcon className="size-3" aria-hidden />
                  {limits.resetCredits.availableCount}
                  <span className="sr-only"> quota resets available</span>
                </span>
              ) : null}
            </p>
          </div>
        </header>
        <dl className="order-2 grid min-h-16 min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))] items-start gap-x-4 gap-y-2 @min-[18rem]/usage-accounts:order-3 @min-[18rem]/usage-accounts:col-span-2 @min-[48rem]/usage-accounts:order-2 @min-[48rem]/usage-accounts:col-span-1">
          {summaryWindows.map((window) => (
            <div key={`${window.kind}:${window.id}`} className="min-w-0 space-y-0.5">
              <dt className="text-xs text-muted-foreground wrap-anywhere">
                {quotaLabel(account, window)}
              </dt>
              <dd className="text-lg font-semibold tabular-nums">
                {remainingPercent(window)}%{" "}
                <span className="text-xs font-normal text-muted-foreground">left</span>
              </dd>
              <div
                aria-hidden
                className="h-0.5 max-w-28 overflow-hidden rounded-full bg-foreground/10"
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${remainingPercent(window)}%`, backgroundColor: color }}
                />
              </div>
            </div>
          ))}
          {credits ? (
            <div className="min-w-0">
              <dt className="sr-only">Credits remaining</dt>
              <dd>
                <button
                  type="button"
                  aria-label={`Credit details for ${account.label}`}
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => setExpanded((value) => !value)}
                  className="min-h-11 min-w-0 max-w-full cursor-pointer rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-1 text-xs text-muted-foreground wrap-anywhere">
                    Credits remaining
                    {prepaidBalance && limits?.unavailable?.reason === "probeFailed"
                      ? " · stale"
                      : ""}
                    <ChevronDownIcon
                      aria-hidden
                      className={cn("size-3 shrink-0", expanded && "rotate-180")}
                    />
                  </span>
                  <span className="block text-lg font-semibold tabular-nums wrap-anywhere">
                    {creditValue}
                  </span>
                </button>
              </dd>
            </div>
          ) : null}
          {isApi ? (
            <div className="min-w-0 space-y-0.5">
              <dt className="text-xs text-muted-foreground">
                Credits remaining
                {prepaidBalance && limits?.unavailable?.reason === "probeFailed" ? " · stale" : ""}
              </dt>
              <dd className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold tabular-nums">
                {prepaidBalance ? formatUsd(prepaidBalance.remainingUsd) : "—"}
                {creditPercent !== null ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {creditPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% left
                  </span>
                ) : null}
              </dd>
              {creditPercent !== null ? (
                <div
                  role="meter"
                  aria-label={`Credits remaining for ${account.label}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={creditPercent}
                  aria-valuetext={`${formatUsd(prepaidBalance!.remainingUsd)} remaining, ${creditPercent.toFixed(1)}% of ${formatUsd(prepaidBalance!.totalGrantedUsd!)}`}
                  className="h-1 max-w-56 overflow-hidden rounded-full bg-foreground/10"
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${creditPercent}%`,
                      backgroundColor: creditPercent <= 10 ? "var(--color-destructive)" : color,
                    }}
                  />
                </div>
              ) : null}
              {!prepaidBalance ? (
                <p className="text-xs text-muted-foreground">Balance unavailable</p>
              ) : null}
            </div>
          ) : null}
          {!windows.length && !credits && !isApi ? (
            <div>
              <dt className="sr-only">Usage status</dt>
              <dd className="text-xs text-muted-foreground">
                {limits?.unavailable?.reason === "probeFailed"
                  ? "Refresh to retry usage"
                  : "Usage unavailable"}
              </dd>
            </div>
          ) : null}
        </dl>
        <Button
          variant="ghost-muted"
          size="sm"
          aria-label={`Details for ${account.label}`}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
          className="order-3 min-h-11 min-w-11 justify-self-end @min-[18rem]/usage-accounts:order-2 @min-[48rem]/usage-accounts:order-3"
        >
          <span className="@min-[18rem]/usage-accounts:hidden @min-[30rem]/usage-accounts:inline">
            Details
          </span>
          <ChevronDownIcon aria-hidden className={cn("size-3.5", expanded && "rotate-180")} />
        </Button>
      </div>
      <div
        id={detailsId}
        hidden={!expanded}
        className={cn("border-t border-border", density === "compact" ? "p-3" : "p-4")}
      >
        <div className="min-w-0 space-y-3">
          {windows.length ? <div className="min-w-0">{quotaRows(windows)}</div> : null}
          {prepaidBalance ? (
            <p className="text-xs text-muted-foreground">
              Account balance · Updated {new Date(limits!.checkedAt).toLocaleString()}. Covers all
              account usage.
              {prepaidBalance.totalGrantedUsd !== undefined
                ? ` ${formatUsd(prepaidBalance.totalGrantedUsd)} in settled credits.`
                : " Credit total unavailable."}
            </p>
          ) : null}
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground wrap-anywhere",
              windows.length > 0 && "border-t border-border pt-3",
            )}
          >
            {credits ? (
              <p>
                Credits remaining:{" "}
                <span className="font-medium text-foreground">{creditValue}</span>
              </p>
            ) : null}
            {account.plan ? <p>{account.plan}</p> : null}
            {showEnvironment ? <p>{account.environmentLabel}</p> : null}
            {isApi ? <p>Spend estimates cover this connection’s recorded runs.</p> : null}
            {limits?.creditBalance?.hasCredits && limits.creditBalance.balance === undefined ? (
              <p>
                The provider confirms credits are available and omits the balance and monthly
                allotment.
              </p>
            ) : null}
            {history.state === "ready" && isApi ? (
              <>
                <p>
                  Estimated spend:{" "}
                  {history.records === 0
                    ? "—"
                    : history.unpriced && history.costUsd === 0
                      ? "Unpriced"
                      : `${formatUsd(history.costUsd)}${history.unpriced ? "+" : ""}`}
                </p>
                <p>
                  {history.records
                    ? `${formatTokens(history.tokens)} tokens${history.partial ? " · Partial history" : ""}`
                    : "No recorded activity"}
                </p>
                <p>
                  {history.sinceDay} – {history.untilDay}
                </p>
              </>
            ) : null}
            {isApi && history.state !== "ready" ? <p>{historyNotice}</p> : null}
            {limits?.unavailable?.message ? <p>{limits.unavailable.message}</p> : null}
            {external ? (
              <Button
                variant="outline"
                size="sm-multiline"
                className="max-w-full"
                aria-label={`Open ${external.label} for ${account.label}`}
                onClick={() => void ensureLocalApi().shell.openExternal(external.url)}
              >
                Billing
              </Button>
            ) : null}
            {limits?.resetCredits && account.resetCreditInput ? (
              <ResetCredits
                environmentId={account.environmentId}
                input={account.resetCreditInput}
                credits={limits.resetCredits}
                now={now}
              />
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function UsageAccounts({
  accounts,
  now,
  density,
  onDensityChange,
  historyEnvironments = NO_HISTORY,
}: {
  readonly accounts: readonly UsageAccount[];
  readonly now: number;
  readonly density: Density;
  readonly onDensityChange: (density: Density) => void;
  readonly historyEnvironments?: readonly UsageAccountHistoryEnvironment[];
}) {
  const showEnvironment = new Set(accounts.map((account) => account.environmentId)).size > 1;
  const headingId = useId();
  const grid = useRef<HTMLDivElement>(null);
  const focusedAccount = useRef<string | null>(null);
  const keys = JSON.stringify(accounts.map((account) => account.key));
  useLayoutEffect(() => {
    const present: readonly string[] = JSON.parse(keys);
    if (focusedAccount.current && !present.includes(focusedAccount.current)) {
      if (document.activeElement === document.body) grid.current?.focus();
      focusedAccount.current = null;
    }
  }, [keys]);

  return (
    <section className="@container/usage-accounts space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-sm font-medium">
          Accounts <span className="text-muted-foreground">({accounts.length})</span>
        </h2>
        <ToggleGroup
          aria-label="Usage density"
          className="min-w-0 max-w-full flex-wrap"
          value={[density]}
          onValueChange={(values) => {
            const value = values[0];
            if (value === "compact" || value === "comfortable") onDensityChange(value);
          }}
        >
          <Toggle value="compact" className="max-sm:min-h-11">
            Compact
          </Toggle>
          <Toggle value="comfortable" className="max-sm:min-h-11">
            Comfortable
          </Toggle>
        </ToggleGroup>
      </div>
      <div
        ref={grid}
        role="group"
        tabIndex={-1}
        aria-labelledby={headingId}
        onBlurCapture={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            !event.currentTarget.contains(event.relatedTarget)
          )
            focusedAccount.current = null;
        }}
        className="space-y-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {accounts.map((account) => (
          <AccountRow
            key={account.key}
            account={account}
            now={now}
            density={density}
            showEnvironment={showEnvironment}
            historyEnvironments={historyEnvironments}
            onFocus={() => {
              focusedAccount.current = account.key;
            }}
          />
        ))}
      </div>
    </section>
  );
}
