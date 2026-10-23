import * as Schema from "effect/Schema";

export const UpstreamRequest = Schema.Struct({
  action: Schema.Literals(["read", "refresh", "prepare", "cleanup"]),
  selectedTag: Schema.optionalKey(Schema.String),
  candidateId: Schema.optionalKey(Schema.String),
});
export type UpstreamRequest = typeof UpstreamRequest.Type;
const Release = Schema.Struct({
  tag: Schema.String,
  url: Schema.String,
  notes: Schema.String,
  securityNotes: Schema.Array(Schema.String),
});
const Candidate = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  branch: Schema.String,
  tag: Schema.String,
  head: Schema.String,
  status: Schema.Literals(["preparing", "clean", "conflicted", "failed", "missing"]),
});
export const UpstreamStatus = Schema.Struct({
  repository: Schema.String,
  fork: Schema.String,
  baseTag: Schema.String,
  baseCommit: Schema.String,
  customCommits: Schema.Number,
  dirty: Schema.Boolean,
  latest: Schema.NullOr(Release),
  updateAvailable: Schema.Boolean,
  checkedAt: Schema.NullOr(Schema.String),
  releaseError: Schema.NullOr(Schema.String),
  security: Schema.Struct({
    checkedAt: Schema.NullOr(Schema.String),
    error: Schema.NullOr(Schema.String),
    advisories: Schema.Array(
      Schema.Struct({
        title: Schema.String,
        url: Schema.String,
        fixes: Schema.Array(Schema.String),
      }),
    ),
  }),
  candidates: Schema.Array(Candidate),
});
export type UpstreamStatus = typeof UpstreamStatus.Type;
export class UpstreamError extends Schema.TaggedError<UpstreamError>()("UpstreamError", {
  stage: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    if (this.stage === "dirty-checkout")
      return "Local changes are preserved. Commit or save them before preparing from HEAD.";
    if (this.stage === "candidate-changed")
      return "Candidate has local changes or new commits. Keep it for review.";
    if (this.stage === "candidate-review")
      return "Candidate requires manual review. Cleanup is available for clean unused candidates.";
    if (this.stage === "checkout")
      return "Run this environment from the fork source checkout to manage upstream updates. Packaged installs use their existing updater.";
    if (this.stage === "configuration")
      return "Set the official repository, fork, stable base tag and full base commit in docs/unlock-digital/upstream.json.";
    if (this.stage === "repository-identity")
      return "Verify origin points to unlockdigital/t3code and upstream points to pingdotgg/t3code on GitHub.";
    if (this.stage === "base-ancestry")
      return "The recorded upstream base must be an ancestor of this checkout's HEAD. Verify the source configuration.";
    if (this.stage === "candidate-record")
      return "Candidate records require manual review in Git's t3-upstream-state.json. Preserve the file and worktrees before repairing it.";
    if (this.stage === "release-check")
      return "Refresh official releases successfully before preparing. Check network access and GitHub rate limits.";
    if (this.stage === "release-changed")
      return "The latest official release changed. Refresh, review its notes, then prepare again.";
    if (this.stage === "release-ancestry")
      return "The selected release does not contain the recorded base. Review its Git history before preparing manually.";
    return `Upstream operation failed (${this.stage}). Local work is preserved; inspect the candidate before retrying.`;
  }
}
