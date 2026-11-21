import { useGT, T } from "gt-react";
import { useAtomValue } from "@effect/atom-react";
import type { N2itionStatus } from "@t3tools/contracts/n2itionConnection";
import { useEffect, useEffectEvent, useState } from "react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsSection } from "./settingsLayout";

export function N2itionSettings() {
  const gt = useGT();
  const { environment, scope } = useSettingsScope();
  if (scope.kind !== "environment" || !environment)
    return (
      <SettingsSection title={gt("Teddy · N2ITION")} id="n2ition">
        <p>
          <T>Choose an environment to inspect Teddy’s CRM connection.</T>
        </p>
      </SettingsSection>
    );
  return <N2itionConnection key={environment.environmentId} />;
}
function N2itionConnection() {
  const gt = useGT();
  const { environment } = useSettingsScope();
  const environmentId = environment!.environmentId;
  const allowed = useAtomValue(serverEnvironment.n2itionControl.permissionAtom(environmentId));
  const getStatus = useAtomCommand(serverEnvironment.n2itionStatus, { reportFailure: false });
  const control = useAtomCommand(serverEnvironment.n2itionControl, { reportFailure: false });
  const refresh = useAtomCommand(serverEnvironment.n2itionRefresh, { reportFailure: false });
  const reconnect = useAtomCommand(serverEnvironment.n2itionReconnect, { reportFailure: false });
  const [status, setStatus] = useState<N2itionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const check = useEffectEvent(async () => {
    if (!allowed) return;
    const result = await getStatus({ environmentId, input: {} });
    if (result._tag === "Success") {
      setStatus((previous) =>
        previous?.epoch !== null &&
        previous?.epoch !== undefined &&
        result.value.epoch !== null &&
        previous.epoch > result.value.epoch
          ? previous
          : result.value,
      );
      setError(null);
    } else
      setError(
        gt("Connection status unavailable. Check this environment’s connection and try again."),
      );
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep owner connection status synchronized with the remote environment while its settings page is mounted.
  useEffect(() => {
    if (!allowed) return;
    // oxlint-disable-next-line react/set-state-in-effect -- The owner RPC updates state after its response arrives.
    void check();
    const timer = setInterval(() => void check(), 30000);
    return () => clearInterval(timer);
  }, [allowed]);
  const act = async (action: "pause" | "resume" | "revoke" | "refresh" | "reconnect") => {
    if (!status || status.epoch === null) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        action === "refresh"
          ? await refresh({ environmentId, input: {} })
          : action === "reconnect"
            ? await reconnect({ environmentId, input: { expectedEpoch: status.epoch } })
            : await control({ environmentId, input: { action, expectedEpoch: status.epoch } });
      if (result._tag === "Success") {
        setStatus((previous) =>
          previous?.epoch !== null &&
          previous?.epoch !== undefined &&
          result.value.epoch !== null &&
          previous.epoch > result.value.epoch
            ? previous
            : result.value,
        );
        setConfirm(false);
      } else
        setError(
          gt(
            "The action could not finish. Refresh status to see whether access is paused, expired or requires attention in N2ITION.",
          ),
        );
    } catch {
      setError(
        gt(
          "The action could not finish. Refresh status to see whether access is paused, expired or requires attention in N2ITION.",
        ),
      );
    }
    setBusy(false);
  };
  return (
    <SettingsSection title={gt("Teddy · N2ITION")} id="n2ition">
      <div className="space-y-3">
        <p>
          <T>
            Read-only task context for conversations with Teddy. All task categories and notes are
            included in the approved connection.
          </T>
        </p>
        {!allowed ? (
          <p>
            <T>Settings access is required to view or control this connection.</T>
          </p>
        ) : status ? (
          <>
            <p role="status">
              <strong>{status.state.replaceAll("_", " ")}</strong>
              {status.source
                ? ` · ${status.source === "synthetic" ? "Made-up test tasks" : "N2ITION tasks"}`
                : ""}
            </p>
            <p>
              <T>Last checked:</T>{" "}
              {status.lastCheckedAt
                ? new Date(status.lastCheckedAt).toLocaleString()
                : gt("No successful reads yet")}
              <T>. Tasks:</T> {status.state === "connected" ? status.taskCount : "unverified"}.
            </p>
            {status.cadenceHours && (
              <p>
                <T>Checks every</T> {status.cadenceHours}{" "}
                <T>
                  hour(s) while this environment is running. Current questions trigger a fresh read.
                </T>
              </p>
            )}
            {status.state === "disabled" && (
              <p>
                <T>The connection has not been configured in this environment.</T>
              </p>
            )}
            {status.lastError && (
              <p>
                <T>Latest issue:</T> {status.lastError.replaceAll("_", " ")}
                <T>. Access may also be paused or revoked in N2ITION’s settings.</T>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || status.epoch === null || status.localMode === "revoked"}
                onClick={() => void act(status.localMode === "paused" ? "resume" : "pause")}
              >
                {status.localMode === "paused" ? gt("Resume here") : gt("Pause here")}
              </Button>
              <Button
                variant="outline"
                disabled={busy || status.localMode !== "active"}
                onClick={() => void act("refresh")}
              >
                <T>Refresh context</T>
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void check()}>
                <T>Check status</T>
              </Button>
              <Button
                variant="outline"
                disabled={busy || status.epoch === null || status.localMode === "revoked"}
                onClick={() => void act("reconnect")}
              >
                <T>Verify and reconnect</T>
              </Button>
              <Button
                variant="destructive"
                disabled={busy || status.epoch === null || status.localMode === "revoked"}
                onClick={() => setConfirm(true)}
              >
                <T>Revoke here</T>
              </Button>
            </div>
            {confirm && (
              <div role="alert">
                <p>
                  <T>
                    Revoking ends this environment’s access and clears cached context. Reconnection
                    requires a new owner-approved setup. Existing conversations retain information
                    under their own retention settings.
                  </T>
                </p>
                <div className="flex gap-2">
                  <Button variant="destructive" disabled={busy} onClick={() => void act("revoke")}>
                    <T>Confirm revocation</T>
                  </Button>
                  <Button variant="outline" onClick={() => setConfirm(false)}>
                    <T>Cancel</T>
                  </Button>
                </div>
              </div>
            )}
            <p>
              <T>Last 30 days:</T> {status.usage.reads} <T>context reads ·</T>{" "}
              {status.usage.notesReads} <T>reads with notes ·</T> {status.usage.refreshes}{" "}
              <T>refreshes ·</T> {status.usage.failures} <T>failures. Background AI calls: 0.</T>
            </p>
            <p>
              <T>
                Usage counts stay in this environment and contain no task text. Sleeping or
                disconnected computers can miss checks; Teddy will identify unavailable context when
                you ask.
              </T>
            </p>
          </>
        ) : (
          <p>
            <T>Checking connection…</T>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </SettingsSection>
  );
}
