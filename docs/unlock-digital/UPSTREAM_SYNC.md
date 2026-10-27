# Unlock Digital: upstream maintenance

## Recorded base

- Stable release: `v0.1.2`, published October 22, 2026.
- Base SHA: `044f07257c9684ae4543bd1e1ebf9c394e9e3830`.
- `origin`: `https://github.com/unlockdigital/t3code.git`.
- `upstream`: `https://github.com/pingdotgg/t3code.git`.
- Working branch and fork default: `unlock-digital/main`.
- Preserved baseline tag: `v0.1.2`.
- Upstream development is available through `upstream/main`; the fork keeps one maintained public branch.
- `remote.pushDefault` is `origin`.

## Update procedure

Use stable upstream releases for routine maintenance. Prioritize applicable security fixes; assess a published upstream fix separately when it precedes a stable release. Keep each customization in a focused commit and use existing settings and skills where they provide the requested behavior. Accepted upstream contributions can reduce the custom changes maintained here.

1. When an update is requested, inspect local work, fetch upstream tags, and read the selected release's compatibility, security, runtime, and database-migration notes. Preserve a recoverable source checkpoint.
2. Create an update candidate from `unlock-digital/main` in a separate worktree. Merge the selected upstream release into that candidate and resolve overlapping edits while preserving the intended custom behavior. Keep the running checkout available during preparation.
3. Source the isolated toolchain, install the candidate's frozen lockfile, and verify its resolved Node and package-manager versions. Give its server a separate application home and disposable project.
4. Run `vp run check:changed <selected-upstream-tag>`, build and launch the candidate, and verify the custom usage labels, account routes, provider switching, and delegation. Record failures and remaining compatibility questions before cutover.
5. Once the candidate passes and active work has settled, stop the current development instance and make a private backup of its dedicated application data, including the database, settings, and associated secrets. Preserve its compatible runtime/source versions for recovery.
6. Advance the customization branch to the verified candidate, rebuild and launch through the local launcher, and verify saved conversations, configured accounts, and the recorded runtime. Use the existing account test results to choose small focused checks.
7. Push the verified result to `origin`, record the new upstream tag/SHA here, and retain the previous compatible data/source checkpoint. Preserve the historical `v0.1.2` baseline tag.

GitHub's ahead/behind banner compares this maintained branch with upstream development. Custom commits contribute to the ahead count, and upstream changes after the recorded stable base contribute to the behind count. Review stable updates through the procedure above. Delete merged release-candidate branches after integration; upstream tags and the `upstream` remote retain the reference history.

The update request authorizes this maintenance sequence. Monitoring remains observational; applying an update belongs to the requested update task. Keep pushes directed to the user's fork. Submit an upstream contribution when the user requests it.

Allow the fork a full trial week before proposing contributions. Review proven changes for upstream contribution starting October 30, 2026. Keep security maintenance moving during that trial. Preserve focused customization commits when an upstream contribution lands, and retire their duplicate implementation through an ordinary follow-up change after the next upstream integration.

## Full v0.1.3 integration gates

The reviewed official v0.1.3 release is `d2c440312e5f39d59827ed466838a623516454d6`. Focused backports retain the recorded v0.1.2 base until the complete release is merged and verified. Start each full candidate from the current committed fork, and preserve the active tracked and untracked work separately before reconciling it.

- **Migration history:** this fork records migration 68 as `WorkflowReviews`; v0.1.3 uses 68 for `ShellStopRequestIndex` and 69 for `ThreadMessageSearch`. Existing fork databases have already applied their migration 68. Build and test an explicit history bridge against fresh databases, fork-68 snapshots, and every upstream history the candidate supports. Verify the workflow tables, stop-request index, and search schema together before opening copied application data with the full candidate. Preserve compatible source and data for rollback.
- **Authorization and private routing:** keep authoritative lineage lookup before creating or rotating MCP credentials, retain restricted credentials on lookup failure, and preserve model/account destination checks. Verify child direct-call denial and private routing after resolving provider-session, orchestration, and MCP conflicts.
- **Dependencies:** reconcile the workspace, patches, and frozen lockfile together. Preserve the fork's security updates to the MCP SDK, stream-json, KaTeX, and sharp. Assess and remediate the Undici and Zod advisory ranges per runtime consumer; the configured Node runtime's embedded HTTP library and npm dependency versions need separate checks. Recheck current vendor guidance during that work.
- **Client data bounds:** a Stop-state repair must retain the ordinary thread projection's bounded command/tool payloads in transit and persisted caches. Verify that settlement repairs preserve status without automatically retaining on-demand details.

Managed Codex token renewal crosses named-account and launch-profile boundaries. Review its server broker and native helper as one change against the completed account-routing work. Keep optional sharing, secret-file delivery, and managed-service network defaults under an explicit adoption decision. Validate the existing single-machine loopback behavior and custom Home, usage, and maintenance navigation with the combined source.

## Recovery during focused maintenance

Preserve a source recovery ref, tracked and staged patches, untracked source, the pinned toolchain identity, and current compiled server/desktop artifacts before integration. Create private SQLite snapshots through the backup API and retain the matching settings, secrets, provider state, and attachments. Treat `server-owner.sqlite` and `server-runtime.json` as transient runtime ownership/discovery files; the restarted instance establishes its own identity. Verify backup integrity and checksums without exposing their contents.

Validate the combined custom source in isolation before loading new backend code. The local launcher serves web source through Vite, so a web edit can reload while the backend keeps running. Coordinate a backend restart after all active turns and background work settle, verify the owned listeners immediately before stopping, and verify the restarted build, health, saved conversation IDs, and database integrity. The source and application-state backup are separate recovery assets.

If a regression appears, first preserve a new snapshot containing post-update conversations. Revert the scoped maintenance commits while retaining unrelated work, and restore the compatible compiled artifacts. Confirm compatibility with the newest database on an isolated copy before restarting the previous runtime; retain both data snapshots when a compatible data restore is necessary. Revalidate the repaired behavior before retrying the update.

## Upstream Updates panel

Open **Settings → Upstream Updates**. The page selects the primary environment or an environment within the current Settings filter automatically. An explicitly selected remote stays selected. The command palette and Settings search also open this dedicated page. About and the sidebar source-update action open the desktop’s primary environment directly. Mobile exposes the same service under **Settings → Maintenance → Manage environments → [environment] → Upstream Updates**. Maintenance permission controls access on the destination server.

Check upstream reads GitHub's official latest stable release and public advisories. The panel shows successful check times, failures, published patched versions, and release-note security mentions with their source links. Dependabot alerts open on GitHub through the user's sign-in. Review deployed-runtime applicability separately. The existing daily watch keeps its schedule.

Prepare update requires a clean source checkout and the reviewed release. It starts a candidate from committed HEAD in a sibling `t3code-upstream-candidates/<id>` worktree, retains custom commits, and merges the fetched official tag. Every candidate awaits verification through the procedure above. Conflicts stay available for manual review. Preparation leaves the running checkout, dependencies, and application data in place.

Source identity and the recorded base live in `upstream.json` beside this guide. Candidate records and cached checks live in `t3-upstream-state.json` under Git's common directory. Reopening Settings restores them. Interrupted preparations and missing worktrees remain visible for manual inspection. Preserve that journal and the candidate branches during recovery. Cleanup removes an unchanged clean worktree only after checking ordinary edits, untracked and ignored files (including `.env`), branch identity, and later commits. It retains the branch as a recovery point. Conflicted, interrupted, changed, and missing candidates require manual review.

## Release and security watch

On October 23, 2026, the latest official stable release was verified as v0.1.2. The fork's Dependency vulnerability alerts were enabled and their enabled state confirmed through GitHub's API. GitHub evaluates the supported dependency graph; source dependency alerts and deployed-runtime applicability are separate evidence.

The Codex chat has an active daily heartbeat named **T3 upstream releases and security**, id `t3-upstream-releases-and-security`. It checks official stable releases, published security advisories, and accessible Dependabot alerts against this recorded upstream base. It stays quiet on unchanged state and reports actionable changes or meaningful monitoring failures. Its first scheduled execution remains pending as of setup; the creation response establishes configuration, and later run receipts establish execution.

The local watch needs this Mac and the app available. GitHub's repository alerts operate independently. Inspect the existing watch before creating another one. Routine monitoring preserves the running app, credentials, repository files, branches, and installed dependencies.

About labels the desktop package version separately from the upstream release base shown in Upstream Updates. A source build shows the source-update preparation path and its manual review, test, rebuild, and restart steps. Packaged releases keep their binary updater and release channels; a packaged release with a missing feed reports its configuration problem.

Source builds use manual rebuilds initially. Development-mode desktop updating is disabled by the application; packaged upstream auto-updates belong to the official release app. A future packaged fork needs its own explicit update distribution. Keep desktop and server protocol versions compatible.

The fork's [desktop preview workflow](../../.github/workflows/fork-release.yml) reuses upstream's six-target desktop and CLI packaging. It accepts existing tags shaped like `v0.1.2-unlock.2-preview.20261030.1`, verifies that the tagged commit belongs to the default branch and has a successful `Check` result, and creates a draft prerelease with `SHA256SUMS`. A tag push or manual dispatch starts the build. Use a fresh tag for each attempt that produced a release. Complete native platform smoke checks before publishing its draft. These initial artifacts are unsigned, use manual installation, and carry no automatic update feed. Preview packages retain upstream desktop profile identity. Use a disposable OS account or VM for side-by-side testing and a separate `T3CODE_HOME` for server state. Signing, a production update feed, T3 Connect relay configuration, npm publication, and hosted deployments require their own setup.

Rollback restores both a source checkpoint and a database backup compatible with it. Preserve newer state separately before restoring a backup.

Primary guidance: [updating](../user/updating.md), [development](../operations/development.md).

Official maintenance references: [GitHub fork syncing](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/syncing-a-fork), [Dependabot alerts](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-dependabot-alerts), [upstream releases](https://github.com/pingdotgg/t3code/releases), [T3 security policy](https://t3.codes/security-policy).
