import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, UpstreamRequest, UpstreamStatus } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "../ui/button";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSearchTarget } from "./settingsLayout";

export function UpstreamUpdatesSettings() {
  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId;
  return (
    <SettingsSearchTarget id="upstream-updates">
      {environmentId &&
      environment?.serverConfig?.environment.capabilities.upstreamUpdates === true ? (
        <UpstreamEnvironmentPanel key={environmentId} environmentId={environmentId} />
      ) : (
        <SettingsRow
          title="Upstream Updates"
          description={
            environmentId
              ? "This environment requires a server build with the source upstream service. Packaged app updates remain available through the existing updater."
              : "Select one environment in the Settings filter to review its source releases and prepared candidates."
          }
        />
      )}
    </SettingsSearchTarget>
  );
}

function UpstreamEnvironmentPanel({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const allowed = useAtomValue(serverEnvironment.upstream.permissionAtom(environmentId));
  const execute = useAtomCommand(serverEnvironment.upstream);
  const [status, setStatus] = useState<UpstreamStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function run(input: UpstreamRequest) {
    if (!allowed) return;
    setBusy(true);
    const result = await execute({ environmentId, input });
    setBusy(false);
    const error = result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
    setFailure(
      error === null
        ? null
        : error instanceof Error
          ? error.message
          : "Upstream operation failed. Verify this environment has the configured source checkout and Git remotes.",
    );
    if (result._tag === "Success") setStatus(result.value);
  }
  const restore = useEffectEvent(() => {
    void run({ action: "read" });
  });
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Restore this environment's persisted source status on opening.
    if (allowed) restore();
  }, [allowed]);
  return (
    <div className="space-y-3">
      <SettingsRow
        title="Upstream Updates"
        description="Review official stable releases and prepare a separate source candidate for the selected environment."
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={!allowed || busy}
            onClick={() => void run({ action: "refresh" })}
          >
            {busy ? "Working…" : "Check upstream"}
          </Button>
        }
      />
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      {status && (
        <div className="space-y-3 px-3 text-sm">
          <p>
            Upstream release base: {status.baseTag} · <code>{status.baseCommit.slice(0, 12)}</code>{" "}
            · {status.customCommits} commits ahead
          </p>
          <p>Last successful release check: {status.checkedAt ?? "Never"}</p>
          {status.releaseError && <p role="alert">{status.releaseError}</p>}
          {status.latest && (
            <p>
              <a className="underline" href={status.latest.url} target="_blank" rel="noreferrer">
                Latest official stable: {status.latest.tag} · Release notes
              </a>{" "}
              · {status.updateAvailable ? "Update available" : "Up to date"}
            </p>
          )}
          {status.dirty && (
            <p>
              Local changes present. Commit or preserve them before preparing; candidates start from
              committed HEAD.
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={
              !allowed || busy || status.dirty || !status.updateAvailable || !!status.releaseError
            }
            onClick={() =>
              void run({
                action: "prepare",
                ...(status.latest ? { selectedTag: status.latest.tag } : {}),
              })
            }
          >
            Prepare update
          </Button>
          <p>
            Preparation creates a separate worktree and merges the official release with your custom
            commits. Review, test, and integrate it manually. The current app keeps running.
          </p>
          <details>
            <summary>Security and release evidence</summary>
            <div className="space-y-2 py-2">
              <p>Public advisories checked: {status.security.checkedAt ?? "Never"}</p>
              {status.security.error ? (
                <p role="alert">{status.security.error}</p>
              ) : status.security.checkedAt && status.security.advisories.length === 0 ? (
                <p>Successfully checked: no published upstream advisories returned.</p>
              ) : null}
              {status.security.advisories.map((item) => (
                <p key={item.url}>
                  <a className="underline" href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                  {item.fixes.map((fix) => (
                    <span className="block" key={fix}>
                      {fix}
                    </span>
                  ))}
                </p>
              ))}
              <p>
                <a
                  className="underline"
                  href={`https://github.com/${status.repository}/security/advisories`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Official security advisories
                </a>{" "}
                ·{" "}
                <a
                  className="underline"
                  href={`https://github.com/${status.fork}/security/dependabot`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Fork Dependabot alerts
                </a>
              </p>
              <p>
                Dependabot data is available through GitHub sign-in. This panel checks public
                upstream advisories. Review advisory fixed versions and release notes for available
                fixes; deployed-runtime applicability requires separate assessment.
              </p>
              <p>The existing daily release/security watch continues on its configured schedule.</p>
              {status.latest && (
                <>
                  <p>Security mentions in official {status.latest.tag} notes:</p>
                  {status.latest.securityNotes.length === 0 ? (
                    <p>
                      No security mentions found in these release notes. Review public advisories
                      separately.
                    </p>
                  ) : (
                    status.latest.securityNotes.map((note) => <p key={note}>{note}</p>)
                  )}
                  <p>Official {status.latest.tag} release notes (GitHub release evidence):</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {status.latest.notes || "Release has no notes."}
                  </pre>
                </>
              )}
            </div>
          </details>
          <details open={status.candidates.length > 0}>
            <summary>Prepared candidates ({status.candidates.length})</summary>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !allowed}
              onClick={() => void run({ action: "read" })}
            >
              Reload candidates
            </Button>
            {status.candidates.map((candidate) => (
              <div key={candidate.id} className="space-y-1 border-t py-3">
                <p>
                  {candidate.tag} · {candidate.status} · Awaiting verification
                </p>
                <p className="break-all">{candidate.path}</p>
                <p className="break-all">{candidate.branch}</p>
                <p>
                  Conflicts and local edits stay in the candidate for manual review. Clean up
                  removes an unchanged worktree and keeps its branch for recovery.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !allowed || candidate.status !== "clean"}
                  onClick={() => void run({ action: "cleanup", candidateId: candidate.id })}
                >
                  Clean up unused candidate
                </Button>
              </div>
            ))}
          </details>
        </div>
      )}
    </div>
  );
}
