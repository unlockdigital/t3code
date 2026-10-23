import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  MessageId,
  PlanId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ThreadTranscript,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  formatConversationMarkdown,
  formatThreadHandoff,
  threadTranscriptContext,
} from "./threadHandoff.ts";

describe("portable conversation context", () => {
  it("copies a local file handoff that works without a CLI installation or credentials", () => {
    const handoff = formatThreadHandoff({
      threadId: "thread-1",
      title: "Review results",
      environmentId: "local-env",
      localSnapshot: {
        transcriptPath: "/private/T3 files/handoff-123456/conversation.md",
        attachmentCount: 2,
        unavailableAttachmentCount: 1,
      },
    });
    expect(handoff).toContain("/private/T3 files/handoff-123456/conversation.md");
    expect(handoff).toContain("2 attached files");
    expect(handoff).toContain("1 attachment unavailable");
    expect(handoff).not.toContain("t3 thread export");
    expect(handoff).toContain("reference material");
  });
  it("exports visible conversation text and plans from a transcript while preserving attachment names", () => {
    const threadId = ThreadId.make("thread-1");
    const id = TurnItemId.make("item-1");
    const updatedAt = DateTime.makeUnsafe("2026-10-23T12:00:00Z");
    const base = {
      id,
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed" as const,
      title: null,
      startedAt: null,
      completedAt: null,
      updatedAt,
    };
    const row = {
      position: 0,
      visibility: "inherited" as const,
      sourceThreadId: threadId,
      sourceItemId: id,
    };
    const transcript: OrchestrationV2ThreadTranscript = {
      threadId,
      title: "Imported context",
      updatedAt,
      items: [
        {
          ...row,
          item: {
            ...base,
            type: "assistant_message",
            messageId: MessageId.make("message-1"),
            text: "A complete answer",
            streaming: false,
            attachments: [
              {
                type: "file",
                id: "file-1",
                name: "results.txt",
                mimeType: "text/plain",
                sizeBytes: 1,
              },
            ],
          },
        },
        {
          ...row,
          position: 1,
          item: { ...base, type: "reasoning", text: "Internal reasoning", streaming: false },
        },
        {
          ...row,
          position: 2,
          item: {
            ...base,
            type: "proposed_plan",
            planId: PlanId.make("plan-1"),
            markdown: "1. Finish",
            streaming: false,
          },
        },
      ],
    };
    const context = threadTranscriptContext(EnvironmentId.make("local-env"), transcript);
    expect(context.reference).toBe("t3-thread://v1/thread-1");
    expect(context.entries.map((entry) => [entry.role, entry.text])).toEqual([
      ["assistant", "A complete answer"],
      ["plan", "1. Finish"],
    ]);
    expect(formatConversationMarkdown(context)).toContain("Attachment: ` results.txt `");
  });
  it("preserves long messages, code, whitespace, plans, and attachment names", () => {
    const text = `Keep this code:\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n${"long message ".repeat(6000)}`;
    const markdown = formatConversationMarkdown({
      title: "Fix the build",
      reference: "t3-thread://v1/t1",
      entries: [
        { role: "user", text, attachments: [{ name: "reference`file.png" }] },
        { role: "plan", text: "1. Fix types\n2. Check behavior" },
        { role: "assistant", text: "The build passes." },
      ],
    });
    expect(markdown).toContain(`## User\n\n${text}`);
    expect(markdown).toContain("Attachment: `` reference`file.png ``");
    expect(markdown).toContain("## Plan\n\n1. Fix types\n2. Check behavior");
    expect(markdown).toContain("## Assistant\n\nThe build passes.");
  });

  it("keeps hostile titles, IDs, and file paths in reference text", () => {
    const handoff = formatThreadHandoff({
      threadId: "thread:task%3A1'$(touch /tmp/test)",
      title: "Fix [ci]",
      environmentId: "local-env",
      localSnapshot: {
        transcriptPath: "/private/$(touch test)`file/conversation.md",
        attachmentCount: 0,
        unavailableAttachmentCount: 0,
      },
    });
    expect(handoff).toContain("Source thread: ` t3-thread://v1/");
    expect(handoff).toContain("`` /private/$(touch test)`file/conversation.md ``");
    expect(handoff).not.toContain("```sh");
  });
});
