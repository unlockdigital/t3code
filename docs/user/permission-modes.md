# Permission modes

Permission modes control when an agent needs your approval to act. Choose a mode in the message
composer; it applies to that thread.

Set the default for new threads in **Settings → General → New threads → Permissions**.
Projects can override the environment default. New threads use this setting rather than the
mode of the thread you were viewing. The initial default is **Full access**; existing threads
and modes you choose in a draft keep their permissions.

| Mode                  | Behavior                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| **Supervised**        | Requests approval for commands and file changes.                                      |
| **Auto-accept edits** | Approves file edits automatically; other actions can still require approval.          |
| **Auto**              | Uses the provider's automatic review to approve routine actions and ask about others. |
| **Full access**       | Allows commands and edits without approval prompts.                                   |

Approve or reject requests in the conversation to let the agent continue. Permission modes do
not prevent the agent from asking questions about the task.

## Provider differences

Providers enforce permissions differently. Some read-only actions can proceed in **Supervised**.
**Auto** uses automatic review on Codex, Claude, Cursor, and Grok; providers without an equivalent,
including OpenCode and Antigravity, fall back to asking. On Grok, commands its review blocks come
to you for approval.

Muse Code offers only **Supervised** and **Full access**. A Muse thread already set to another mode
runs in **Supervised**.

Grok offers no **Auto-accept edits**. A Grok thread already set to it runs in **Supervised**. Grok
file-change approvals offer **Allow all edits this session**. Its command approvals have no
session-wide choice, because Grok would remember that command for the whole project.

ACP Registry agents run their own tools in their own mode; T3 Code answers their approval requests
by the permission mode. See [ACP Registry permissions](./providers-acp.md#permissions-and-terminals).

Claude can still ask in **Full access** when its settings disable bypass permissions or require
approval for an action.

Antigravity can still send native approval requests in **Full access**. It only offers remembered
approvals for actions that support them.

See the [provider guides](./install.md#providers) for setup and provider-specific limits.

## A personal agent that reviews routine work

Use the pencil beside your personal agent below Home to choose its conversation and name. Clicking the agent opens that conversation; its status shows work, pending approvals, and unread results. The shortcut is saved per device.

Choose **Use Auto for agent and sub-agents** in the same dialog to set the agent and its current direct app-owned sub-agents to Auto. Future sub-agents inherit that mode. This uses each provider’s automatic review; providers without Auto support can still ask. Existing pending approval cards may require a final response. Individual thread modes remain available in the composer.

Enable **Review routine approvals** in that dialog to authorize the agent to review requests in threads and runs it starts. The agent evaluates routine reads, searches, tests, and reversible edits against your assigned task and can approve one action at a time. Publishing, deletion, spending, credential access, permission changes, sharing private data, and uncertain scope stay with you. This delegates judgment to the agent; existing provider restrictions and explicit human-review requirements continue to apply.

T3 checks the coordinator's grant, who started the thread and run, and whether the request remains live and unchanged. Command approvals require the provider's actual command and working directory. Older requests with incomplete details remain for human review. Approval notifications wake the coordinator, and its tool history records the rationale and decision. Turn the switch off to revoke authority; changing or resetting the shortcut also revokes the previous agent's authority.
