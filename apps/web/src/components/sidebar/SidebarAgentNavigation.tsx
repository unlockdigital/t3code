import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { selectAgentAutoTargets } from "./agentPermissions";
import { createAgentShortcutActions } from "./agentShortcut";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Link, useLocation } from "@tanstack/react-router";
import { PencilIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  persistClientSettingsUpdate,
  useClientSettings,
  useClientSettingsHydrated,
} from "../../hooks/useSettings";
import { useEnvironmentIdentities } from "../../state/environments";
import { AuthOrchestrationOperateScope, AuthSettingsWriteScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useUiStateStore } from "../../uiStateStore";
import { resolveAgentStatus } from "./agentStatus";
import { useQuietThreadShell, useQuietThreadShells } from "../../state/entities";
import { buildThreadRouteParams, isThreadRoutePathname } from "../../threadRoutes";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

function TeddyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="5" cy="6" r="3" />
      <circle cx="19" cy="6" r="3" />
      <rect x="3" y="6" width="18" height="15" rx="6" fill="var(--color-sidebar)" />
      <path d="M12 6V3m-1-1h2" />
      <rect x="6.5" y="10" width="11" height="5" rx="2" />
      <path d="M9 12.5h.01M15 12.5h.01M10 18h4" />
    </svg>
  );
}

export function SidebarAgentNavigation() {
  const shortcut = useClientSettings((settings) => settings.agentShortcut ?? null);
  const hydrated = useClientSettingsHydrated();
  const { setOpenMobile } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actions] = useState(() => createAgentShortcutActions(shortcut));
  useEffect(() => {
    actions.syncShortcut(shortcut);
  }, [actions, shortcut]);
  const active = shortcut !== null && isThreadRoutePathname(pathname, shortcut);
  const name = shortcut?.name ?? "Teddy";

  return (
    <>
      <SidebarMenu aria-label="Personal agent">
        <SidebarMenuItem>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SidebarMenuButton
                render={
                  shortcut ? (
                    <Link
                      to="/$environmentId/$threadId"
                      params={buildThreadRouteParams(shortcut)}
                      onClick={() => setOpenMobile(false)}
                    />
                  ) : undefined
                }
                onClick={shortcut ? undefined : () => setOpen(true)}
                disabled={!hydrated}
                isActive={active}
                title={shortcut ? `Open ${name}` : "Choose Teddy’s conversation"}
              >
                <TeddyIcon />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {shortcut && <AgentStatus threadRef={shortcut} />}
              </SidebarMenuButton>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Customize ${name}`}
              title="Change name or conversation"
              onClick={() => setOpen(true)}
              disabled={!hydrated}
            >
              <PencilIcon />
            </Button>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!actions.isSaving()) setOpen(value);
        }}
      >
        {open && (
          <AgentShortcutEditor
            onClose={() => setOpen(false)}
            actions={actions}
            saving={saving}
            setSaving={setSaving}
          />
        )}
      </Dialog>
    </>
  );
}

function AgentShortcutEditor({
  onClose,
  actions,
  saving,
  setSaving,
}: {
  onClose: () => void;
  actions: ReturnType<typeof createAgentShortcutActions>;
  saving: boolean;
  setSaving: (saving: boolean) => void;
}) {
  const shortcut = useClientSettings((settings) => settings.agentShortcut ?? null);
  const removeCoordinator = useAtomCommand(serverEnvironment.setApprovalCoordinator, {
    reportFailure: false,
  });
  const threads = useQuietThreadShells();
  const environments = useEnvironmentIdentities();
  const [name, setName] = useState(shortcut?.name ?? "Teddy");
  const [selected, setSelected] = useState(shortcut ? scopedThreadKey(shortcut) : "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const choices = threads.map((thread) => ({
    environmentId: thread.environmentId,
    threadId: thread.id,
    label: thread.title,
  }));
  // Retain the identity during disconnects and when the thread leaves the shell's recent window.
  if (
    shortcut &&
    !choices.some((choice) => scopedThreadKey(choice) === scopedThreadKey(shortcut))
  ) {
    choices.unshift({ ...shortcut, label: shortcut.name });
  }
  const choice = choices.find((item) => scopedThreadKey(item) === selected);
  const matching = choices.filter((item) =>
    item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const save = async (clear = false) => {
    const next = clear
      ? null
      : choice
        ? { environmentId: choice.environmentId, threadId: choice.threadId, name: name.trim() }
        : undefined;
    if (next === undefined || (next !== null && !next.name) || actions.isSaving()) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await actions.save(
        shortcut,
        next,
        async (ref) => {
          const result = await removeCoordinator({
            environmentId: ref.environmentId,
            input: { threadId: ref.threadId, enabled: false },
          });
          if (result._tag === "Failure") throw new Error("Coordinator revocation failed");
        },
        async (value) => {
          await persistClientSettingsUpdate((current) => ({ ...current, agentShortcut: value }));
        },
      );
      if (saved) onClose();
    } catch {
      setError(
        "Could not revoke the previous agent’s approval authority or save the shortcut. Check the environment connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>Your agent</DialogTitle>
        <DialogDescription>
          A permanent place below Home. Choose a name and an existing conversation. This shortcut is
          saved on this device.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Name</span>
              <Input
                value={name}
                maxLength={80}
                required
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Find a conversation</span>
              <Input
                type="search"
                placeholder="Search conversation titles"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <Select value={selected || null} onValueChange={(value) => setSelected(value ?? "")}>
              <SelectTrigger aria-label="Agent conversation">
                <SelectValue>{choice?.label ?? "Choose a conversation"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {matching.map((item) => (
                  <SelectItem key={scopedThreadKey(item)} value={scopedThreadKey(item)}>
                    {item.label}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {environments.find(
                        (environment) => environment.environmentId === item.environmentId,
                      )?.label ?? "Disconnected environment"}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {matching.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No matching conversations. Open the conversation in T3, then return here.
              </p>
            )}
            {shortcut && <AgentAutoPermissions threadRef={shortcut} />}
            {shortcut && (
              <AgentApprovalAuthority threadRef={shortcut} actions={actions} saving={saving} />
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          {shortcut && (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => void save(true)}>
              Reset shortcut
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim() || !choice}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </DialogPopup>
  );
}

function AgentStatus({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useQuietThreadShell(threadRef);
  const key = scopedThreadKey(threadRef);
  const localVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[key]);
  const status = resolveAgentStatus(thread, localVisitedAt);
  return (
    <span
      role="status"
      className={`inline-flex shrink-0 items-center gap-1 text-xs ${status.color}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {status.label}
    </span>
  );
}

function AgentApprovalAuthority({
  threadRef,
  actions,
  saving,
}: {
  threadRef: ScopedThreadRef;
  actions: ReturnType<typeof createAgentShortcutActions>;
  saving: boolean;
}) {
  const granted = useEnvironmentSettings(
    threadRef.environmentId,
    (settings) => settings.approvalCoordinatorThreadIds ?? [],
  );
  const update = useAtomCommand(serverEnvironment.setApprovalCoordinator);
  const writable = useEnvironmentScope(threadRef.environmentId, AuthSettingsWriteScope);
  const enabled = granted.includes(threadRef.threadId);
  return (
    <div className="flex items-start gap-3">
      <Switch
        aria-label="Review routine approvals"
        checked={enabled}
        disabled={!writable || saving}
        onCheckedChange={(checked) =>
          void actions.approval(threadRef, async () => {
            await update({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, enabled: checked },
            });
          })
        }
      />
      <div className="space-y-1 text-sm">
        <p className="font-medium">Review routine approvals</p>
        <p className="text-muted-foreground">
          Applies immediately to this agent’s own assignments. Reads, searches, tests and reversible
          edits can be approved one at a time. Publishing, deletion, spending, credentials,
          permission changes and private-data sharing come to you.
        </p>
      </div>
    </div>
  );
}

function AgentAutoPermissions({ threadRef }: { threadRef: ScopedThreadRef }) {
  const threads = useQuietThreadShells();
  const agent = useQuietThreadShell(threadRef);
  const writable = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const setMode = useOrchestrationCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targets = selectAgentAutoTargets(threads, threadRef);
  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      for (const thread of targets) {
        const result = await setMode({
          environmentId: threadRef.environmentId,
          input: {
            threadId: thread.id,
            runtimeMode: "auto",
            createdAt: new Date().toISOString(),
          },
        });
        if (result._tag === "Failure") {
          setError(
            `Could not change ${thread.title}. Earlier changes were saved; retry to finish.`,
          );
          return;
        }
      }
    } catch {
      setError("Could not finish changing permissions. Retry to finish the remaining threads.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">Sub-agent permissions</p>
      <p className="text-muted-foreground">
        Auto lets the provider review routine actions. Apply it to this agent and its existing
        direct sub-agents; future sub-agents inherit it. Providers without Auto support can still
        ask. Existing approval cards may need one final response. Change an individual thread’s mode
        in its composer.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={!writable || !agent || saving || targets.length === 0}
        onClick={() => void apply()}
      >
        {saving
          ? "Applying Auto…"
          : targets.length === 0 && agent
            ? "Agent and sub-agents use Auto"
            : "Use Auto for agent and sub-agents"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
