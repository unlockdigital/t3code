import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, UpstreamRequest, UpstreamStatus } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useEffectEvent, useState } from "react";
import { Linking, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsActionRow } from "./components/SettingsActionRow";
import { SettingsSection } from "./components/SettingsSection";

export function UpstreamUpdatesSection({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
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
          : "Verify this environment's source checkout and Git remotes.",
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
    <SettingsSection title="Upstream updates">
      <SettingsActionRow
        icon="arrow.clockwise"
        label="Check upstream"
        description="Official stable release and public advisories for this environment's source checkout."
        disabled={!allowed || busy}
        loading={busy}
        onPress={() => void run({ action: "refresh" })}
      />
      {failure && <Text className="px-4 py-2 text-sm text-danger-foreground">{failure}</Text>}
      {status && (
        <>
          <View className="gap-2 p-4">
            <Text selectable className="text-sm text-foreground">
              Base {status.baseTag} ({status.baseCommit.slice(0, 12)}) · {status.customCommits}{" "}
              commits ahead
            </Text>
            <Text className="text-sm text-foreground-muted">
              Checked: {status.checkedAt ?? "Never"} ·{" "}
              {status.latest
                ? status.updateAvailable
                  ? `Available: ${status.latest.tag}`
                  : "Up to date"
                : "Release unavailable"}
            </Text>
            {status.releaseError && (
              <Text className="text-sm text-danger-foreground">{status.releaseError}</Text>
            )}
            {status.dirty && (
              <Text className="text-sm text-foreground-muted">
                Commit or preserve local changes before preparing from HEAD.
              </Text>
            )}
            <Text className="text-sm text-foreground-muted">
              Candidates await verification and manual integration. The current app keeps running.
            </Text>
            <Text className="text-sm text-foreground-muted">
              Public advisory check: {status.security.checkedAt ?? "Never"}.{" "}
              {status.security.error ??
                (status.security.checkedAt && status.security.advisories.length === 0
                  ? "Successfully checked: no published upstream advisories returned."
                  : "Review published advisories below.")}
            </Text>
            <Text className="text-sm text-foreground-muted">
              Dependabot alerts require GitHub sign-in. Assess deployed-runtime applicability
              separately. The daily watch keeps its existing schedule.
            </Text>
            {status.latest?.securityNotes.map((note) => (
              <Text key={note} selectable className="text-sm text-foreground">
                Release-note security mention: {note}
              </Text>
            ))}
          </View>
          {status.latest && (
            <SettingsActionRow
              icon="link"
              label={`${status.latest.tag} release notes`}
              onPress={() => void Linking.openURL(status.latest!.url).catch(() => undefined)}
            />
          )}
          <SettingsActionRow
            icon="arrow.up.circle"
            label="Prepare update candidate"
            disabled={
              !allowed || busy || status.dirty || !status.updateAvailable || !!status.releaseError
            }
            onPress={() =>
              void run({
                action: "prepare",
                ...(status.latest ? { selectedTag: status.latest.tag } : {}),
              })
            }
          />
          {status.security.advisories.map((advisory) => (
            <SettingsActionRow
              key={advisory.url}
              icon="link"
              label={advisory.title}
              description={advisory.fixes.join("; ")}
              onPress={() => void Linking.openURL(advisory.url).catch(() => undefined)}
            />
          ))}
          <SettingsActionRow
            icon="link"
            label="Fork Dependabot alerts"
            onPress={() =>
              void Linking.openURL(`https://github.com/${status.fork}/security/dependabot`).catch(
                () => undefined,
              )
            }
          />
          <SettingsActionRow
            icon="link"
            label="Official security advisories"
            onPress={() =>
              void Linking.openURL(
                `https://github.com/${status.repository}/security/advisories`,
              ).catch(() => undefined)
            }
          />
          <SettingsActionRow
            icon="arrow.clockwise"
            label="Reload saved candidates"
            disabled={!allowed || busy}
            onPress={() => void run({ action: "read" })}
          />
          {status.candidates.map((candidate) => (
            <View key={candidate.id}>
              <View className="gap-1 p-4">
                <Text className="text-sm text-foreground">
                  {candidate.tag} · {candidate.status} · Awaiting verification
                </Text>
                <Text selectable className="text-xs text-foreground-muted">
                  {candidate.path}
                  {"\n"}
                  {candidate.branch}
                </Text>
                <Text className="text-sm text-foreground-muted">
                  Cleanup keeps the branch for recovery and preserves worktrees with edits, ignored
                  files or later commits. Conflicts remain available for review.
                </Text>
              </View>
              <SettingsActionRow
                icon="trash"
                label="Clean up unused candidate"
                disabled={!allowed || busy || candidate.status !== "clean"}
                onPress={() => void run({ action: "cleanup", candidateId: candidate.id })}
              />
            </View>
          ))}
        </>
      )}
    </SettingsSection>
  );
}
