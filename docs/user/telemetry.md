# Product usage data

Product analytics are off by default in the Unlock Digital fork, including after an upgrade
with no explicit preference. While off, the server skips analytics identity reads, event collection,
and transmission. Sign-in and T3 Connect continue to use the credentials and device identifiers
they need to operate.

To opt in, set `T3CODE_TELEMETRY_ENABLED=true` in the environment that launches the server,
then restart T3 Code. On macOS and Linux, desktop also reads this setting from your login shell
profile. On Windows, set it as a user environment variable. For a background server, set it in
the service’s environment. To opt out, remove the setting or set
`T3CODE_TELEMETRY_ENABLED=false` and restart. An administrator’s
[managed policy](./managed-policy.md#other-capabilities) with `limits.telemetry: false`
takes precedence over an opt-in. A policy that allows telemetry leaves the choice to the user.

When enabled, the server sends product usage events to `ingest.t3.codes`. The endpoint keeps
a copy and forwards events to PostHog. Usage events use a hashed random installation ID. An opted-in
server can also report the hash of its linked T3 Connect account. Events can include provider, model,
reasoning effort, permission mode, duration, turn results, and token counts. Unlock Digital clients
omit product analytics account and device IDs from their connection URLs. Product events exclude prompts, responses, file contents, authentication tokens,
conversation IDs, raw provider events, and child-agent output.

## Relay connection diagnostics

T3 Code sends relay connection traces to Axiom to diagnose T3 Connect connectivity. These are
separate from product events. Depending on the client version, traces can include connection
timings, environment identifiers and the connected machine's name. Failed spans can include error
messages and stack traces; error text can quote a value the app was handling.

Relay tracing keeps its own default. An explicit `T3CODE_TELEMETRY_ENABLED=false` also stops
server and desktop relay tracing. Relay tracing also stops when `T3CODE_OTEL_SDK_DISABLED` or
`OTEL_SDK_DISABLED` turns OpenTelemetry export off. A managed policy can stop server and
desktop relay tracing. Separate browser and mobile clients follow their own diagnostics settings.

The web app in a browser, including one the `t3` CLI opens, does not read these environment
variables. When its build has relay tracing configured, it sends its own connection traces even
if the server has opted out. The browser app has no relay tracing toggle.

## Mobile app diagnostics

When the iOS or Android app crashes or hits an error, it sends a report to T3 Code: the error
message, the stack trace, the app version, and the device model and OS version. Each launch also
sends startup timings, and every report carries a random ID for the install. Reports go through
the T3 Connect relay to Axiom. They do not include your threads, prompts, or connection details,
but an error message can quote a value the app was handling.

To stop sending them, turn off **Send crash reports** in **Settings > About T3 Code > Diagnostics**.

The mobile app also sends relay connection traces when its build has tracing configured. These
carry an identifier for the current app session. **Send crash reports** does not control these
traces, and the mobile app has no separate relay tracing toggle. Server environment variables and
managed policy do not disable mobile tracing.

## Agent activity for mobile notifications

When **Publish agent activity** is enabled on a host, it sends project and thread titles, model
names, activity status, and environment and thread identifiers to the T3 Connect relay for
[mobile notifications and live activities](./mobile-notifications.md). This is separate from
product events and relay diagnostics. Agent activity publishing has its own setting.

To stop publishing, turn off **Publish agent activity** under **Settings > Sharing & access** on
the host. Turning off notifications on a phone controls that phone's alerts, not the host's
publishing setting.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > Maintenance > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`T3CODE_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. An overridden signal shows **Set by environment** and names the variable that set it, and its
**Test** checks the running endpoint instead of the field. For endpoints saved here or set with `T3CODE_OTLP_*_URL`, set `T3CODE_OTLP_HEADERS` for
receivers that need authentication and `T3CODE_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
