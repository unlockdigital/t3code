import { createFileRoute } from "@tanstack/react-router";
import { UpstreamUpdatesSettings } from "../components/settings/UpstreamUpdatesSettings";
import { SettingsPageContainer, SettingsSection } from "../components/settings/settingsLayout";

function UpstreamUpdatesRoute() {
  return (
    <SettingsPageContainer>
      <SettingsSection title="Upstream Updates">
        <UpstreamUpdatesSettings />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/upstream-updates")({
  component: UpstreamUpdatesRoute,
});
