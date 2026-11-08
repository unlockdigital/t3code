// @effect-diagnostics nodeBuiltinImport:off -- Temporary owner files exercise the actual proof boundary.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it, vi } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { providerConfigurationHash } from "@t3tools/shared/providerConfigurationHash";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as RouteIdentity from "./N2itionRouteIdentity.ts";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const temporary = yield* fs.makeTempDirectoryScoped({
    directory: NodeOS.tmpdir(),
    prefix: "t3-inference-proof-",
  });
  const root = NodeFS.realpathSync(temporary);
  yield* Effect.service(ServerConfig.ServerConfig).pipe(
    Effect.asVoid,
    Effect.provide(ServerConfig.layerTest(root, root)),
  );
  const home = NodePath.join(root, "profile");
  const helper = NodePath.join(home, "libexec", "teddy-runtime", "identity.py");
  NodeFS.mkdirSync(NodePath.dirname(helper), { recursive: true, mode: 0o700 });
  NodeFS.writeFileSync(helper, "synthetic identity helper\n", { mode: 0o600 });
  const auth = NodePath.join(home, "auth.json");
  NodeFS.writeFileSync(auth, "synthetic credential generation one", { mode: 0o600 });
  const instanceId = ProviderInstanceId.make("hermes");
  const environmentId = EnvironmentId.make("environment");
  const thread = {
    threadId: ThreadId.make("teddy"),
    projectId: ProjectId.make("project"),
    modelSelection: { instanceId, model: "openai-codex:gpt-6.1-sol" },
  };
  const instance = {
    driver: ProviderDriverKind.make("acpRegistry"),
    enabled: true,
    config: { commandPath: "/approved/hermes" },
  };
  const settings = { ...DEFAULT_SERVER_SETTINGS, providerInstances: { [instanceId]: instance } };
  const registration = NodePath.join(root, "userdata", "n2ition-runtime.json");
  const enrolled = {
    version: 1,
    environmentId,
    threadId: thread.threadId,
    providerInstanceId: instanceId,
    providerConfigHash: providerConfigurationHash(instance),
    profileHome: home,
    hermesSessionId: "local-" + "1".repeat(64),
    helperHash: NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(helper)).digest("hex"),
  };
  NodeFS.writeFileSync(registration, JSON.stringify(enrolled), { mode: 0o600 });
  const now = yield* Clock.currentTimeMillis;
  const identity = {
    version: 1 as const,
    upstreamProvider: "openai-codex" as const,
    upstreamModel: "gpt-6.1-sol",
    endpoint: "https://chatgpt.com/backend-api/codex" as const,
    profileHome: home,
    credentialSource: auth + ":single-pool-slot",
    accountHash: "a".repeat(64),
    runtimePolicyHash: "b".repeat(64),
  };
  const fingerprint = (path: string) => {
    return (
      "sha256:" + NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(path)).digest("hex")
    );
  };
  const proof = () => ({
    identity,
    expiresAt: now + 25000,
    routeFiles: [{ path: auth, fingerprint: fingerprint(auth) }],
  });
  const calls: ProcessRunner.ProcessRunInput[] = [];
  let response = () => proof();
  let afterResponse = () => {};
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.sync(() => {
        calls.push(input);
        const body = response();
        afterResponse();
        return {
          stdout: JSON.stringify(body),
          stderr: "",
          code: 0 as NonNullable<ProcessRunner.ProcessRunOutput["code"]>,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  });
  const layer = RouteIdentity.layer.pipe(
    Layer.provide(ServerConfig.layerTest(root, root)),
    Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
    Layer.provide(
      Layer.succeed(
        ServerEnvironment.ServerEnvironment,
        ServerEnvironment.ServerEnvironment.of({
          getEnvironmentId: Effect.succeed(environmentId),
          getDescriptor: Effect.die("Unused fixture descriptor"),
        }),
      ),
    ),
  );
  return {
    home,
    helper,
    auth,
    registration,
    thread,
    settings,
    calls,
    layer,
    proof,
    setResponse: (value: typeof response) => {
      response = value;
    },
    setAfterResponse: (value: typeof afterResponse) => {
      afterResponse = value;
    },
  };
});
const use = <A, E, R>(
  run: (
    f: Effect.Success<typeof fixture>,
  ) => Effect.Effect<A, E, R | RouteIdentity.N2itionRouteIdentity>,
) =>
  Effect.gen(function* () {
    const f = yield* fixture;
    return yield* run(f).pipe(Effect.provide(f.layer));
  }).pipe(Effect.provide(NodeServices.layer));

it.effect("uses the enrolled owner runtime and reuses only a current proof", () =>
  use((f) =>
    Effect.gen(function* () {
      const service = yield* RouteIdentity.N2itionRouteIdentity;
      const first = yield* service.inspect(f.thread, f.settings);
      const second = yield* service.inspect(f.thread, f.settings);
      expect(first).toEqual(second);
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]?.args).toEqual([
        "-I",
        f.helper,
        "--home",
        f.home,
        "--session",
        "local-" + "1".repeat(64),
      ]);
      expect(first.routeFiles.map((file) => file.path)).toEqual([f.auth, f.registration, f.helper]);
    }),
  ),
);

it.effect("re-verifies renewed credential files while retaining the verified account", () =>
  use((f) =>
    Effect.gen(function* () {
      const service = yield* RouteIdentity.N2itionRouteIdentity;
      const first = yield* service.inspect(f.thread, f.settings);
      NodeFS.appendFileSync(f.auth, " renewed");
      const second = yield* service.inspect(f.thread, f.settings);
      expect(first.identity).toEqual(second.identity);
      expect(first.routeFiles[0]).not.toEqual(second.routeFiles[0]);
      expect(f.calls).toHaveLength(2);
    }),
  ),
);

it.effect("detects equal-size credential replacement with restored modification time", () =>
  use((f) =>
    Effect.gen(function* () {
      const service = yield* RouteIdentity.N2itionRouteIdentity;
      yield* service.inspect(f.thread, f.settings);
      const before = NodeFS.statSync(f.auth);
      NodeFS.writeFileSync(f.auth, NodeFS.readFileSync(f.auth, "utf8").replace("one", "two"));
      NodeFS.utimesSync(f.auth, before.atime, before.mtime);
      yield* service.inspect(f.thread, f.settings);
      expect(f.calls).toHaveLength(2);
    }),
  ),
);

it.effect("rejects a parent-directory replacement while its credential descriptor is open", () =>
  use((f) =>
    Effect.gen(function* () {
      const service = yield* RouteIdentity.N2itionRouteIdentity;
      yield* service.inspect(f.thread, f.settings);
      const inode = NodeFS.statSync(f.auth).ino;
      const helperBytes = NodeFS.readFileSync(f.helper);
      const original = NodeFS.readSync;
      let swapped = false;
      // CommonJS exports remain mutable; synchronize the ESM binding the service reads.
      const mutableFS = NodeModule.createRequire(import.meta.url)("node:fs") as typeof NodeFS;
      const read = vi.spyOn(mutableFS, "readSync").mockImplementation((...args) => {
        const count = Reflect.apply(original, NodeFS, args) as number;
        if (!swapped && NodeFS.fstatSync(args[0]).ino === inode) {
          swapped = true;
          NodeFS.renameSync(f.home, f.home + ".previous");
          NodeFS.mkdirSync(NodePath.dirname(f.helper), { recursive: true, mode: 0o700 });
          NodeFS.writeFileSync(f.helper, helperBytes, { mode: 0o600 });
          NodeFS.writeFileSync(f.auth, "another account at the same credential path", {
            mode: 0o600,
          });
        }
        return count;
      });
      NodeModule.syncBuiltinESMExports();
      try {
        const rejected = yield* service.inspect(f.thread, f.settings).pipe(Effect.flip);
        expect(swapped).toBe(true);
        expect(rejected.reason).toBe("identity_unverified");
        expect(f.calls).toHaveLength(1);
      } finally {
        read.mockRestore();
        NodeModule.syncBuiltinESMExports();
      }
    }),
  ),
);

it.effect("rejects a nonregular owner proof file without waiting for a writer", () =>
  use((f) =>
    Effect.gen(function* () {
      const service = yield* RouteIdentity.N2itionRouteIdentity;
      NodeFS.unlinkSync(f.registration);
      if ((yield* HostProcess.Platform) === "win32") NodeFS.mkdirSync(f.registration);
      else {
        NodeChildProcess.execFileSync("mkfifo", [f.registration]);
        NodeFS.chmodSync(f.registration, 0o600);
      }
      expect((yield* service.inspect(f.thread, f.settings).pipe(Effect.flip)).reason).toBe(
        "identity_unverified",
      );
      expect(f.calls).toHaveLength(0);
    }),
  ),
);

it.effect("refuses unknown environments, changed provider routes and changed helpers", () =>
  use((f) =>
    Effect.gen(function* () {
      const service = yield* RouteIdentity.N2itionRouteIdentity;
      const denied = yield* service
        .inspect({ ...f.thread, threadId: ThreadId.make("other") }, f.settings)
        .pipe(Effect.flip);
      expect(denied.reason).toBe("identity_unverified");
      const changed = {
        ...f.settings,
        providerInstances: {
          [f.thread.modelSelection.instanceId]: {
            ...f.settings.providerInstances[f.thread.modelSelection.instanceId]!,
            config: { commandPath: "/other/hermes" },
          },
        },
      };
      expect((yield* service.inspect(f.thread, changed).pipe(Effect.flip)).reason).toBe(
        "identity_unverified",
      );
      NodeFS.appendFileSync(f.helper, "changed");
      expect((yield* service.inspect(f.thread, f.settings).pipe(Effect.flip)).reason).toBe(
        "identity_unverified",
      );
      expect(f.calls).toHaveLength(0);
    }),
  ),
);

it.effect("refuses expired, unbounded and foreign-profile proof output", () =>
  use((f) =>
    Effect.gen(function* () {
      const service = yield* RouteIdentity.N2itionRouteIdentity;
      for (const change of [
        { expiresAt: 0 },
        { expiresAt: Number.MAX_SAFE_INTEGER },
        { identity: { ...f.proof().identity, profileHome: "/other/profile" } },
        { routeFiles: [{ path: f.registration, fingerprint: "1:2:3" }] },
      ]) {
        f.setResponse(() => ({ ...f.proof(), ...change }));
        expect((yield* service.inspect(f.thread, f.settings).pipe(Effect.flip)).reason).toBe(
          "identity_unverified",
        );
      }
    }),
  ),
);

it.effect("rejects credential changes between runtime attestation and release", () =>
  use((f) =>
    Effect.gen(function* () {
      const service = yield* RouteIdentity.N2itionRouteIdentity;
      f.setAfterResponse(() => NodeFS.appendFileSync(f.auth, " replaced"));
      expect((yield* service.inspect(f.thread, f.settings).pipe(Effect.flip)).reason).toBe(
        "identity_unverified",
      );
    }),
  ),
);

it.effect("rejects public and symbolic enrollment files before launching a helper", () =>
  use((f) =>
    Effect.gen(function* () {
      const service = yield* RouteIdentity.N2itionRouteIdentity;
      NodeFS.chmodSync(f.registration, 0o644);
      expect((yield* service.inspect(f.thread, f.settings).pipe(Effect.flip)).reason).toBe(
        "identity_unverified",
      );
      NodeFS.chmodSync(f.registration, 0o600);
      NodeFS.renameSync(f.registration, f.registration + ".original");
      NodeFS.symlinkSync(f.registration + ".original", f.registration);
      expect((yield* service.inspect(f.thread, f.settings).pipe(Effect.flip)).reason).toBe(
        "identity_unverified",
      );
      expect(f.calls).toHaveLength(0);
    }),
  ),
);
