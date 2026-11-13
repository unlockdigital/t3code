import { SidebarAgentNavigation } from "./SidebarAgentNavigation";
import { Link, useLocation } from "@tanstack/react-router";
import { HouseIcon } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

export function SidebarHomeNavigation() {
  const { setOpenMobile } = useSidebar();
  const active = useLocation({ select: (location) => location.pathname === "/home" });
  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            render={<Link to="/home" onClick={() => setOpenMobile(false)} />}
            isActive={active}
          >
            <HouseIcon />
            <span>Home</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarAgentNavigation />
    </>
  );
}
