import { useGT, T } from "gt-react";
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
  const gt = useGT();
  const navigation = useContext(BriefNavigation);
  return (
    <button
      type="button"
      ref={navigation?.projectButton}
      aria-label={gt("View project brief for {value1}", {
        value1: typeof children === "string" ? children : "this project",
      })}
      onClick={navigation?.open}
      className="group/brief-link flex min-w-0 flex-1 flex-col items-start rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="max-w-full truncate text-foreground/75">{children}</span>
      <span className="hidden text-xs text-primary group-hover/brief-link:block group-focus-visible/brief-link:block pointer-coarse:block">
        <T>View project brief</T>
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
  const gt = useGT();
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
            aria-label={gt("Thread details")}
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
                    aria-label={gt("Close details")}
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
                  <ArrowLeftIcon aria-hidden /> <T>Back</T>
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={gt("Close project brief")}
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
                {project?.title ?? gt("Project")} brief
              </h2>
              {saved ? (
                <p className="whitespace-pre-wrap wrap-break-word text-foreground">{saved.text}</p>
              ) : !busy && state.value ? (
                <p className="text-muted-foreground">
                  <T>This project has no saved brief. Generate one from its selected sources.</T>
                </p>
              ) : !busy ? (
                <p className="text-muted-foreground">
                  <T>Saved brief status is unavailable. Connect to this environment and retry.</T>
                </p>
              ) : null}
              {busy ? (
                <p role="status" className="text-muted-foreground">
                  {state.pending === "read"
                    ? gt("Reading saved brief…")
                    : state.pending === "generate"
                      ? gt("Generating project brief…")
                      : gt("Saving project brief changes…")}
                </p>
              ) : null}
              {!connected ? (
                <p role="status" className="text-muted-foreground">
                  <T>Environment disconnected. Saved text remains available.</T>
                </p>
              ) : null}
              {state.error ? (
                <p role="alert" className="text-error">
                  {state.error}
                </p>
              ) : null}
              {saved ? (
                <div className="grid gap-1 text-muted-foreground">
                  <span>
                    <T>Generated</T> {new Date(saved.generatedAt).toLocaleString()}
                  </span>
                  <span className="wrap-break-word">
                    <T>Sources:</T> {saved.sources.join(", ")}
                  </span>
                  <span className="wrap-break-word">
                    <T>Model:</T> {saved.modelSelection.model}
                  </span>
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
                    {saved ? gt("Refresh brief") : gt("Generate brief")}
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || !connected || !canRead}
                    onClick={() => void controller.open(canGenerate)}
                  >
                    <T>Retry</T>
                  </Button>
                )}
                {saved || state.pending === "generate" ? (
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    disabled={!connected || !canClear || state.pending === "clear"}
                    onClick={() => void controller.clear()}
                  >
                    <T>Clear brief</T>
                  </Button>
                ) : null}
              </div>
              {connected && !canGenerate ? (
                <p className="text-muted-foreground">
                  <T>Generation requires filesystem read and project operation permissions.</T>
                </p>
              ) : null}
              <p className="text-muted-foreground">
                <T>
                  Uses one documentation excerpt (up to 4 KB), sent to your project’s
                  text-generation provider. Saved briefs are visible to authorized project readers.
                </T>
              </p>
              <details className="text-muted-foreground">
                <summary className="cursor-pointer">
                  <T>README source</T>
                </summary>
                <div className="mt-2 grid gap-2">
                  <label htmlFor={contextId}>
                    <T>Canonical README to use instead of the root README</T>
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
                      <T>Save source</T>
                    </Button>
                  </div>
                  <p>
                    <T>
                      This file replaces the README. Use a README in the root, docs, or
                      documentation folder. Keep confidential details out of it. Recognizable
                      credentials block generation; financial or personal prose may still be sent.
                      Saving clears the brief until you generate again.
                    </T>
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
