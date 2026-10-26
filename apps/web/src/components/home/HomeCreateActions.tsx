import { useAtomValue } from "@effect/atom-react";
import { FolderPlusIcon, SquarePenIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { shortcutLabelForCommand } from "../../keybindings";
import { startNewThreadFromContext } from "../../lib/chatThreadActions";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { shouldCreateNewThreadInCurrentProject } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function HomeCreateActions() {
  const context = useHandleNewThread();
  const projectGroups = useSidebarProjectGroups();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    (projectGroups.length <= 1 ? shortcutLabelForCommand(keybindings, "chat.newLocal") : null);
  const localShortcut = shortcutLabelForCommand(keybindings, "chat.newLocal");
  const createThread = (event: MouseEvent) => {
    if (!shouldCreateNewThreadInCurrentProject(event.shiftKey, projectGroups.length)) {
      openCommandPalette({ open: "new-thread-in" });
      return;
    }
    void startNewThreadFromContext({
      activeDraftThread: context.activeDraftThread,
      activeThread: context.activeThread ?? undefined,
      defaultProjectRef: context.defaultProjectRef,
      handleNewThread: context.handleNewThread,
    }).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not start a thread",
        description: error instanceof Error ? error.message : "Try creating the thread again.",
      });
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              disabled={projectGroups.length === 0}
              onClick={createThread}
              aria-label="New thread"
            />
          }
        >
          <SquarePenIcon />
          New thread
          {shortcut && (
            <span aria-hidden className="hidden sm:inline-flex">
              <Kbd>{shortcut}</Kbd>
            </span>
          )}
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {projectGroups.length > 1
            ? `Shift+click to use the current project${localShortcut ? ` (${localShortcut})` : ""}`
            : projectGroups.length === 0
              ? "Add a project to start a thread"
              : shortcut
                ? `New thread (${shortcut})`
                : "New thread"}
        </TooltipPopup>
      </Tooltip>
      <Button
        size="sm"
        variant="outline"
        onClick={() => openCommandPalette({ open: "add-project" })}
      >
        <FolderPlusIcon />
        Add project
      </Button>
    </div>
  );
}
