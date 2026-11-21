import { useGT } from "gt-react";
import { createFileRoute } from "@tanstack/react-router";
import { UpstreamUpdatesSettings } from "../components/settings/UpstreamUpdatesSettings";
import { SettingsPageContainer, SettingsSection } from "../components/settings/settingsLayout";

function UpstreamUpdatesRoute() {
  const gt = useGT();
  return (
    <SettingsPageContainer>
      <SettingsSection title={gt("Upstream Updates")}>
        <UpstreamUpdatesSettings />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/_chat/settings/upstream-updates")({
  component: UpstreamUpdatesRoute,
});
