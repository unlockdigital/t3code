# Unlock Digital: provider connections

Verified October 23, 2026, America/Chicago. Credentials, account identifiers, and financial balances stay in private provider storage.

## Connection ledger

| Friendly connection    | Runtime                                           | Authentication category        | Observed result                                                                                                           |
| ---------------------- | ------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| UDM Codex              | Existing Codex CLI 0.163.0-alpha.11.1             | ChatGPT subscription           | Authenticated; GPT-6.1-Sol completed the sample README check                                                              |
| Secondary Codex               | Same CLI with a separate shadow home              | ChatGPT subscription           | Authenticated as a distinct account; sample task and same-thread account transition passed                                |
| UDM Google             | T3-managed Antigravity ACP 1.3.0                  | Google browser login           | Authenticated; Gemini 3.8 Flash completed the README check and continued a Codex conversation                             |
| Claude · Subscription  | Claude Code 2.1.308                               | Claude Enterprise subscription | Authenticated; provider-reported monthly spending budget prevented the inference check; user chose to retain this account |
| UDM Anthropic API      | Claude Code with a separate configuration home    | Metered Anthropic API key      | Haiku 4.5 completed a small API-route check; key remains in T3's sensitive secret storage                                 |
| Copilot · Subscription | Supported route through OpenCode to be configured | GitHub subscription login      | Faculty enrollment route verified; account connection follows the initial setup                                           |
| OpenRouter · API       | Route to be configured                            | Metered API key                | User account and billing choice pending                                                                                   |

The Codex accounts advertise GPT-6.1-Sol, GPT-6-Astra, GPT-6-Sol, GPT-6-Luna, GPT-5.6-Sol, GPT-5.6-Terra, and GPT-5.6-Luna. Tasks verified GPT-6.1-Sol and GPT-6-Luna. Catalog discovery describes the other models.

Google advertises Gemini 3.8 Flash High, Medium, and Low. Tasks verified High and Medium. Runtime 1.3.0 is selected by this release's installer; the bundled compatibility manifest still mentions 1.1.1. Installation and actual inference both passed.

## Authentication and billing

T3 supports named provider instances, separate configuration homes, and sensitive environment variables. Keep friendly account names and an explicit route category for subscription, API, fixed-price coding plan, or local inference. Add a separate instance for each credential route, even when several routes use the same provider. The model picker selects the instance and model together; the provider's authentication details verify the route.

The existing default Codex CLI account is preserved. The second account uses the documented shared Codex home plus a separate shadow home, retaining native thread continuity. Claude's API instance uses its own `CLAUDE_CONFIG_DIR` through T3's home setting. The subscription uses the default CLI login. This allows the Enterprise subscription and API credits to coexist.

Google offers separate Google-account, Gemini Enterprise, Gemini API-key, and Vertex/Agent Platform methods. Add separate instances for future API credentials. Its ACP sign-in is separate from the Antigravity desktop IDE login. Claude Code authentication is also separate from the Claude desktop app.

A completed inference check establishes access to the tested model at that time. Provider catalog discovery and authentication establish different parts of connection status. The Enterprise budget is an external account limit and remains connected for later use.

## Usage in one place

Open **Usage** in the sidebar or press **Command-U** on macOS. **Limits** is the initial view and the page remembers the last view. **Cost** and **Tokens** show history for 24 hours, 7 days, 30 days, or 90 days. Cost is an API-equivalent estimate; actual account charges come from the provider's billing system.

Limits pools accounts by provider, with a segment for each account. Select or hover a segment to see its friendly account name, plan, and reset details. Refresh checks the connected providers again.

- Codex reports its available five-hour, weekly, or monthly windows. Five-hour windows are labeled **5-hour**. Each account can report a different set of windows.
- Claude reports the windows available to its plan. The connected Enterprise account reports a **Monthly spending limit**. Its current budget prevented the sample request. Additional five-hour or weekly windows appear when the provider supplies them.
- **Google / Antigravity** displays quotas for models accessed through that Google account. A **Claude & GPT (shared)** quota belongs to those models inside Antigravity. Separate Codex and Claude subscriptions have their own sections. This Google account currently reports a shared weekly window; Gemini inference worked while no separate Gemini quota window was returned.
- **Anthropic API billing** links to the Console's actual API spending and credit balance. Standard inference credentials provide access to inference; account-wide billing data needs provider-supported billing access. The dashboard presents the supported billing link for this route.

See the [usage guide](../user/usage.md) for refresh behavior, pooled quotas, and supported providers.

## Continuity evidence

A disposable sample project established a codename and a setup decision. The same conversation recalled both after switching from GPT-6.1-Sol to GPT-6-Luna, changing to the second Codex account, and changing to Gemini 3.8 Flash Medium. Each completed run's saved provider instance and model matched the requested transition. The original Codex lead was restored afterward.

The Codex lead also delegated a read-only README task to Google and incorporated the correct result. A separate harmless Google task was stopped, with its saved child run and task nodes marked interrupted. Sample files remained unchanged. Cross-provider continuation transfers a budgeted transcript; earlier tool state and attachments have documented limits.

## GitHub Copilot for education faculty

GitHub's verified-teacher benefit provides free Copilot Pro. Use a personal GitHub account, a verifiable university-issued email address, and documents proving faculty or researcher affiliation. Start an application in [Education benefits](https://github.com/settings/education/benefits). After approval, open Copilot settings and activate the eligible benefit. GitHub reevaluates eligibility monthly. These steps follow [GitHub's teacher application guide](https://docs.github.com/en/education/about-github-education/github-education-for-teachers/apply-to-github-education-as-a-teacher) and [free Copilot Pro activation guide](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-teachers-and-os-maintainers).

The institution's [AI toolkit](https://education.github.com/) separately lists Microsoft 365 Copilot for university productivity tools. GitHub Copilot is the coding service relevant to the OpenCode route. Verify any existing GitHub entitlement before applying again. Enrollment and private affiliation documents remain user-operated steps.

OpenCode can connect an existing Copilot account through its GitHub device flow. The supported partnership is documented by [GitHub](https://github.blog/changelog/2026-01-16-github-copilot-now-supports-opencode/). Inspect existing OpenCode data before installing or upgrading: T3's [OpenCode guide](../user/providers-opencode.md) requires 2.0.18+ for the newer integration and describes its shared-database migration. OpenRouter has its own account, credits, and billing.

Primary provider guides: [Codex](../user/providers-codex.md), [Google/Antigravity](../user/providers-antigravity.md), [Claude](../user/providers-claude.md), [OpenCode](../user/providers-opencode.md).
