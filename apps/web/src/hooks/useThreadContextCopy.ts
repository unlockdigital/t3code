import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { formatConversationMarkdown, threadTranscriptContext } from "@t3tools/shared/threadHandoff";
import { threadLinkHref } from "@t3tools/shared/threadLinks";

import { readProject, readThreadShell } from "../state/entities";
import { orchestrationEnvironment } from "../state/orchestration";
import { useAtomCommand } from "../state/use-atom-command";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "./useCopyToClipboard";
import { serverEnvironment } from "../state/server";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentScope } from "../state/session";

type ThreadContextCopyFormat = "link" | "markdown" | "handoff";

function useThreadContextCopyCommands() {
  const createHandoff = useAtomCommand(serverEnvironment.createLocalThreadHandoff, {
    reportFailure: false,
  });
  const removeHandoff = useAtomCommand(serverEnvironment.removeLocalThreadHandoff);
  const loadTranscript = useAtomCommand(orchestrationEnvironment.threadTranscript, {
    reportFailure: false,
  });

  return { createHandoff, removeHandoff, loadTranscript };
}

export function useThreadContextCopy() {
  return createThreadContextCopyAction(useThreadContextCopyCommands());
}

function createThreadContextCopyAction({
  createHandoff,
  removeHandoff,
  loadTranscript,
}: ReturnType<typeof useThreadContextCopyCommands>) {
  return async (target: ScopedThreadRef, format: ThreadContextCopyFormat) => {
    try {
      const thread = readThreadShell(target);
      if (!thread) throw new Error("This thread is no longer available.");
      let value: string;
      const supportsLocalHandoff =
        appAtomRegistry.get(serverEnvironment.configValueAtom(target.environmentId))
          ?.localThreadHandoff === true;
      const canCreateLocalHandoff =
        supportsLocalHandoff &&
        readEnvironmentScope(target.environmentId, AuthOrchestrationOperateScope);
      if (format !== "link" && canCreateLocalHandoff) {
        const result = await createHandoff({
          environmentId: target.environmentId,
          input: { threadId: target.threadId },
        });
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          throw squashAtomCommandFailure(result);
        }
        const snapshot = result.value;
        if (
          !(await writeTextToClipboard(
            format === "handoff" ? snapshot.handoff : snapshot.markdown,
            "thread context",
          ))
        ) {
          await removeHandoff({
            environmentId: target.environmentId,
            input: { exportId: snapshot.exportId },
          });
          return;
        }
        toastManager.add({
          type: snapshot.unavailableAttachmentCount ? "warning" : "success",
          title:
            format === "handoff" ? "Local agent handoff copied" : "Conversation copied as Markdown",
          description: `${snapshot.attachmentCount} attached files shared on the source computer.${snapshot.unavailableAttachmentCount ? ` ${snapshot.unavailableAttachmentCount} unavailable; details are in the transcript.` : ""}`,
          actionProps: {
            children: "Delete shared copy",
            onClick: () => {
              void removeHandoff({
                environmentId: target.environmentId,
                input: { exportId: snapshot.exportId },
              });
            },
          },
        });
        return;
      }
      if (format === "markdown" || format === "handoff") {
        const result = await loadTranscript({
          environmentId: target.environmentId,
          input: { threadId: target.threadId },
        });
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          throw squashAtomCommandFailure(result);
        }
        const context = threadTranscriptContext(target.environmentId, result.value);
        value = formatConversationMarkdown({
          ...context,
          workspacePath:
            thread.worktreePath ??
            readProject(scopeProjectRef(target.environmentId, thread.projectId))?.workspaceRoot ??
            null,
          branch: thread.branch,
        });
      } else {
        value = threadLinkHref(target.threadId);
      }
      if (await writeTextToClipboard(value, "thread context")) {
        toastManager.add({
          type: "success",
          title:
            format === "link"
              ? "Thread link copied"
              : format === "handoff"
                ? "Conversation snapshot copied"
                : "Conversation copied as Markdown",
          ...(format !== "link" && !canCreateLocalHandoff
            ? {
                description: supportsLocalHandoff
                  ? "Text snapshot copied. Attachment sharing requires operate permission on the source host."
                  : "Text snapshot copied. Local attachment sharing requires an updated source host.",
              }
            : {}),
        });
      }
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy thread context",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  };
}
