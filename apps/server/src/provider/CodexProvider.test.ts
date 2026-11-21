import * as NodeServices from "@effect/platform-node/NodeServices";
import { CodexSettings } from "@t3tools/contracts";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as TestClock from "effect/testing/TestClock";
import * as HostProcess from "@t3tools/shared/HostProcess";

import {
  applyPreferredCodexDefaultModel,
  checkCodexProviderStatus,
  codexCustomEndpoint,
  codexRoutesSpendNativeQuota,
  makeCodexSkillsProbe,
  mapCodexModelCapabilities,
} from "./CodexProvider.ts";

function makeFakeCodexAppServers() {
  const helpers: Array<{
    readonly codexHome: unknown;
    readonly crash: Effect.Effect<void>;
    readonly requests: Array<unknown>;
    closed: boolean;
  }> = [];
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      const output = yield* Queue.unbounded<Uint8Array, Cause.Done>();
      const exited = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      const crash = Deferred.succeed(exited, ChildProcessSpawner.ExitCode(1)).pipe(
        Effect.andThen(Queue.end(output)),
        Effect.asVoid,
      );
      const helper = {
        codexHome: command._tag === "StandardCommand" ? command.options.env?.CODEX_HOME : undefined,
        crash,
        requests: [] as Array<unknown>,
        closed: false,
      };
      helpers.push(helper);
      yield* Effect.addFinalizer(() => Effect.sync(() => (helper.closed = true)));
      const respond = (id: unknown, result: unknown) =>
        Queue.offer(output, new TextEncoder().encode(`${JSON.stringify({ id, result })}\n`));
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(900_000_000 + helpers.length),
        exitCode: Deferred.await(exited),
        isRunning: Effect.map(Deferred.isDone(exited), (done) => !done),
        kill: () => crash,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.forEach((chunk: string | Uint8Array) =>
          Effect.forEach(
            (typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
              .split("\n")
              .filter(Boolean),
            (line) => {
              const frame = JSON.parse(line) as {
                readonly id?: number;
                readonly method: string;
                readonly params?: { readonly cwds: ReadonlyArray<string> };
              };
              if (frame.id === undefined) return Effect.void;
              if (frame.method === "initialize") {
                return respond(frame.id, {
                  codexHome: "/codex-home",
                  platformFamily: "unix",
                  platformOs: "linux",
                  userAgent: "codex/0.0.0",
                });
              }
              helper.requests.push(frame.params);
              return respond(frame.id, {
                data: (frame.params?.cwds ?? []).map((cwd) => ({
                  cwd,
                  errors: [],
                  skills: [
                    {
                      name: `skill-in-${cwd}`,
                      path: `${cwd}/SKILL.md`,
                      enabled: true,
                      description: "",
                      scope: "repo",
                    },
                  ],
                })),
              });
            },
            { discard: true },
          ),
        ),
        stdout: Stream.fromQueue(output),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  return { helpers, spawner };
}

it.effect("reuses one Codex skills helper per launch until it idles out", () =>
  Effect.gen(function* () {
    const { helpers, spawner } = makeFakeCodexAppServers();
    const providerScope = yield* Scope.make();
    const probe = yield* makeCodexSkillsProbe().pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Scope.provide(providerScope),
    );
    const read = (cwd: string, homePath = "/home-a") =>
      probe({ binaryPath: "codex", homePath, cwd, environment: {} }).pipe(
        Effect.map((skills) => skills.map((skill) => skill.name)),
      );

    assert.deepStrictEqual(yield* read("/alpha"), ["skill-in-/alpha"]);
    assert.deepStrictEqual(yield* read("/beta"), ["skill-in-/beta"]);
    assert.strictEqual(helpers.length, 1);
    assert.deepStrictEqual(helpers[0]!.requests, [
      { cwds: ["/alpha"], forceReload: true },
      { cwds: ["/beta"], forceReload: true },
    ]);

    // Another home is another launch identity; the previous helper retires at once.
    assert.deepStrictEqual(yield* read("/alpha", "/home-b"), ["skill-in-/alpha"]);
    assert.strictEqual(helpers.length, 2);
    assert.strictEqual(helpers[0]!.closed, true);
    assert.strictEqual(helpers[1]!.codexHome, "/home-b");

    // A helper that exits is replaced within the same read.
    yield* helpers[1]!.crash;
    assert.deepStrictEqual(yield* read("/beta", "/home-b"), ["skill-in-/beta"]);
    assert.strictEqual(helpers.length, 3);

    yield* TestClock.adjust("29 seconds");
    assert.strictEqual(helpers[2]!.closed, false);
    yield* TestClock.adjust("1 second");
    assert.strictEqual(helpers[2]!.closed, true);
    assert.deepStrictEqual(yield* read("/alpha", "/home-b"), ["skill-in-/alpha"]);
    assert.strictEqual(helpers.length, 4);

    yield* Scope.close(providerScope, Exit.void);
    assert.strictEqual(helpers[3]!.closed, true);
  }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
);

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    availableAccessPrograms: { cyber: ["standard", "daybreakBlue"] },
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
    {
      id: "cyberAccessProgram",
      label: "Cyber Access",
      type: "select",
      options: [
        { id: "standard", label: "Standard", isDefault: true },
        { id: "daybreakBlue", label: "Daybreak Blue" },
      ],
      currentValue: "standard",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
      {
        id: "ultrafast",
        name: "Ultrafast",
        description: "The fastest available responses for latency-sensitive work.",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
        {
          id: "ultrafast",
          label: "Ultrafast",
          description: "Even faster, more expensive",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("ranks qualified Codex models while preserving their wire ids", () => {
  const models = applyPreferredCodexDefaultModel([
    {
      slug: "openai.gpt-5.6-luna",
      name: "Luna",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
    { slug: "openai.gpt-5.6-sol", name: "Sol", isCustom: false, capabilities: null },
  ]);
  assert.deepStrictEqual(
    models.filter((model) => model.isDefault).map((model) => model.slug),
    ["openai.gpt-5.6-sol"],
  );
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

const decodeCodexSettings = Schema.decodeEffect(CodexSettings);

const makeAccountProbeFixture = Effect.fn("makeAccountProbeFixture")(function* (
  accountReplies: ReadonlyArray<"ready" | "signedOut" | "hang" | { code: number; message: string }>,
  firstAccountReplyGate?: Deferred.Deferred<void>,
) {
  const output = yield* Queue.unbounded<Uint8Array>();
  const released = yield* Deferred.make<void>();
  const hanging = yield* Deferred.make<void>();
  const started = yield* Deferred.make<void>();
  const requests: string[] = [];
  let accountReads = 0;
  let spawns = 0;
  let releases = 0;
  const encoder = new TextEncoder();
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      const isVersion = command._tag === "StandardCommand" && command.args.includes("--version");
      const checksStartup = command._tag === "StandardCommand" && command.command === "pgrep";
      if (!checksStartup) {
        spawns += 1;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            releases += 1;
          }).pipe(Effect.andThen(isVersion ? Effect.void : Deferred.succeed(released, undefined))),
        );
      }
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode:
          isVersion || checksStartup
            ? Effect.succeed(ChildProcessSpawner.ExitCode(0))
            : Effect.never,
        isRunning: Effect.succeed(!isVersion && !checksStartup),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.forEach((chunk: Uint8Array) =>
          Effect.gen(function* () {
            const { id, method } = JSON.parse(new TextDecoder().decode(chunk)) as {
              id?: number | string;
              method: string;
            };
            if (id === undefined) return;
            requests.push(method);
            let response: { result: unknown } | { error: { code: number; message: string } };
            if (method === "initialize") {
              response = {
                result: {
                  userAgent: "codex/1.0.0",
                  codexHome: "/unused-probe-home",
                  platformFamily: "unix",
                  platformOs: "linux",
                },
              };
            } else if (method === "account/read") {
              const reply = accountReplies[accountReads++];
              if (accountReads === 1 && firstAccountReplyGate) {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(firstAccountReplyGate);
              }
              assert.isDefined(reply, "Unexpected extra account request");
              if (reply === "hang") {
                yield* Deferred.succeed(hanging, undefined);
                return;
              }
              response =
                typeof reply === "object"
                  ? { error: reply }
                  : {
                      result: {
                        account: reply === "signedOut" ? null : { type: "apiKey" },
                        requiresOpenaiAuth: true,
                      },
                    };
            } else if (method === "model/list" || method === "skills/list") {
              response = { result: { data: [], nextCursor: null } };
            } else {
              response = { error: { code: -32601, message: "Optional method unavailable" } };
            }
            yield* Queue.offer(output, encoder.encode(`${JSON.stringify({ id, ...response })}\n`));
          }),
        ),
        stdout: isVersion
          ? Stream.make(encoder.encode("codex-cli 1.0.0\n"))
          : checksStartup
            ? Stream.empty
            : Stream.fromQueue(output),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  const settings = yield* decodeCodexSettings({});
  return {
    run: checkCodexProviderStatus(settings).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.tap(() => Deferred.await(released)),
    ),
    requests,
    hanging,
    started,
    counts: () => ({ accountReads, spawns, releases }),
  };
});

it.layer(NodeServices.layer)("Codex account probe recovery", (it) => {
  it.effect("recovers a transient workspace routing lookup in the same probe process", () =>
    Effect.gen(function* () {
      for (const message of [
        "workspace routing discovery failed",
        "workspace routing discovery timed out",
      ]) {
        const fixture = yield* makeAccountProbeFixture([{ code: -32603, message }, "ready"]);
        const status = yield* fixture.run;
        assert.strictEqual(status.status, "ready", status.message);
        assert.strictEqual(status.auth.status, "authenticated");
        assert.strictEqual(status.version, "1.0.0");
        assert.isUndefined(status.message);
        assert.deepStrictEqual(fixture.requests.slice(0, 3), [
          "initialize",
          "account/read",
          "account/read",
        ]);
        assert.deepStrictEqual(fixture.counts(), { accountReads: 2, spawns: 1, releases: 1 });
      }
    }),
  );

  it.effect("reports persistent workspace routing failures after one retry", () =>
    Effect.gen(function* () {
      for (const message of [
        "workspace routing discovery failed",
        "workspace routing discovery timed out",
      ]) {
        const error = { code: -32603, message };
        const fixture = yield* makeAccountProbeFixture([error, error]);
        const status = yield* fixture.run;
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.auth.status, "unknown");
        assert.strictEqual(status.message, `Codex app-server provider probe failed: ${message}.`);
        assert.strictEqual(status.version, "1.0.0");
        assert.deepStrictEqual(fixture.counts(), { accountReads: 2, spawns: 2, releases: 2 });
      }
    }),
  );

  it.effect("keeps authentication and unrelated request failures to one attempt", () =>
    Effect.gen(function* () {
      for (const error of [
        { code: 401, message: "unauthorized (401)" },
        { code: -32602, message: "Invalid params" },
        { code: -32603, message: "Internal error" },
      ]) {
        const fixture = yield* makeAccountProbeFixture([error]);
        const status = yield* fixture.run;
        assert.strictEqual(status.status, "error");
        assert.strictEqual(
          status.message,
          `Codex app-server provider probe failed: ${error.message}.`,
        );
        assert.strictEqual(status.version, "1.0.0");
        assert.deepStrictEqual(fixture.counts(), { accountReads: 1, spawns: 2, releases: 2 });
      }
    }),
  );

  it.effect("preserves healthy and signed-out account results", () =>
    Effect.gen(function* () {
      for (const reply of ["ready", "signedOut"] as const) {
        const fixture = yield* makeAccountProbeFixture([reply]);
        const status = yield* fixture.run;
        assert.strictEqual(status.status, reply === "ready" ? "ready" : "error");
        assert.strictEqual(
          status.auth.status,
          reply === "ready" ? "authenticated" : "unauthenticated",
        );
        assert.deepStrictEqual(fixture.counts(), { accountReads: 1, spawns: 1, releases: 1 });
      }
    }),
  );

  it.effect(
    "keeps a stalled retry within the existing probe timeout and releases its process",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const fixture = yield* makeAccountProbeFixture(
          [{ code: -32603, message: "workspace routing discovery timed out" }, "hang"],
          gate,
        );
        const fiber = yield* fixture.run.pipe(Effect.forkChild);
        yield* Deferred.await(fixture.started);
        yield* TestClock.adjust("15 seconds");
        yield* Deferred.succeed(gate, undefined);
        yield* Deferred.await(fixture.hanging);
        yield* TestClock.adjust("5 seconds");
        const status = yield* Fiber.join(fiber);
        assert.strictEqual(status.status, "error");
        assert.strictEqual(
          status.message,
          "Timed out while checking Codex app-server provider status.",
        );
        assert.deepStrictEqual(fixture.counts(), { accountReads: 2, spawns: 1, releases: 1 });
      }),
  );
});

it("reports native quota only for an OpenAI login on a native route", () => {
  const chatgpt = { type: "chatgpt", email: "a@example.com", planType: "pro" } as const;
  const hub = {
    model_provider: "hub",
    model_providers: { hub: { base_url: "https://hub.example.com/v1" } },
  };
  const cases = [
    ["default route", chatgpt, true, {}, true],
    ["openai base url", chatgpt, true, { openai_base_url: "https://chatgpt.com/x" }, true],
    ["openai proxy url", chatgpt, true, { openai_base_url: "https://proxy.example.com" }, false],
    ["custom provider", chatgpt, true, hub, false],
    ["unknown provider id", chatgpt, true, { model_provider: "missing" }, false],
    ["unreadable config", chatgpt, true, null, false],
    ["login not required", chatgpt, false, {}, false],
    ["api key", { type: "apiKey" }, true, {}, false],
  ] as const;
  for (const [name, account, requiresOpenaiAuth, config, expected] of cases) {
    assert.strictEqual(
      codexRoutesSpendNativeQuota({ account, requiresOpenaiAuth }, config),
      expected,
      name,
    );
  }
  // The custom endpoint is what a usage-limit hub is matched against.
  assert.strictEqual(codexCustomEndpoint(hub), "https://hub.example.com");
  assert.strictEqual(
    codexCustomEndpoint({ openai_base_url: "http://127.0.0.1:8317/v1" }),
    "http://127.0.0.1:8317",
  );
  assert.strictEqual(codexCustomEndpoint({ openai_base_url: "https://chatgpt.com/x" }), undefined);
  assert.strictEqual(codexCustomEndpoint({}), undefined);
});
