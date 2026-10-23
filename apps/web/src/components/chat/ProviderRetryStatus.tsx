import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { providerRetryCountdown } from "@t3tools/shared/orchestrationV2ThreadError";
import { RotateCcwIcon } from "lucide-react";
import { useNowSecond } from "../../hooks/useNowSecond";
import { WorkLogRow } from "./WorkLog";

export function ProviderRetryStatus({
  item,
}: {
  item: Pick<
    Extract<OrchestrationV2TurnItem, { type: "error" }>,
    "status" | "updatedAt" | "retry" | "failure"
  >;
}) {
  const label = providerRetryCountdown(item, useNowSecond());
  return (
    <WorkLogRow
      data-v2-item-type="error"
      icon={<RotateCcwIcon className="size-4 text-icon-muted" />}
      wrapLabel
      label={
        <span className="text-muted-foreground">
          <span className="font-medium tabular-nums">{label}</span>
          <span className="ml-2">{item.failure.message}</span>
        </span>
      }
    >
      <p className="pl-6 text-xs text-muted-foreground">
        Continuing automatically. Use Stop to cancel.
      </p>
    </WorkLogRow>
  );
}
