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

Choose **Home** beneath Search in the chat sidebar, or search for **Home** in the command palette, to leave the current conversation. Home keeps every agent running and preserves composer drafts. Later activity and completion retain the sidebar’s normal unread and status indicators. Opening a conversation again applies its normal read behavior. Home groups work into **Needs attention**, **Working**, and **Ready to revisit**, with provider/model, latest activity, elapsed task time, and linked-agent counts. Completed task durations stay fixed; disconnected environments show their last known state. Agent counts reflect linked threads and currently reported background agents. Both web/desktop sidebar variants include Home; mobile keeps its existing thread-list navigation.

## Working on the IDE from inside T3

The running instance includes the fork as the project `T3 Code · Unlock Digital`. Agents can edit the source checkout in response to requested interface changes, inspect development results, and save focused commits on `unlock-digital/main`. Keep application data in its separate home and preserve recoverable source checkpoints. The local launcher keeps the server and desktop running through source edits, with an explicit rebuild and restart after active work settles.

The user prefers command-line work and direct instructions for necessary sign-ins. Any future application change receives a focused commit with its purpose and validation. Source Updates follow UPSTREAM_SYNC.md.

## Upstream maintenance

**Settings → Upstream Updates** shows the selected environment's recorded base, custom commits, official release notes, public security advisories and patched versions, check failures, and saved update candidates. The dedicated Settings entry selects an environment automatically; Settings search and the command palette open the same page. About and the sidebar source-update control provide direct shortcuts. The desktop package version and upstream release base have explicit labels. GitHub sign-in provides access to the fork's Dependabot alerts through its link.

Preparation merges the reviewed stable release into a separate worktree containing the fork's committed customizations. Candidates await review and testing before integration. Cleanup preserves local edits, ignored files, conflicts, and later commits, and retains the candidate branch for recovery. The mobile environment screen uses the same service; direct MCP tools remain a future extension. The implementation was performed in the native T3 chat **Build Upstream updates panel**. Required changed-file checks passed with 101 tests across 10 files, including Git fixtures and the documented advisory payload. See [upstream maintenance](UPSTREAM_SYNC.md) for the operating procedure.

## Later experiment

Connecting the configured workstations is deferred until the single-machine workflow has been tried. Evaluate remote work, project grouping, and optional placement of new threads when their usefulness is established.
