import * as Schema from "effect/Schema";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const CreateLocalThreadHandoffInput = Schema.Struct({ threadId: ThreadId });
export const LocalThreadHandoff = Schema.Struct({
  exportId: TrimmedNonEmptyString,
  transcriptPath: TrimmedNonEmptyString,
  markdown: Schema.String,
  handoff: Schema.String,
  attachmentCount: Schema.Number,
  unavailableAttachmentCount: Schema.Number,
});
export type LocalThreadHandoff = typeof LocalThreadHandoff.Type;

export const RemoveLocalThreadHandoffInput = Schema.Struct({
  exportId: TrimmedNonEmptyString.check(Schema.isPattern(/^handoff-[a-zA-Z0-9_-]{6,64}$/)),
});

export class LocalThreadHandoffError extends Schema.TaggedError<LocalThreadHandoffError>()(
  "LocalThreadHandoffError",
  {
    stage: Schema.Literals(["read", "write", "unsafe", "limit"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    if (this.stage === "limit")
      return "Local handoff storage reached its limit. Delete older handoff folders in your T3 home's userdata/handoffs directory and retry.";
    if (this.stage === "unsafe")
      return "The local handoff folder could not be used safely. Check its ownership and permissions.";
    if (this.stage === "read") return "Could not read this conversation for sharing.";
    return "Could not prepare the private local handoff. Retry after checking available disk space.";
  }
}
