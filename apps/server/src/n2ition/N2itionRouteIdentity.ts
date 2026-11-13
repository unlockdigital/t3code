// @effect-diagnostics nodeBuiltinImport:off -- Owner-local identity proof files need bounded descriptor reads and synchronous final fingerprints.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import {
  EnvironmentId,
  ThreadId,
  ProviderInstanceId,
  type OrchestrationV2AppThread,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  N2itionConnectionError,
  N2itionInferenceIdentity,
} from "@t3tools/contracts/n2itionConnection";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { providerConfigurationHash } from "@t3tools/shared/providerConfigurationHash";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProcessRunner from "../processRunner.ts";

export type InferenceProof = {
  readonly identity: N2itionInferenceIdentity;
  readonly expiresAt: number;
  readonly routeFiles: ReadonlyArray<{ readonly path: string; readonly fingerprint: string }>;
};

export class N2itionRouteIdentity extends Context.Service<
  N2itionRouteIdentity,
  {
    readonly inspect: (
      thread: Pick<OrchestrationV2AppThread, "projectId" | "modelSelection"> & {
        readonly threadId: ThreadId;
      },
      settings: ServerSettings,
    ) => Effect.Effect<InferenceProof, N2itionConnectionError>;
  }
>()("t3/n2ition/N2itionRouteIdentity") {}

const Registration = Schema.Struct({
  version: Schema.Literal(1),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  providerConfigHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  profileHome: Schema.String.check(Schema.isMaxLength(4096)),
  hermesSessionId: Schema.String.check(Schema.isPattern(/^local-[a-f0-9]{64}$/)),
  helperHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
const Proof = Schema.Struct({
  identity: N2itionInferenceIdentity,
  expiresAt: Schema.Finite,
  routeFiles: Schema.Array(
    Schema.Struct({
      path: Schema.String.check(Schema.isMaxLength(4096)),
      fingerprint: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
    }),
  ).check(Schema.isMaxLength(6)),
});
const decodeRegistration = Schema.decodeUnknownSync(Schema.fromJsonString(Registration), {
  onExcessProperty: "error",
});
const decodeProof = Schema.decodeUnknownSync(Schema.fromJsonString(Proof), {
  onExcessProperty: "error",
});
const unavailable = () => new N2itionConnectionError({ reason: "identity_unverified" });

// Both attestation and the synchronous consent boundary use exact bytes so a
// same-size replacement with restored timestamps cannot preserve an old lease.
export function inferenceFileFingerprint(path: string) {
  if (NodeFS.realpathSync(path) !== path) throw unavailable();
  const fd = NodeFS.openSync(
    path,
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
  );
  try {
    const before = NodeFS.fstatSync(fd);
    if (
      !before.isFile() ||
      before.uid !== process.getuid?.() ||
      before.nlink !== 1 ||
      (before.mode & 0o022) !== 0 ||
      before.size > 1048576
    )
      throw unavailable();
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = NodeFS.readSync(fd, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
    }
    const after = NodeFS.fstatSync(fd);
    const current = NodeFS.lstatSync(path);
    if (
      count !== before.size ||
      before.size !== after.size ||
      before.ctimeMs !== after.ctimeMs ||
      before.mtimeMs !== after.mtimeMs ||
      NodeFS.realpathSync(path) !== path ||
      !current.isFile() ||
      current.dev !== after.dev ||
      current.ino !== after.ino ||
      after.nlink !== 1
    )
      throw unavailable();
    return (
      "sha256:" + NodeCrypto.createHash("sha256").update(bytes.subarray(0, count)).digest("hex")
    );
  } finally {
    NodeFS.closeSync(fd);
  }
}

const readPrivate = (path: string, maxBytes: number) => {
  if (NodeFS.realpathSync(path) !== path) throw unavailable();
  const fd = NodeFS.openSync(
    path,
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
  );
  try {
    const stat = NodeFS.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0 ||
      stat.nlink !== 1 ||
      stat.size > maxBytes
    )
      throw unavailable();
    const bytes = Buffer.alloc(maxBytes + 1);
    const length = NodeFS.readSync(fd, bytes, 0, bytes.length, 0);
    if (length > maxBytes) throw unavailable();
    return {
      bytes: bytes.subarray(0, length),
      fingerprint:
        "sha256:" + NodeCrypto.createHash("sha256").update(bytes.subarray(0, length)).digest("hex"),
    };
  } finally {
    NodeFS.closeSync(fd);
  }
};

const filesCurrent = (proof: InferenceProof) =>
  proof.routeFiles.every((file) => {
    if (NodeFS.realpathSync(file.path) !== file.path) return false;
    return inferenceFileFingerprint(file.path) === file.fingerprint;
  });

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const runner = yield* ProcessRunner.ProcessRunner;
  const filename = NodePath.join(config.stateDir, "n2ition-runtime.json");
  let cached: { key: string; proof: InferenceProof } | null = null;
  const inspect = Effect.fn("N2itionRouteIdentity.inspect")(function* (
    thread: Parameters<N2itionRouteIdentity["Service"]["inspect"]>[0],
    settings: ServerSettings,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const environmentId = yield* environment.getEnvironmentId;
    const prepared = yield* Effect.try({
      try: () => {
        const raw = readPrivate(filename, 8192);
        const registration = decodeRegistration(raw.bytes.toString("utf8"));
        const instance = settings.providerInstances[thread.modelSelection.instanceId];
        const home = registration.profileHome;
        if (
          registration.environmentId !== environmentId ||
          registration.threadId !== thread.threadId ||
          registration.providerInstanceId !== thread.modelSelection.instanceId ||
          instance?.driver !== "acpRegistry" ||
          instance.enabled === false ||
          registration.providerConfigHash !== providerConfigurationHash(instance) ||
          !NodePath.isAbsolute(home) ||
          NodeFS.realpathSync(home) !== home
        )
          throw unavailable();
        const helper = NodePath.join(home, "libexec", "teddy-runtime", "identity.py");
        const contents = readPrivate(helper, 65536);
        if (
          NodeCrypto.createHash("sha256").update(contents.bytes).digest("hex") !==
          registration.helperHash
        )
          throw unavailable();
        return {
          registration,
          helper,
          files: [
            { path: filename, fingerprint: raw.fingerprint },
            { path: helper, fingerprint: contents.fingerprint },
          ],
          key: providerConfigurationHash([
            raw.fingerprint,
            contents.fingerprint,
            thread.modelSelection,
          ]),
        };
      },
      catch: unavailable,
    });
    if (
      cached?.key === prepared.key &&
      cached.proof.expiresAt > now &&
      (yield* Effect.try({ try: () => filesCurrent(cached!.proof), catch: unavailable }))
    )
      return cached.proof;
    const result = yield* runner
      .run({
        command: NodePath.join(prepared.registration.profileHome, "venv", "bin", "python"),
        args: [
          "-I",
          prepared.helper,
          "--home",
          prepared.registration.profileHome,
          "--session",
          prepared.registration.hermesSessionId,
        ],
        env: {
          HERMES_HOME: prepared.registration.profileHome,
          CODEX_HOME: NodePath.join(prepared.registration.profileHome, "codex-empty"),
          PYTHONDONTWRITEBYTECODE: "1",
        },
        timeout: "10 seconds",
        maxOutputBytes: 16384,
        outputMode: "error",
      })
      .pipe(Effect.mapError(unavailable));
    const checkedAt = yield* Clock.currentTimeMillis;
    const proof = yield* Effect.try({
      try: () => {
        if (result.code !== 0 || result.stdoutTruncated || result.stderrTruncated)
          throw unavailable();
        const proof = decodeProof(result.stdout);
        const home = prepared.registration.profileHome;
        if (
          proof.expiresAt <= checkedAt ||
          proof.expiresAt > checkedAt + 30000 ||
          proof.identity.profileHome !== home ||
          new Set(proof.routeFiles.map((file) => file.path)).size !== proof.routeFiles.length ||
          proof.routeFiles.length === 0 ||
          proof.routeFiles.some(
            (file) =>
              !file.path.startsWith(home + NodePath.sep) ||
              NodeFS.realpathSync(file.path) !== file.path,
          )
        )
          throw unavailable();
        const complete = { ...proof, routeFiles: [...proof.routeFiles, ...prepared.files] };
        if (!filesCurrent(complete)) throw unavailable();
        return complete;
      },
      catch: unavailable,
    });
    cached = { key: prepared.key, proof };
    return proof;
  });
  return N2itionRouteIdentity.of({ inspect });
});
export const layer = Layer.effect(N2itionRouteIdentity, make);
