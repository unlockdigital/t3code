import { HomeActivity } from "../components/home/HomeActivityOverview";
import { createFileRoute } from "@tanstack/react-router";
import { isElectron } from "../env";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";

function HomeRoute() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron}>
        <span className="text-sm font-medium">Home</span>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        <HomeActivity />
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/home")({ component: HomeRoute });
