import { useAtomValue } from "@effect/atom-react";
import type { N2itionStatus } from "@t3tools/contracts/n2itionConnection";
import { useEffect, useEffectEvent, useState } from "react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsSection } from "./settingsLayout";

export function N2itionSettings() {
  const { environment, scope } = useSettingsScope();
  if (scope.kind !== "environment" || !environment)
    return (
      <SettingsSection title="Teddy · N2ITION" id="n2ition">
        <p>Choose an environment to inspect Teddy’s CRM connection.</p>
      </SettingsSection>
    );
  return <N2itionConnection key={environment.environmentId} />;
}
function N2itionConnection() {
  const { environment } = useSettingsScope();
  const environmentId = environment!.environmentId;
  const allowed = useAtomValue(serverEnvironment.n2itionControl.permissionAtom(environmentId));
  const getStatus = useAtomCommand(serverEnvironment.n2itionStatus, { reportFailure: false });
  const control = useAtomCommand(serverEnvironment.n2itionControl, { reportFailure: false });
  const refresh = useAtomCommand(serverEnvironment.n2itionRefresh, { reportFailure: false });
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
      setError("Connection status unavailable. Check this environment’s connection and try again.");
  });
  useEffect(() => {
    if (!allowed) return;
    // oxlint-disable-next-line react/set-state-in-effect -- The owner RPC updates state after its response arrives.
    void check();
    const timer = setInterval(() => void check(), 30000);
    return () => clearInterval(timer);
  }, [allowed]);
  const act = async (action: "pause" | "resume" | "revoke" | "refresh") => {
    if (!status || status.epoch === null) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        action === "refresh"
          ? await refresh({ environmentId, input: {} })
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
          "The action could not finish. Refresh status to see whether access is paused, expired or requires attention in N2ITION.",
        );
    } catch {
      setError(
        "The action could not finish. Refresh status to see whether access is paused, expired or requires attention in N2ITION.",
      );
    }
    setBusy(false);
  };
  return (
    <SettingsSection title="Teddy · N2ITION" id="n2ition">
      <div className="space-y-3">
        <p>
          Read-only task context for conversations with Teddy. All task categories and notes are
          included in the approved connection.
        </p>
        {!allowed ? (
          <p>Settings access is required to view or control this connection.</p>
        ) : status ? (
          <>
            <p role="status">
              <strong>{status.state.replaceAll("_", " ")}</strong>
              {status.source
                ? ` · ${status.source === "synthetic" ? "Made-up test tasks" : "N2ITION tasks"}`
                : ""}
            </p>
            <p>
              Last checked:{" "}
              {status.lastCheckedAt
                ? new Date(status.lastCheckedAt).toLocaleString()
                : "No successful reads yet"}
              . Tasks: {status.taskCount}.
            </p>
            {status.cadenceHours && (
              <p>
                Checks every {status.cadenceHours} hour(s) while this environment is running.
                Current questions trigger a fresh read.
              </p>
            )}
            {status.state === "disabled" && (
              <p>The connection has not been configured in this environment.</p>
            )}
            {status.lastError && (
              <p>
                Latest issue: {status.lastError.replaceAll("_", " ")}. Access may also be paused or
                revoked in N2ITION’s settings.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || status.epoch === null || status.localMode === "revoked"}
                onClick={() => void act(status.localMode === "paused" ? "resume" : "pause")}
              >
                {status.localMode === "paused" ? "Resume here" : "Pause here"}
              </Button>
              <Button
                variant="outline"
                disabled={busy || status.localMode !== "active"}
                onClick={() => void act("refresh")}
              >
                Refresh context
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void check()}>
                Check status
              </Button>
              <Button
                variant="destructive"
                disabled={busy || status.epoch === null || status.localMode === "revoked"}
                onClick={() => setConfirm(true)}
              >
                Revoke here
              </Button>
            </div>
            {confirm && (
              <div role="alert">
                <p>
                  Revoking ends this environment’s access and clears cached context. Reconnection
                  requires a new owner-approved setup. Existing conversations retain information
                  under their own retention settings.
                </p>
                <div className="flex gap-2">
                  <Button variant="destructive" disabled={busy} onClick={() => void act("revoke")}>
                    Confirm revocation
                  </Button>
                  <Button variant="outline" onClick={() => setConfirm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <p>
              Last 30 days: {status.usage.reads} context reads · {status.usage.notesReads} reads
              with notes · {status.usage.refreshes} refreshes · {status.usage.failures} failures.
              Background AI calls: 0.
            </p>
            <p>
              Usage counts stay in this environment and contain no task text. Sleeping or
              disconnected computers can miss checks; Teddy will identify unavailable context when
              you ask.
            </p>
          </>
        ) : (
          <p>Checking connection…</p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </SettingsSection>
  );
}
