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
    // The continuation starts transport or commits a local result and finishes
    // before waiting on any network response. Controls share this boundary.
    // Read-only legacy adapters can omit it; context then fails closed.
    readonly withConsent?: <A, E, R>(
      expected: N2itionGrant,
      use: (credential: Uint8Array) => Effect.Effect<A, E, R>,
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
    if (Number(stat.size) > 8192 || (stat.mode & 0o077) !== 0)
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
    const fd = NodeFS.openSync(filename, "r");
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
  const withConsent: NonNullable<N2itionGrantStore["Service"]["withConsent"]> = (expected, use) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const credential = yield* Effect.try({
          try: () => {
            const current = decodeBoundaryGrant(readBounded(filename, 8192, true).toString("utf8"));
            validateGrant(current, now);
            if (providerConfigurationHash(current) !== providerConfigurationHash(expected))
              throw new N2itionConnectionError({ reason: "changed" });
            for (const file of current.routeFiles) {
              const stat = NodeFS.statSync(file.path);
              if (`${stat.ino}:${stat.size}:${Math.trunc(stat.mtimeMs)}` !== file.fingerprint)
                throw new N2itionConnectionError({ reason: "route_changed" });
            }
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
          },
          catch: (error) =>
            isConnectionError(error)
              ? error
              : new N2itionConnectionError({ reason: "route_changed" }),
        });
        return yield* use(credential);
      }).pipe(Effect.provideService(References.PreventSchedulerYield, true)),
    );
  return N2itionGrantStore.of({ read, control, checkRouteFiles, withConsent });
});
export const layer = Layer.effect(N2itionGrantStore, make);
