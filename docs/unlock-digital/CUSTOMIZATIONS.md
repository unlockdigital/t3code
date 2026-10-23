# Unlock Digital: customization record

The fork starts from upstream v0.1.2. Local launch tooling lives beside the checkout and selects isolated application data, the pinned toolchain, and disabled optional telemetry.

## Account routes

T3's built-in named instances and separate provider configuration support multiple accounts, subscription logins, API keys, fixed-price coding plans, and local inference. The current configuration has two Codex subscriptions, Google browser authentication, Claude Enterprise, and an Anthropic API connection. The user edited friendly labels in T3. Preserve those names while keeping authentication categories explicit in the provider details and connection ledger.

## Usage clarity

The existing sidebar Usage entry provides one-click access to pooled limits and cost/token history. The first source customization improves that view:

- Label five-hour Codex windows **5-hour**, preserving provider-reported weekly and monthly windows. Claude's five-hour window uses the same wording.
- Label Claude's spend budget **Monthly spending limit**, with an explanation that the bar represents the remaining budget.
- Title Google's limit section **Google / Antigravity** and explain that its model quotas belong to the Google connection. Separate Codex and Claude subscriptions retain their own sections.
- Identify native Anthropic API-key authentication and provide the Console billing link from the Usage page. Actual API balances remain provider billing data.

Server labels feed all clients and the in-conversation usage command. Web and desktop share the explanatory UI; mobile uses the same wording through the shared helper. The existing wire contracts and pooling behavior are preserved. Focused Codex, Claude-window, and Claude-provider tests cover the changes. All required changed-file checks passed. Runtime refresh verified the new labels, API authentication category, and billing link after restart. The user performs visual review in the live app under their command-line operation preference.

## Home and background work

Choose **Home** beneath Search in the chat sidebar, or search for **Home** in the command palette, to leave the current conversation. Home keeps every agent running and preserves composer drafts. Later activity and completion retain the sidebar’s normal unread and status indicators. Opening a conversation again applies its normal read behavior. Home groups work into **Needs attention**, **Working**, and **Ready to revisit**, with provider/model, latest activity, elapsed task time, and linked-agent counts. Right-click, two-finger-click, double-click, or use the row’s action button to open the standard thread menu. Home holds displayed rows, statuses, animations, and elapsed time while the menu is open, then catches up with background work when it closes. Single-click opens the conversation after the double-click window; keyboard activation opens it immediately. Completed task durations stay fixed; disconnected environments show their last known state. Agent counts reflect linked threads and currently reported background agents. Both web/desktop sidebar variants include Home; mobile keeps its existing thread-list navigation.

## Working on the IDE from inside T3

The running instance includes the fork as the project `T3 Code · Unlock Digital`. Agents can edit the source checkout in response to requested interface changes, inspect development results, and save focused commits on `unlock-digital/main`. Keep application data in its separate home and preserve recoverable source checkpoints. The local launcher keeps the server and desktop running through source edits, with an explicit rebuild and restart after active work settles.

The user prefers command-line work and direct instructions for necessary sign-ins. Any future application change receives a focused commit with its purpose and validation. Source Updates follow UPSTREAM_SYNC.md.

## Upstream maintenance

**Settings → Upstream Updates** shows the selected environment's recorded base, custom commits, official release notes, public security advisories and patched versions, check failures, and saved update candidates. The dedicated Settings entry selects an environment automatically; Settings search and the command palette open the same page. About and the sidebar source-update control provide direct shortcuts. The desktop package version and upstream release base have explicit labels. GitHub sign-in provides access to the fork's Dependabot alerts through its link.

Preparation merges the reviewed stable release into a separate worktree containing the fork's committed customizations. Candidates await review and testing before integration. Cleanup preserves local edits, ignored files, conflicts, and later commits, and retains the candidate branch for recovery. The mobile environment screen uses the same service; direct MCP tools remain a future extension. The implementation was performed in the native T3 chat **Build Upstream updates panel**. Required changed-file checks passed with 101 tests across 10 files, including Git fixtures and the documented advisory payload. See [upstream maintenance](UPSTREAM_SYNC.md) for the operating procedure.

## Source history and upstream review

The customization series starts at upstream `v0.1.2` (`044f07257c9684ae4543bd1e1ebf9c394e9e3830`). These focused commits preserve the purpose and boundaries of each adaptation:

| Commit                                                                  | Change                                                                          | Review boundary                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [8256e9cf80](https://github.com/unlockdigital/t3code/commit/8256e9cf80) | Usage windows, spending limits, and account billing labels                      | Shared wording and provider-reported data                                                              |
| [c3972f0912](https://github.com/unlockdigital/t3code/commit/c3972f0912) | Upstream release/security status and candidate preparation                      | Fork source configuration stays behind the update service; candidates await verification               |
| [3b0360217b](https://github.com/unlockdigital/t3code/commit/3b0360217b) | Dedicated Upstream Updates navigation, source-build guidance, and Auto defaults | Explicit permission choices remain intact; fork defaults are a local policy choice                     |
| [602372a3bd](https://github.com/unlockdigital/t3code/commit/602372a3bd) | Source-update guidance for an older development desktop shell                   | Explicit packaged installation metadata retains authority                                              |
| [4c4f682f11](https://github.com/unlockdigital/t3code/commit/4c4f682f11) | Neutral Home, compact activity overview, and unread-navigation guards           | Web/desktop navigation; environment-scoped thread identity and existing unread semantics               |
| [09f8f6fbad](https://github.com/unlockdigital/t3code/commit/09f8f6fbad) | Shared Home thread menus and a steady view during selection                     | Destination permissions, pending navigation, guarded rename, and buffered presentation of live updates |

Home validation passed `vp run check:changed 602372a3bd` in an isolated source checkout: formatting, lint, unused-code checks, affected typechecking, and 154 tests across 10 files, including headless browser regressions. The user verified the activity overview and thread menu in the running native client. The application server and provider turns stayed running. Native mobile retains its thread-list navigation.

For a future upstream proposal, use these commit boundaries and their validation records to select a focused change. Review the Home/navigation behavior and usage clarity separately from the fork's permission defaults, local setup, and upstream-maintenance policy. Keep the configured accounts and application data in the user's environment. Upstream contributions follow the repository's contribution guidance when requested.

## Later experiment

Connecting additional workstations across environments is deferred until the single-machine workflow has been evaluated. Evaluate remote work, project grouping, and optional placement of new threads when their usefulness is established.
