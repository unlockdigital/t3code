# OpenCode

Install and authenticate OpenCode on the machine running your environment, then
enable it in **Settings > Providers**. See [provider setup](./install.md#providers).
T3 Code requires OpenCode 1.14.19 or newer, including when you connect an existing
OpenCode server.

## OpenCode 2

T3 Code supports OpenCode 2.0.18 and newer. It detects the version on its own, so
the same provider settings work for OpenCode 1.x and 2.x. OpenCode 1.x shows
**Limited support** in its provider settings.

OpenCode 2 is a separate package, `@opencode/cli`. To move from 1.x, install it
yourself, for example `npm install -g @opencode/cli`. Then refresh provider status.
T3 Code's update button updates whichever package you have installed. It never
switches a 1.x install to 2.x.

OpenCode 2 converts the shared OpenCode database to its own format the first time it
runs. Don't run OpenCode 1.x and 2.x side by side on the same machine. Threads you
started on 1.x continue on 2.x.

Plan mode uses OpenCode's `plan` agent.

## Local or external server

Leave **Server URL** empty to let T3 Code start OpenCode locally. A password in
provider settings applies to both that server and T3 Code's connection. With no
password setting, the local server uses `OPENCODE_SERVER_PASSWORD` from its
environment.

To use an existing OpenCode server, set **Server URL** and its password in provider
settings. T3 Code uses only that configured password for an external server; it
does not forward a local `OPENCODE_SERVER_PASSWORD`. If connection or version checks
fail, check the URL, credentials, and OpenCode version, then refresh provider status.

After a lost connection, send another prompt to reconnect to the same OpenCode
session.

## Approvals

OpenCode follows the shared [permission modes](./permission-modes.md). On OpenCode 2,
**Auto** approves ordinary existing-file edits and a small set of literal read commands
inside the workspace. Protected paths, unfamiliar shell syntax, and uncertain paths
continue through approval. OpenCode 1.x uses the **Supervised** rules for Auto.
Environment files such as `.env` and `.env.local` need approval in restricted
modes even though normal file reads do not; `.env.example` is allowed.

**Allow for workspace** applies to matching requests in other OpenCode sessions
using the same workspace. It is broader than the current thread, especially on a
shared external server. Use **Allow once** for a single request. Denying an action
does not stop the whole turn.

## Refresh models, commands, and skills

After changing an OpenCode login or configuration, use **Refresh provider status**
in **Settings > Providers** for that environment. On mobile, use **Refresh models**
in the thread settings. Reconnecting also refreshes the catalog; periodic provider
health checks do not.

Credential changes are read on refresh. Native OpenCode configuration can remain
cached while the local helper is running. Let it sit for 30 seconds without model
refreshes or text-generation work, then refresh again to reload the files. Repeated
refreshes keep the helper alive. An external server may need its own reload or
restart before T3 Code can see configuration changes.

Existing threads keep their selected model and options even when it disappears
from the catalog. If OpenCode rejects that model, select an available one and retry.

## Private model workflows

Selecting Tinfoil changes the inference connection. Explicit private workflows add a
routing lock for the conversation, child tasks, and background model requests. Auto
continues to control action permissions independently.

After the environment owner approves a verified Tinfoil connection, select a project
in **Settings → General**, enable **Private workflow**, and start a fresh conversation.
Existing conversations keep their earlier disclosure history. A private conversation
keeps its routing lock when project defaults change; start a fresh Standard conversation
to use another route. An unavailable or changed private connection pauses model work.

Private conversations default to **Private + helpers**. Ask the private coordinator to
prepare a self-contained coding task using synthetic fixtures and interfaces, then open
**Private controls** in the composer and refresh the packet list. Inspect the exact
outbound packet before approving it once. Initial helper support uses local OpenCode 2
connections, including OpenCode Go. The external provider's data terms apply to everything
in that packet. Review identities, business details, and proprietary logic yourself.

Helpers receive the approved prompt through a stateless text call. Returned code stays
an artifact for the private coordinator to inspect with its helper-status tool. Ask it
to review the result before applying or executing anything. Reviews expire after
15 minutes or a server restart. Choose **Private only** for tasks that should keep all
model context inside the private connection, including sensitive financial or legal work.

This feature enforces T3's model routes and helper handoffs. Workspace tools retain their
selected execution and network permissions, and saved conversations use T3's existing
local storage. Configure device encryption, backups, and local access for those records.
