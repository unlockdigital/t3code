import * as Schema from "effect/Schema";
import { ModelSelection } from "./modelSelection.ts";
import { ThreadId } from "./baseSchemas.ts";

const BoundedText = Schema.String.check(Schema.isMaxLength(32_768));
export const PrivateHelperTask = Schema.Struct({
  objective: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  files: Schema.Array(Schema.Struct({ path: Schema.String, content: BoundedText })).check(
    Schema.isMaxLength(8),
  ),
  outputPaths: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
});
export type PrivateHelperTask = typeof PrivateHelperTask.Type;
export const PrivateHelperProposalInput = Schema.Struct({
  threadId: ThreadId,
  modelSelection: ModelSelection,
  task: PrivateHelperTask,
});
export type PrivateHelperProposalInput = typeof PrivateHelperProposalInput.Type;
export const PrivateHelperPacket = Schema.Struct({
  id: Schema.String,
  digest: Schema.String,
  modelSelection: ModelSelection,
  task: PrivateHelperTask,
  prompt: BoundedText,
  status: Schema.Literals(["awaiting-review", "running", "completed", "failed", "blocked"]),
  artifact: Schema.optional(BoundedText),
  createdAt: Schema.String,
});
export type PrivateHelperPacket = typeof PrivateHelperPacket.Type;
export const PrivateHelperState = Schema.Struct({ packets: Schema.Array(PrivateHelperPacket) });
export const PrivateHelperStateInput = Schema.Struct({ threadId: ThreadId });
export const PrivateHelperDecisionInput = Schema.Struct({
  threadId: ThreadId,
  packetId: Schema.String,
  digest: Schema.String,
  decision: Schema.Literals(["approve", "block"]),
});
export type PrivateHelperDecisionInput = typeof PrivateHelperDecisionInput.Type;

export class PrivateHelperError extends Schema.TaggedError<PrivateHelperError>()(
  "PrivateHelperError",
  {
    reason: Schema.Literals([
      "private-required",
      "helpers-disabled",
      "unavailable",
      "invalid-packet",
      "expired",
      "changed",
      "execution-failed",
    ]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "private-required":
        return "Helper packets require an explicitly private thread.";
      case "helpers-disabled":
        return "External helpers are disabled for this private thread.";
      case "unavailable":
        return "This destination has no qualified stateless helper transport. No packet was sent.";
      case "invalid-packet":
        return "The helper packet needs bounded, self-contained synthetic inputs and relative output paths.";
      case "expired":
        return "This helper packet expired or was already decided. Prepare a new packet.";
      case "changed":
        return "The reviewed packet or its connection changed. Prepare a new packet for review.";
      case "execution-failed":
        return "The helper could not return a bounded artifact. No files were applied.";
    }
  }
}
