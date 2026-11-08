import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { N2itionStatus } from "@t3tools/contracts/n2itionConnection";
import { useEffect, useEffectEvent, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText";
import * as Dialog from "../../../components/ui/Dialog";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { ListActionRow as SettingsActionRow } from "../../../components/ui/ListActionRow";
import { SettingsSection } from "./SettingsSection";

export function N2itionConnectionSection({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const allowed = useAtomValue(serverEnvironment.n2itionReconnect.permissionAtom(environmentId));
  const getStatus = useAtomCommand(serverEnvironment.n2itionStatus, { reportFailure: false });
  const reconnect = useAtomCommand(serverEnvironment.n2itionReconnect, { reportFailure: false });
  const control = useAtomCommand(serverEnvironment.n2itionControl, { reportFailure: false });
  const refresh = useAtomCommand(serverEnvironment.n2itionRefresh, { reportFailure: false });
  const [status, setStatus] = useState<N2itionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadStatus = useEffectEvent(() => getStatus({ environmentId, input: {} }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Poll the owner environment while its connection status is displayed.
  useEffect(() => {
    if (!allowed) return;
    let closed = false;
    const check = () => {
      void loadStatus()
        .then((result) => {
          if (!closed && result._tag === "Success")
            setStatus((previous) =>
              previous?.epoch !== null &&
              previous?.epoch !== undefined &&
              result.value.epoch !== null &&
              previous.epoch > result.value.epoch
                ? previous
                : result.value,
            );
        })
        .catch(() => undefined);
    };
    check();
    const timer = setInterval(check, 30000);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [allowed]);
  const act = async (action: "check" | "reconnect" | "pause" | "resume" | "revoke" | "refresh") => {
    if (!allowed || busy || status?.epoch === null || !status) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        action === "check"
          ? await getStatus({ environmentId, input: {} })
          : action === "reconnect"
            ? await reconnect({ environmentId, input: { expectedEpoch: status.epoch } })
            : action === "refresh"
              ? await refresh({ environmentId, input: {} })
              : await control({ environmentId, input: { action, expectedEpoch: status.epoch } });
      if (result._tag === "Success")
        setStatus((previous) =>
          previous?.epoch !== null &&
          previous?.epoch !== undefined &&
          result.value.epoch !== null &&
          previous.epoch > result.value.epoch
            ? previous
            : result.value,
        );
      else
        setError(
          "The connection needs attention. Check status and verify this environment’s account setup.",
        );
    } catch {
      setError("Connection status is unavailable. Reconnect this environment and try again.");
    } finally {
      setBusy(false);
    }
  };
  if (!allowed || !status || status.state === "disabled") return null;
  const revoked = status.localMode === "revoked";
  return (
    <SettingsSection title="Teddy · N2ITION">
      <View className="gap-2 p-4">
        <Text>{status.state.replaceAll("_", " ")}</Text>
        <Text className="text-sm text-foreground-muted">
          Read-only task context. Reconnection verifies the enrolled account and preserves the
          current access limits.
        </Text>
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
      </View>
      <SettingsActionRow
        icon="arrow.clockwise"
        label="Check status"
        disabled={busy}
        onPress={() => void act("check")}
      />
      <SettingsActionRow
        icon="checkmark"
        label="Verify and reconnect"
        disabled={busy || revoked}
        onPress={() => void act("reconnect")}
      />
      <SettingsActionRow
        icon={status.localMode === "active" ? "stop.fill" : "play"}
        label={status.localMode === "active" ? "Pause access" : "Resume access"}
        disabled={busy || revoked}
        onPress={() => void act(status.localMode === "active" ? "pause" : "resume")}
      />
      <SettingsActionRow
        icon="arrow.clockwise"
        label="Refresh context"
        disabled={busy || status.localMode !== "active"}
        onPress={() => void act("refresh")}
      />
      <SettingsActionRow
        icon="xmark"
        label="Revoke here"
        tone="danger"
        disabled={busy || revoked}
        onPress={() =>
          Dialog.alert(
            "Revoke N2ITION access?",
            "This ends this environment’s access and clears its cached context. Reconnection requires a new owner setup.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Revoke", style: "destructive", onPress: () => void act("revoke") },
            ],
          )
        }
      />
    </SettingsSection>
  );
}
