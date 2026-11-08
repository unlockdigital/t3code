// @effect-diagnostics nodeBuiltinImport:off -- Bounded synchronous local reads establish the final consent boundary without an await gap.
import * as NodeFS from "node:fs";
import {
  N2itionGrant,
  N2itionConnectionError,
  type N2itionControlInput,
} from "@t3tools/contracts/n2itionConnection";
import * as Option from "effect/Option";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
import { providerConfigurationHash } from "@t3tools/shared/providerConfigurationHash";
import { n2itionSourceCredentialHash } from "./routeConsent.ts";
import type { InferenceProof } from "./N2itionRouteIdentity.ts";
import { inferenceFileFingerprint } from "./N2itionRouteIdentity.ts";

const grantCodec = Schema.fromJsonString(N2itionGrant);
const decodeGrant = Schema.decodeUnknownEffect(grantCodec, { onExcessProperty: "error" });
const encodeGrant = Schema.encodeEffect(grantCodec);
// Synchronous decoding is intentional at the bounded local consent boundary.
const decodeBoundaryGrant = Schema.decodeSync(grantCodec, { onExcessProperty: "error" });
const isConnectionError = Schema.is(N2itionConnectionError);
export class N2itionGrantStore extends Context.Service<
  N2itionGrantStore,
  {
    readonly read: Effect.Effect<N2itionGrant | null, N2itionConnectionError>;
    readonly control: (
      input: N2itionControlInput,
    ) => Effect.Effect<N2itionGrant, N2itionConnectionError>;
    readonly reenroll?: (
      prepared: N2itionGrant,
      expectedEpoch: number,
      proof: InferenceProof,
    ) => Effect.Effect<N2itionGrant, N2itionConnectionError>;
    // The continuation starts transport or commits a local result and finishes
    // before waiting on any network response. Controls share this boundary.
    // Read-only legacy adapters can omit it; context then fails closed.
    readonly withConsent?: <A, E, R>(
      expected: N2itionGrant,
      use: (credential: Uint8Array) => Effect.Effect<A, E, R>,
      proof?: InferenceProof,
    ) => Effect.Effect<A, E | N2itionConnectionError, R>;
    readonly checkRouteFiles: (grant: N2itionGrant) => Effect.Effect<void, N2itionConnectionError>;
  }
>()("t3/n2ition/N2itionGrantStore") {}

export function validateGrant(grant: N2itionGrant, now: number) {
  const url = new URL(grant.origin);
  const validOrigin =
    grant.source === "live"
      ? grant.origin === "https://n2ition.unlockdigitalmedia.com"
      : url.protocol === "http:" &&
        url.hostname === "127.0.0.1" &&
        url.pathname === "/" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash;
  if (!validOrigin) throw new N2itionConnectionError({ reason: "invalid_data" });
  if (grant.mode !== "active") throw new N2itionConnectionError({ reason: grant.mode });
  if (Date.parse(grant.expiresAt) <= now) throw new N2itionConnectionError({ reason: "expired" });
  if (grant.source === "live" && (!grant.routeBinding || !grant.sourceCredentialHash))
    throw new N2itionConnectionError({ reason: "route_changed" });
  if (
    grant.source === "live" &&
    (!grant.privacyVerified || !grant.sharedProcessAccepted || !grant.routeFiles.length)
  )
    throw new N2itionConnectionError({ reason: "privacy_required" });
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const filename = path.join(config.stateDir, "n2ition-connection.json");
  const lock = yield* Semaphore.make(1);
  const read = Effect.gen(function* () {
    if (!(yield* fs.exists(filename))) return null;
    const stat = yield* fs.stat(filename);
    if (stat.type !== "File" || Number(stat.size) > 8192 || (stat.mode & 0o077) !== 0)
      return yield* new N2itionConnectionError({ reason: "invalid_data" });
    const text = yield* fs.readFileString(filename);
    return yield* decodeGrant(text);
  }).pipe(Effect.mapError(() => new N2itionConnectionError({ reason: "unavailable" })));
  const control = Effect.fn("N2itionGrantStore.control")(function* (input: N2itionControlInput) {
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* read;
        if (!current) return yield* new N2itionConnectionError({ reason: "disabled" });
        if (current.epoch !== input.expectedEpoch)
          return yield* new N2itionConnectionError({ reason: "changed" });
        if (current.mode === "revoked")
          return yield* new N2itionConnectionError({ reason: "revoked" });
        const next = {
          ...current,
          mode:
            input.action === "resume"
              ? ("active" as const)
              : input.action === "pause"
                ? ("paused" as const)
                : ("revoked" as const),
          epoch: current.epoch + 1,
        };
        if (input.action === "resume") {
          const now = yield* Clock.currentTimeMillis;
          yield* Effect.try({
            try: () => validateGrant(next, now),
            catch: (error) =>
              isConnectionError(error)
                ? error
                : new N2itionConnectionError({ reason: "invalid_data" }),
          });
        }
        yield* Effect.scoped(
          Effect.gen(function* () {
            const directory = yield* fs.makeTempDirectoryScoped({
              directory: config.stateDir,
              prefix: "n2ition-control-",
            });
            const temporary = path.join(directory, "grant.json");
            const contents = yield* encodeGrant(next);
            yield* fs.writeFileString(temporary, contents, { mode: 0o600 });
            yield* fs.rename(temporary, filename);
          }),
        ).pipe(Effect.mapError(() => new N2itionConnectionError({ reason: "unavailable" })));
        return next;
      }),
    );
  });
  const checkRouteFiles = Effect.fn("N2itionGrantStore.checkRouteFiles")(function* (
    grant: N2itionGrant,
  ) {
    // Session issuance may use this preliminary check. Verified routes bind fresh
    // proof metadata at withConsent, so enrollment fingerprints can age safely.
    if (grant.routeBinding && "version" in grant.routeBinding) return;
    for (const file of grant.routeFiles) {
      const stat = yield* fs
        .stat(file.path)
        .pipe(Effect.mapError(() => new N2itionConnectionError({ reason: "route_changed" })));
      const fingerprint = `${Option.getOrUndefined(stat.ino)}:${Number(stat.size)}:${stat.mtime._tag === "Some" ? stat.mtime.value.getTime() : "none"}`;
      if (fingerprint !== file.fingerprint)
        return yield* new N2itionConnectionError({ reason: "route_changed" });
    }
  });
  // A single bounded read of the opened file also avoids stat/read path swaps.
  const readBounded = (filename: string, limit: number, privateMode = false) => {
    const fd = NodeFS.openSync(
      filename,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
    );
    try {
      const stat = NodeFS.fstatSync(fd);
      if (!stat.isFile() || stat.size > limit || (privateMode && (stat.mode & 0o077) !== 0))
        throw new N2itionConnectionError({ reason: "invalid_data" });
      const bytes = Buffer.alloc(limit + 1);
      const count = NodeFS.readSync(fd, bytes, 0, limit + 1, 0);
      if (count > limit) throw new N2itionConnectionError({ reason: "invalid_data" });
      return bytes.subarray(0, count);
    } finally {
      NodeFS.closeSync(fd);
    }
  };
  const checkBoundaryFiles = (grant: N2itionGrant, now: number, proof?: InferenceProof) => {
    let files = grant.routeFiles;
    if (grant.routeBinding && "version" in grant.routeBinding) {
      if (!proof || !Number.isFinite(proof.expiresAt) || proof.expiresAt <= now)
        throw new N2itionConnectionError({ reason: "identity_unverified" });
      if (
        providerConfigurationHash(proof.identity) !==
          providerConfigurationHash(grant.routeBinding.identity) ||
        providerConfigurationHash(proof.routeFiles.map((file) => file.path).sort()) !==
          providerConfigurationHash(grant.routeFiles.map((file) => file.path).sort())
      )
        throw new N2itionConnectionError({ reason: "route_changed" });
      files = proof.routeFiles;
    }
    for (const file of files) {
      if (grant.routeBinding && "version" in grant.routeBinding) {
        if (
          !/^sha256:[a-f0-9]{64}$/.test(file.fingerprint) ||
          inferenceFileFingerprint(file.path) !== file.fingerprint
        )
          throw new N2itionConnectionError({ reason: "route_changed" });
        continue;
      }
      const fd = NodeFS.openSync(
        file.path,
        NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
      );
      try {
        const stat = NodeFS.fstatSync(fd);
        if (
          !stat.isFile() ||
          `${stat.ino}:${stat.size}:${Math.trunc(stat.mtimeMs)}` !== file.fingerprint
        )
          throw new N2itionConnectionError({ reason: "route_changed" });
      } finally {
        NodeFS.closeSync(fd);
      }
    }
  };
  const readBoundaryCredential = (current: N2itionGrant) => {
    let token: Uint8Array;
    try {
      token = readBounded(path.join(config.secretsDir, "n2ition-read-token.bin"), 512);
    } catch {
      throw new N2itionConnectionError({
        reason: current.source === "live" ? "route_changed" : "unavailable",
      });
    }
    if (
      token.length < 32 ||
      (current.source === "live" &&
        n2itionSourceCredentialHash(token, current) !== current.sourceCredentialHash)
    )
      throw new N2itionConnectionError({
        reason: current.source === "live" ? "route_changed" : "unavailable",
      });
    return token;
  };
  const withConsent: NonNullable<N2itionGrantStore["Service"]["withConsent"]> = (
    expected,
    use,
    proof,
  ) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const credential = yield* Effect.try({
          try: () => {
            const current = decodeBoundaryGrant(readBounded(filename, 8192, true).toString("utf8"));
            validateGrant(current, now);
            if (providerConfigurationHash(current) !== providerConfigurationHash(expected))
              throw new N2itionConnectionError({ reason: "changed" });
            checkBoundaryFiles(current, now, proof);
            return readBoundaryCredential(current);
          },
          catch: (error) =>
            isConnectionError(error)
              ? error
              : new N2itionConnectionError({ reason: "route_changed" }),
        });
        return yield* use(credential);
      }).pipe(Effect.provideService(References.PreventSchedulerYield, true)),
    );
  const reenroll = Effect.fn("N2itionGrantStore.reenroll")(function* (
    prepared: N2itionGrant,
    expectedEpoch: number,
    proof: InferenceProof,
  ) {
    return yield* lock
      .withPermits(1)(
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* read;
            if (!current) return yield* new N2itionConnectionError({ reason: "disabled" });
            if (current.epoch !== expectedEpoch)
              return yield* new N2itionConnectionError({ reason: "changed" });
            if (current.mode === "revoked")
              return yield* new N2itionConnectionError({ reason: "revoked" });
            if (
              current.source !== "live" ||
              !prepared.routeBinding ||
              !("version" in prepared.routeBinding)
            )
              return yield* new N2itionConnectionError({ reason: "route_changed" });
            // Only the qualified inference binding changes. Source consent and controls
            // retain their original scope and expiry, including a paused local mode.
            const next = {
              ...current,
              model: prepared.model,
              routeBinding: prepared.routeBinding,
              routeFiles: prepared.routeFiles,
              epoch: current.epoch + 1,
            };
            if (
              prepared.model !== proof.identity.upstreamModel ||
              providerConfigurationHash({ ...next, epoch: current.epoch }) !==
                providerConfigurationHash(prepared)
            )
              return yield* new N2itionConnectionError({ reason: "route_changed" });
            const directory = yield* fs.makeTempDirectoryScoped({
              directory: config.stateDir,
              prefix: "n2ition-reconnect-",
            });
            const temporary = path.join(directory, "grant.json");
            const contents = yield* encodeGrant(next);
            // Later pause/revoke writes need room for mode and epoch growth.
            if (Buffer.byteLength(contents, "utf8") > 8192 - 64)
              return yield* new N2itionConnectionError({ reason: "too_large" });
            yield* fs.writeFileString(temporary, contents, { mode: 0o600 });
            const now = yield* Clock.currentTimeMillis;
            yield* Effect.try({
              try: () => {
                const latest = decodeBoundaryGrant(
                  readBounded(filename, 8192, true).toString("utf8"),
                );
                if (providerConfigurationHash(latest) !== providerConfigurationHash(current))
                  throw new N2itionConnectionError({ reason: "changed" });
                validateGrant({ ...next, mode: "active" }, now);
                checkBoundaryFiles(next, now, proof);
                readBoundaryCredential(current);
                NodeFS.renameSync(temporary, filename);
              },
              catch: (error) =>
                isConnectionError(error)
                  ? error
                  : new N2itionConnectionError({ reason: "route_changed" }),
            }).pipe(Effect.provideService(References.PreventSchedulerYield, true));
            return next;
          }),
        ),
      )
      .pipe(
        Effect.mapError((error) =>
          isConnectionError(error) ? error : new N2itionConnectionError({ reason: "unavailable" }),
        ),
      );
  });
  return N2itionGrantStore.of({ read, control, reenroll, checkRouteFiles, withConsent });
});
export const layer = Layer.effect(N2itionGrantStore, make);
