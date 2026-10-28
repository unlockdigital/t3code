// @effect-diagnostics nodeBuiltinImport:off
// The SDK transport needs Node streams for its Content-Length RPC reader.
import * as NodeChildProcess from "node:child_process";
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";
import { signalProcessGroup } from "@t3tools/provider-core/server/processGroup";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import type { AcpRegistrySettings } from "../settings.ts";
import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";

const quotaResponse = Schema.Struct({
  quotaSnapshots: Schema.Record(Schema.String, Schema.Unknown),
});
const quotaSnapshot = Schema.Struct({
  entitlementRequests: Schema.Finite,
  usedRequests: Schema.Finite,
  isUnlimitedEntitlement: Schema.optionalKey(Schema.Boolean),
  hasQuota: Schema.optionalKey(Schema.Boolean),
  tokenBasedBilling: Schema.optionalKey(Schema.Boolean),
  resetDate: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeResponse = Schema.decodeUnknownOption(quotaResponse);
const decodeQuota = Schema.decodeUnknownOption(quotaSnapshot);
const externalUsage = { label: "GitHub Copilot usage", url: "https://github.com/settings/copilot" };

class CopilotUsageError extends Schema.TaggedError<CopilotUsageError>()("CopilotUsageError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return "Could not read Copilot account usage.";
  }
}

export function isCopilotAgent(settings: AcpRegistrySettings): boolean {
  return settings.source === "registry"
    ? settings.agentId === "github-copilot-cli"
    : /^copilot(?:\.exe|\.cmd)?$/i.test(settings.commandPath.split(/[\\/]/).pop() ?? "");
}

export function copilotUsageLimits(payload: unknown, checkedAt: string): ServerProviderUsageLimits {
  const response = decodeResponse(payload);
  if (Option.isNone(response)) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: "Copilot returned invalid account usage.",
    });
  }
  const windows: ServerProviderUsageWindow[] = [];
  let creditBalance: ServerProviderUsageLimits["creditBalance"];
  for (const [id, label] of [
    ["premium_interactions", "Premium requests"],
    ["chat", "Chat"],
    ["completions", "Completions"],
  ] as const) {
    const parsed = decodeQuota(response.value.quotaSnapshots[id]);
    if (Option.isNone(parsed) || parsed.value.hasQuota === false) continue;
    const quota = parsed.value;
    const unlimited = quota.isUnlimitedEntitlement === true || quota.entitlementRequests === -1;
    if (!unlimited && (quota.entitlementRequests <= 0 || quota.usedRequests < 0)) continue;
    const credits = id === "premium_interactions" && quota.tokenBasedBilling === true;
    const reset = quota.resetDate ? DateTime.make(quota.resetDate) : Option.none();
    windows.push({
      id: `copilot_${id}`,
      kind: unlimited ? "other" : "monthly",
      label: unlimited
        ? `${label} · Unlimited`
        : `${credits ? "AI credits" : label} · ${quota.usedRequests.toLocaleString("en-US")} / ${quota.entitlementRequests.toLocaleString("en-US")}`,
      usedPercent: unlimited
        ? 0
        : clampPercent((quota.usedRequests / quota.entitlementRequests) * 100),
      ...(Option.isSome(reset) && !unlimited ? { resetsAt: DateTime.formatIso(reset.value) } : {}),
    });
    if (credits) {
      const remaining = Math.max(0, quota.entitlementRequests - quota.usedRequests);
      creditBalance = {
        hasCredits: unlimited || remaining > 0,
        unlimited,
        ...(!unlimited ? { balance: String(remaining) } : {}),
      };
    }
  }
  if (windows.length === 0) {
    return {
      ...makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Copilot did not report a usable account quota.",
      }),
      externalUsage,
    };
  }
  return {
    ...makeUsageLimits({ checkedAt, windows }),
    ...(creditBalance ? { creditBalance } : {}),
    externalUsage,
  };
}

const requestQuota = Effect.fn("CopilotUsage.requestQuota")(function* (
  input: AcpRegistrySupport.ResolvedAcpRegistryAgent["spawn"],
) {
  const platform = yield* HostProcess.Platform;
  // Copilot's SDK RPC uses Content-Length framing; its ACP stream uses JSONL.
  const args = input.args.filter(
    (arg) => arg !== "--acp" && arg !== "--stdio" && arg !== "--headless",
  );
  const command = yield* resolveSpawnCommand(
    input.command,
    [...args, "--headless", "--stdio", "--log-level", "error"],
    input.env ? { env: input.env } : {},
  );
  return yield* Effect.acquireUseRelease(
    Effect.try({
      try: () => {
        const child = NodeChildProcess.spawn(command.command, command.args, {
          cwd: input.cwd,
          env: input.env,
          shell: command.shell,
          windowsHide: true,
          detached: platform !== "win32",
          stdio: ["pipe", "pipe", "pipe"],
        });
        const connection = createMessageConnection(
          new StreamMessageReader(child.stdout),
          new StreamMessageWriter(child.stdin),
        );
        return { child, connection };
      },
      catch: (cause) => new CopilotUsageError({ cause }),
    }),
    ({ child, connection }) =>
      Effect.callback<unknown, CopilotUsageError>((resume) => {
        child.stderr.resume();
        child.on("error", (cause) => resume(Effect.fail(new CopilotUsageError({ cause }))));
        child.on("exit", (code) =>
          resume(Effect.fail(new CopilotUsageError({ cause: { exitCode: code } }))),
        );
        connection.onError((cause) => resume(Effect.fail(new CopilotUsageError({ cause }))));
        connection.onClose(() =>
          resume(Effect.fail(new CopilotUsageError({ cause: "RPC connection closed" }))),
        );
        connection.listen();
        connection.sendRequest("account.getQuota", {}).then(
          (result) => resume(Effect.succeed(result)),
          (cause) => resume(Effect.fail(new CopilotUsageError({ cause }))),
        );
      }),
    ({ child, connection }) =>
      Effect.sync(() => {
        connection.dispose();
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        if (child.pid !== undefined && platform !== "win32") {
          try {
            signalProcessGroup(child.pid, "SIGKILL");
          } catch {
            /* The CLI may already have exited. */
          }
        } else {
          child.kill();
        }
        child.unref();
      }),
  );
});

export const readCopilotUsageLimits = Effect.fn("CopilotUsage.readUsageLimits")(function* (input: {
  readonly settings: AcpRegistrySettings;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}) {
  if (!input.settings.enabled || !isCopilotAgent(input.settings)) return undefined;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
  return yield* catalog.resolve(input.settings, input.cwd, input.environment).pipe(
    Effect.flatMap((resolved) => requestQuota(resolved.spawn)),
    Effect.map((payload) => copilotUsageLimits(payload, checkedAt)),
    Effect.timeoutOrElse({
      duration: "15 seconds",
      orElse: () => Effect.fail(new CopilotUsageError({ cause: "quota request timed out" })),
    }),
    Effect.orElseSucceed(() => ({
      ...makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Could not read Copilot account usage. Check the provider's sign-in and retry.",
      }),
      externalUsage,
    })),
  );
});
