import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { ArrowLeftIcon, InfoIcon, XIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useEnvironment } from "../../state/environments";
import { projectBrief } from "../../state/projectBrief";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ProjectBriefController } from "./projectBriefController";

const BriefNavigation = createContext<{
  readonly open: () => void;
  readonly projectButton: React.RefObject<HTMLButtonElement | null>;
} | null>(null);

export function SidebarProjectBriefButton({ children }: { readonly children: ReactNode }) {
  const navigation = useContext(BriefNavigation);
  return (
    <button
      type="button"
      ref={navigation?.projectButton}
      aria-label={`View project brief for ${typeof children === "string" ? children : "this project"}`}
      onClick={navigation?.open}
      className="group/brief-link flex min-w-0 flex-1 flex-col items-start rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="max-w-full truncate text-foreground/75">{children}</span>
      <span className="hidden text-xs text-primary group-hover/brief-link:block group-focus-visible/brief-link:block pointer-coarse:block">
        View project brief
      </span>
    </button>
  );
}

function requestFailure(failure: unknown): Error {
  return failure instanceof Error && failure.message
    ? failure
    : new Error("Could not load the project brief. Check this environment’s connection and retry.");
}

export function SidebarThreadPopover({
  environmentId,
  projectId,
  project,
  metadata,
  disabled = false,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly project: EnvironmentProject | null;
  readonly metadata: ReactNode;
  readonly disabled?: boolean | undefined;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [persistent, setPersistent] = useState(false);
  const [view, setView] = useState<"metadata" | "brief">("metadata");
  const [contextFile, setContextFile] = useState<string | null>(null);
  const detailsRef = useRef<HTMLButtonElement>(null);
  const projectButton = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const contextId = useId();
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected";
  const canRead = useAtomValue(projectBrief.get.permissionAtom(environmentId));
  const canGenerate = useAtomValue(projectBrief.generate.permissionAtom(environmentId));
  const canClear = useAtomValue(projectBrief.clear.permissionAtom(environmentId));
  const get = useAtomCommand(projectBrief.get, { reportFailure: false });
  const generate = useAtomCommand(projectBrief.generate, { reportFailure: false });
  const clear = useAtomCommand(projectBrief.clear, { reportFailure: false });
  const configure = useAtomCommand(projectBrief.configure, { reportFailure: false });
  const [controller] = useState(
    () =>
      new ProjectBriefController(
        {
          get: async () => {
            const result = await get({ environmentId, input: { projectId } });
            if (result._tag === "Failure") throw requestFailure(squashAtomCommandFailure(result));
            return result.value;
          },
          generate: async () => {
            const result = await generate({ environmentId, input: { projectId } });
            if (result._tag === "Failure") throw requestFailure(squashAtomCommandFailure(result));
            return result.value;
          },
          clear: async () => {
            const result = await clear({ environmentId, input: { projectId } });
            if (result._tag === "Failure") throw requestFailure(squashAtomCommandFailure(result));
            return result.value;
          },
          configure: async (contextFile) => {
            const result = await configure({ environmentId, input: { projectId, contextFile } });
            if (result._tag === "Failure") throw requestFailure(squashAtomCommandFailure(result));
            return result.value;
          },
        },
        project?.briefState,
      ),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the external brief controller with the project cache.
  useEffect(() => controller.syncCached(project?.briefState), [controller, project?.briefState]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Move DOM focus when the popover changes its displayed view.
  useEffect(() => {
    if (view === "brief") headingRef.current?.focus();
    else if (persistent) projectButton.current?.focus();
  }, [view, persistent]);
  const saved = state.value?.saved;
  const busy = state.pending !== null;
  const showBrief = () => {
    setPersistent(true);
    setView("brief");
    if (connected && canRead) void controller.open(canGenerate);
  };
  const goBack = () => {
    setView("metadata");
  };
  const close = () => {
    setOpen(false);
    setPersistent(false);
    setView("metadata");
  };
  return (
    <BriefNavigation value={{ open: showBrief, projectButton }}>
      <Popover
        open={open && !disabled}
        onOpenChange={(next, details) => {
          // Navigation retains its click and keyboard behavior; the sibling
          // details trigger promotes the same hover surface to a persistent one.
          if (
            disabled ||
            (details.reason === "trigger-press" && details.trigger !== detailsRef.current) ||
            (!next && persistent && details.reason === "trigger-hover")
          ) {
            details.cancel();
            return;
          }
          if (next) {
            openerRef.current = details.trigger instanceof HTMLElement ? details.trigger : null;
            if (details.reason === "trigger-press") setPersistent(true);
          } else {
            setPersistent(false);
            setView("metadata");
          }
          setOpen(next);
        }}
      >
        <div className="group/sidebar-details flex min-w-0 items-center gap-0.5">
          <div className="min-w-0 flex-1">{children}</div>
          <PopoverTrigger
            ref={detailsRef}
            disabled={disabled}
            aria-label="Thread details"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            render={<Button size="icon-micro" variant="ghost-muted" />}
          >
            <InfoIcon aria-hidden />
          </PopoverTrigger>
        </div>
        <PopoverPopup
          side="right"
          align="start"
          sideOffset={4}
          width="md"
          padding="compact"
          initialFocus={persistent}
          finalFocus={() => openerRef.current ?? detailsRef.current}
          touchBackdrop={persistent}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {view === "metadata" ? (
            <>
              {persistent ? (
                <div className="flex justify-end">
                  <Button
                    size="icon-micro"
                    variant="ghost-muted"
                    aria-label="Close details"
                    onClick={close}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </div>
              ) : null}
              {metadata}
            </>
          ) : (
            <div className="flex min-w-0 flex-col gap-3 py-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <Button size="xs" variant="ghost-muted" onClick={goBack}>
                  <ArrowLeftIcon aria-hidden /> Back
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="Close project brief"
                  onClick={close}
                >
                  <XIcon aria-hidden />
                </Button>
              </div>
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="min-w-0 wrap-break-word font-medium outline-none"
              >
                {project?.title ?? "Project"} brief
              </h2>
              {saved ? (
                <p className="whitespace-pre-wrap wrap-break-word text-foreground">{saved.text}</p>
              ) : !busy && state.value ? (
                <p className="text-muted-foreground">
                  This project has no saved brief. Generate one from its selected sources.
                </p>
              ) : !busy ? (
                <p className="text-muted-foreground">
                  Saved brief status is unavailable. Connect to this environment and retry.
                </p>
              ) : null}
              {busy ? (
                <p role="status" className="text-muted-foreground">
                  {state.pending === "read"
                    ? "Reading saved brief…"
                    : state.pending === "generate"
                      ? "Generating project brief…"
                      : "Saving project brief changes…"}
                </p>
              ) : null}
              {!connected ? (
                <p role="status" className="text-muted-foreground">
                  Environment disconnected. Saved text remains available.
                </p>
              ) : null}
              {state.error ? (
                <p role="alert" className="text-error">
                  {state.error}
                </p>
              ) : null}
              {saved ? (
                <div className="grid gap-1 text-muted-foreground">
                  <span>Generated {new Date(saved.generatedAt).toLocaleString()}</span>
                  <span className="wrap-break-word">Sources: {saved.sources.join(", ")}</span>
                  <span className="wrap-break-word">Model: {saved.modelSelection.model}</span>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {state.value ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || !connected || !canGenerate}
                    onClick={() => void controller.generate()}
                  >
                    {saved ? "Refresh brief" : "Generate brief"}
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || !connected || !canRead}
                    onClick={() => void controller.open(canGenerate)}
                  >
                    Retry
                  </Button>
                )}
                {saved || state.pending === "generate" ? (
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    disabled={!connected || !canClear || state.pending === "clear"}
                    onClick={() => void controller.clear()}
                  >
                    Clear brief
                  </Button>
                ) : null}
              </div>
              {connected && !canGenerate ? (
                <p className="text-muted-foreground">
                  Generation requires filesystem read and project operation permissions.
                </p>
              ) : null}
              <p className="text-muted-foreground">
                Uses one documentation excerpt (up to 4 KB), sent to your project’s text-generation
                provider. Saved briefs are visible to authorized project readers.
              </p>
              <details className="text-muted-foreground">
                <summary className="cursor-pointer">README source</summary>
                <div className="mt-2 grid gap-2">
                  <label htmlFor={contextId}>
                    Canonical README to use instead of the root README
                  </label>
                  <Input
                    id={contextId}
                    size="compact"
                    placeholder="docs/README.md"
                    value={contextFile ?? state.value?.contextFile ?? ""}
                    onChange={(event) => setContextFile(event.target.value)}
                  />
                  <div>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy || !connected || !canClear || !state.value}
                      onClick={() =>
                        void controller.configure(
                          (contextFile ?? state.value?.contextFile ?? "").trim() || null,
                        )
                      }
                    >
                      Save source
                    </Button>
                  </div>
                  <p>
                    This file replaces the README. Use a README in the root, docs, or documentation
                    folder. Keep confidential details out of it. Recognizable credentials block
                    generation; financial or personal prose may still be sent. Saving clears the
                    brief until you generate again.
                  </p>
                </div>
              </details>
            </div>
          )}
        </PopoverPopup>
      </Popover>
    </BriefNavigation>
  );
}
