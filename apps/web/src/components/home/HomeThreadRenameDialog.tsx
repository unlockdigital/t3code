import { useGT, T } from "gt-react";
import { useState } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

export function HomeThreadRenameDialog({
  thread,
  onClose,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const [title, setTitle] = useState(thread.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            const trimmed = title.trim();
            if (!trimmed) {
              setError(gt("Enter a thread title."));
              return;
            }
            if (trimmed === thread.title) {
              onClose();
              return;
            }
            setPending(true);
            void update({
              environmentId: thread.environmentId,
              input: { threadId: thread.id, title: trimmed },
            }).then((result) => {
              setPending(false);
              if (result._tag === "Failure") {
                const cause = squashAtomCommandFailure(result);
                setError(cause instanceof Error ? cause.message : gt("Rename failed. Try again."));
              } else onClose();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              <T>Rename thread</T>
            </DialogTitle>
            <DialogDescription>
              <T>Update the title shown in Home and the sidebar.</T>
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              aria-label={gt("Thread title")}
              value={title}
              disabled={pending}
              onChange={(event) => setTitle(event.target.value)}
            />
            {error && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" type="button" disabled={pending} onClick={onClose}>
              <T>Cancel</T>
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? gt("Saving…") : gt("Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
