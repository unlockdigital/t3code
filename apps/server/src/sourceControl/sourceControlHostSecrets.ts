import {
  isSecretReference,
  secretReferencesInSettings,
  type SecretReference,
  type ServerSettings,
} from "@t3tools/contracts";
import type * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Effect from "effect/Effect";

import { resolveSettingsSecrets } from "../secrets/settingsSecretValue.ts";

import { sourceControlDefinitions } from "./sourceControlDefinitions.ts";

export interface SourceControlHostSecretSlot {
  readonly kind: string;
  readonly field: string;
  readonly serverHost: string | null;
}

/** The secret store entry for one slot; names stay stable across releases. */
export function sourceControlHostSecretName(slot: SourceControlHostSecretSlot): string {
  const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
  return slot.serverHost === null
    ? `source-control-${encode(slot.kind)}-${encode(slot.field)}`
    : `source-control-${encode(slot.kind)}-${encode(slot.field)}-${encode(slot.serverHost.trim().toLowerCase())}`;
}

type SourceControlHostsSettings = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export const sourceControlHostSettingsSchemas = new Map(
  sourceControlDefinitions.definitions.flatMap((definition) =>
    definition.settings ? [[definition.kind as string, definition.settings] as const] : [],
  ),
);

/** Every secret provider reference held in any host kind's credential fields. */
export function collectSourceControlHostSecretReferences(
  hosts: SourceControlHostsSettings,
): ReadonlyArray<SecretReference> {
  return [...sourceControlHostSettingsSchemas].flatMap(([kind, schema]) =>
    secretReferencesInSettings(schema, hosts[kind]).map(({ reference }) => reference),
  );
}

/** Replaces each secret provider reference in one host kind's credential fields with the secret it names. */
export const resolveSourceControlHostSecrets = Effect.fn("SourceControlHost.resolveSecrets")(
  function* (
    resolver: SecretResolver.SecretResolver["Service"],
    settings: Pick<ServerSettings, "sourceControlHosts" | "secretProviders">,
    kind: string,
  ) {
    const hosts = settings.sourceControlHosts;
    const schema = sourceControlHostSettingsSchemas.get(kind);
    const fields = hosts[kind];
    if (schema === undefined || fields === undefined) return hosts;
    const resolved = yield* resolveSettingsSecrets(
      resolver,
      schema,
      fields,
      settings.secretProviders,
    );
    return resolved === fields ? hosts : { ...hosts, [kind]: resolved };
  },
);

const collectUsageLimitSecretReferences = (
  sources: ServerSettings["usageLimitSources"],
): ReadonlyArray<SecretReference> =>
  Object.values(sources).flatMap(({ managementKey }) =>
    isSecretReference(managementKey) ? [managementKey] : [],
  );

/** Settings that cannot be read clear every cached secret, so a refresh never keeps a stale one. */
export const invalidateSettingsSecrets = Effect.fn("SettingsSecrets.invalidate")(function* <E>(
  resolver: SecretResolver.SecretResolver["Service"],
  settings: Effect.Effect<Pick<ServerSettings, "sourceControlHosts" | "usageLimitSources">, E>,
) {
  const references = yield* settings.pipe(
    Effect.map((current) => [
      ...collectSourceControlHostSecretReferences(current.sourceControlHosts),
      ...collectUsageLimitSecretReferences(current.usageLimitSources),
    ]),
    Effect.orElseSucceed(() => undefined),
  );
  yield* resolver.invalidate(references);
});
