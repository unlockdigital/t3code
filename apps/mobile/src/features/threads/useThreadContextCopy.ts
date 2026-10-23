import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { formatConversationMarkdown, threadTranscriptContext } from "@t3tools/shared/threadHandoff";
import { threadLinkHref } from "@t3tools/shared/threadLinks";

import * as Dialog from "../../components/ui/Dialog";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { appAtomRegistry } from "../../state/atom-registry";
import { readEnvironmentScope } from "../../state/session";

export function useThreadContextCopy() {
  const createHandoff = useAtomCommand(serverEnvironment.createLocalThreadHandoff, {
    reportFailure: false,
  });
  const removeHandoff = useAtomCommand(serverEnvironment.removeLocalThreadHandoff, {
    reportFailure: false,
  });
  const loadTranscript = useAtomCommand(orchestrationEnvironment.threadTranscript, {
    reportFailure: false,
  });
  return async (
    thread: ScopedThreadRef & {
      readonly title: string;
      readonly workspacePath?: string | null;
      readonly branch?: string | null;
    },
    format: "link" | "markdown" | "handoff",
  ) => {
    try {
      let value: string;
      const supportsLocalHandoff =
        appAtomRegistry.get(serverEnvironment.configValueAtom(thread.environmentId))
          ?.localThreadHandoff === true;
      const canCreateLocalHandoff =
        supportsLocalHandoff &&
        readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
      if (format !== "link" && canCreateLocalHandoff) {
        const result = await createHandoff({
          environmentId: thread.environmentId,
          input: { threadId: thread.threadId },
        });
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          throw squashAtomCommandFailure(result);
        }
        const snapshot = result.value;
        if (
          !(await tryCopyTextWithHaptic(
            format === "handoff" ? snapshot.handoff : snapshot.markdown,
            { target: "thread context" },
          ))
        ) {
          await removeHandoff({
            environmentId: thread.environmentId,
            input: { exportId: snapshot.exportId },
          });
          throw new Error("Could not write to the clipboard.");
        }
        if (snapshot.unavailableAttachmentCount)
          Dialog.alert(
            "Some attachments unavailable",
            `${snapshot.unavailableAttachmentCount} attachments could not be shared. The transcript lists the details.`,
          );
        return;
      }
      if (format === "markdown" || format === "handoff") {
        const result = await loadTranscript({
          environmentId: thread.environmentId,
          input: { threadId: thread.threadId },
        });
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          throw squashAtomCommandFailure(result);
        }
        value = formatConversationMarkdown({
          ...threadTranscriptContext(thread.environmentId, result.value),
          workspacePath: thread.workspacePath ?? null,
          branch: thread.branch ?? null,
        });
      } else {
        value = threadLinkHref(thread.threadId);
      }
      if (!(await tryCopyTextWithHaptic(value, { target: "thread context" })))
        throw new Error("Could not write to the clipboard.");
      if (format !== "link" && !canCreateLocalHandoff)
        Dialog.alert(
          "Conversation snapshot copied",
          supportsLocalHandoff
            ? "Text snapshot copied. Attachment sharing requires operate permission on the source host."
            : "Text snapshot copied. Local attachment sharing requires an updated source host.",
        );
    } catch (error) {
      Dialog.alert(
        "Could not copy thread context",
        error instanceof Error ? error.message : "An error occurred.",
      );
    }
  };
}
