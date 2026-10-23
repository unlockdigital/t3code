import type {
  EnvironmentId,
  PrivateHelperPacket,
  PrivateHelpersPolicy,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { LockKeyholeIcon } from "lucide-react";
import { useState } from "react";
import { serverEnvironment } from "../../state/server";
import { useEnvironments } from "../../state/environments";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";

export function PrivateControls(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  policy: PrivateHelpersPolicy;
  canOperate: boolean;
}) {
  const { environments } = useEnvironments();
  const [open, setOpen] = useState(false);
  const [packets, setPackets] = useState<readonly PrivateHelperPacket[]>([]);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const load = useAtomCommand(serverEnvironment.getPrivateHelperState);
  const decide = useAtomCommand(serverEnvironment.decidePrivateHelper);
  const update = useOrchestrationCommand(threadEnvironment.updateMetadata);
  const refresh = async () => {
    const result = await load({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    });
    if (AsyncResult.isSuccess(result)) setPackets(result.value.packets);
  };
  const decision = async (packet: PrivateHelperPacket, value: "approve" | "block") => {
    setBusy(true);
    try {
      const result = await decide({
        environmentId: props.environmentId,
        input: {
          threadId: props.threadId,
          packetId: packet.id,
          digest: packet.digest,
          decision: value,
        },
      });
      if (AsyncResult.isSuccess(result))
        setPackets((current) =>
          current.map((entry) => (entry.id === packet.id ? result.value : entry)),
        );
      setReviewed(null);
    } finally {
      setBusy(false);
    }
  };
  if (
    !environments.find((environment) => environment.environmentId === props.environmentId)
      ?.serverConfig?.environment.capabilities.privateWorkflow
  )
    return null;
  return (
    <>
      <ComposerControl
        aria-label="Private controls"
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
      >
        <ComposerControlIcon icon={LockKeyholeIcon} />
        <span data-composer-control-label>
          {props.policy === "disabled" ? "Private" : "Private + helpers"}
        </span>
      </ComposerControl>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Private controls</DialogTitle>
            <DialogDescription>
              Full conversation context uses the approved Tinfoil connection. Helpers receive only a
              packet you review and approve. Start a fresh Standard conversation to change this
              thread’s routing policy.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="min-w-0">
            <label className="grid gap-2 text-sm">
              External coding helpers
              <Select
                value={props.policy}
                onValueChange={(value) => {
                  if (value === "disabled" || value === "review")
                    void update({
                      environmentId: props.environmentId,
                      input: { threadId: props.threadId, privateHelpers: value },
                    });
                }}
                disabled={!props.canOperate || busy}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="disabled">Private only</SelectItem>
                  <SelectItem value="review">Private + helpers · review every packet</SelectItem>
                </SelectPopup>
              </Select>
            </label>
            <p className="text-sm text-muted-foreground">
              Helpers return code for private review. They receive no parent history, workspace,
              tools, T3 access, or credentials. Their provider’s data terms apply to the approved
              packet. Auto action permissions stay separate.
            </p>
            <div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
                Refresh helper packets
              </Button>
            </div>
            {packets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Your private coordinator can prepare a self-contained helper packet. Pending reviews
                expire after 15 minutes or a server restart.
              </p>
            ) : null}
            {packets.map((packet) => (
              <article key={packet.id} className="grid min-w-0 gap-3 rounded-lg border p-3">
                <div className="min-w-0 break-words text-sm">
                  <strong>{packet.modelSelection.instanceId}</strong> ·{" "}
                  {packet.modelSelection.model}
                  <p>{packet.status}</p>
                </div>
                <p className="break-words text-sm">{packet.task.objective}</p>
                <details
                  onToggle={(event) => {
                    if (event.currentTarget.open) setReviewed(packet.id);
                  }}
                >
                  <summary className="cursor-pointer text-sm font-medium">
                    Inspect exact outbound packet
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
                    {packet.prompt}
                  </pre>
                </details>
                {packet.status === "awaiting-review" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={
                        !props.canOperate ||
                        busy ||
                        props.policy === "disabled" ||
                        reviewed !== packet.id
                      }
                      onClick={() => void decision(packet, "approve")}
                    >
                      Approve packet once
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!props.canOperate || busy}
                      onClick={() => void decision(packet, "block")}
                    >
                      Block packet
                    </Button>
                  </div>
                ) : null}
                {packet.artifact === undefined ? null : (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Inspect returned artifact
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
                      {packet.artifact}
                    </pre>
                    <p className="text-sm text-muted-foreground">
                      The private coordinator reviews this artifact before applying or running it.
                    </p>
                  </details>
                )}
              </article>
            ))}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
