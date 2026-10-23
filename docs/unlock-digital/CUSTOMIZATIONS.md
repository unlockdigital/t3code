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

## Working on the IDE from inside T3

The running instance includes the fork as the project `T3 Code · Unlock Digital`. Agents can edit the source checkout in response to requested interface changes, inspect development results, and save focused commits on `unlock-digital/main`. Keep application data in its separate home and preserve recoverable source checkpoints. Runtime changes use a restart after active work settles.

The user prefers command-line work and direct instructions for necessary sign-ins. Any future application change receives a focused commit with its purpose and validation. Source updates follow UPSTREAM_SYNC.md.

## Later experiment

Connecting the configured workstations is deferred until the single-machine workflow has been tried. Evaluate remote work, project grouping, and optional placement of new threads when their usefulness is established.
