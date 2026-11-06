import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  EasDeviceHostConfig,
  type ProviderInstanceConfig,
  type ServerSettings,
  ServerSettingsError,
  type SettingsSecretValue,
  SimlockDeviceHostConfig,
  UsageLimitSourceConfig,
  isSecretReference,
  isSecretSetting,
} from "@t3tools/contracts";
import { acpRegistryClient } from "@t3tools/provider-acp-registry/client";
import { cursorClient } from "@t3tools/provider-cursor/client";
import { grokClient } from "@t3tools/provider-grok/client";
import { museClient } from "@t3tools/provider-muse/client";
import { openCodeClient } from "@t3tools/provider-opencode/client";
import { piClient } from "@t3tools/provider-pi/client";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import {
  sourceControlHostSettingsSchemas,
  sourceControlHostSecretName,
} from "./sourceControl/sourceControlHostSecrets.ts";

export const SECRET_REDACTED = "\u2022\u2022\u2022\u2022\u2022\u2022";

function describeSecretFields(schema: { readonly fields: Readonly<Record<string, Schema.Top>> }) {
  return Object.entries(schema.fields)
    .filter(([, field]) => isSecretSetting(field))
    .map(([name, field]) => ({
      name,
      keyed: SchemaAST.isObjects(field.ast) && field.ast.indexSignatures.length > 0,
      // The registered settings schemas decode without services.
      decode: Schema.decodeUnknownExit(field as Schema.Decoder<unknown>),
    }));
}

type SecretField = ReturnType<typeof describeSecretFields>[number];

const sourceControlSecretFields = new Map(
  [...sourceControlHostSettingsSchemas].map(([kind, schema]) => [
    kind,
    describeSecretFields(schema),
  ]),
);

const providerSecretFields = new Map([
  ["codex", describeSecretFields(CodexSettings)],
  ["claudeAgent", describeSecretFields(ClaudeSettings)],
  ["antigravity", describeSecretFields(AntigravitySettings)],
  ...[cursorClient, grokClient, museClient, openCodeClient, piClient, acpRegistryClient].map(
    (definition) =>
      [definition.driverKind, describeSecretFields(definition.settingsSchema)] as const,
  ),
]);
const usageLimitSecretFields = describeSecretFields(UsageLimitSourceConfig);
const easDeviceHostSecretFields = describeSecretFields(EasDeviceHostConfig);
const simlockDeviceHostSecretFields = describeSecretFields(SimlockDeviceHostConfig);
const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");

export interface SettingsSecret {
  readonly secretName: string;
  readonly kind: "field" | "environment";
  readonly value: string;
  readonly redacted: boolean;
  readonly sensitive: boolean;
  readonly providerInstanceId?: string;
  readonly environmentVariable?: string;
}

type SecretValue = Pick<SettingsSecret, "value" | "redacted">;
type SecretSlotName = (field: string, serverHost: string | null) => string;
type SecretFieldsMapper = (
  fields: Readonly<Record<string, unknown>>,
  secretFields: ReadonlyArray<SecretField>,
  name: SecretSlotName,
) => Record<string, unknown>;
type ProviderEnvironment = NonNullable<ProviderInstanceConfig["environment"]>;

export function mapSettingsSecrets(
  settings: ServerSettings,
  map: (secret: SettingsSecret) => SecretValue,
): ServerSettings {
  const mapFields = mapSecretFieldValues((value, secretName) => {
    if (typeof value !== "string") return value;
    const result = map({
      secretName,
      kind: "field",
      value,
      redacted: value === SECRET_REDACTED,
      sensitive: true,
    });
    return result.redacted ? SECRET_REDACTED : result.value;
  });

  return mapSecretFieldGroups(settings, mapFields, (instanceId, environment) =>
    environment.map((variable) => {
      const { valueRedacted: _omit, ...rest } = variable;
      // A secret reference is not itself secret; storage sees the value cleared.
      const reference = typeof variable.value === "string" ? undefined : variable.value;
      const result = map({
        secretName: `provider-env-${encode(instanceId)}-${encode(variable.name)}`,
        kind: "environment",
        value: typeof variable.value === "string" ? variable.value : "",
        redacted: reference === undefined && variable.valueRedacted === true,
        sensitive: variable.sensitive,
        providerInstanceId: instanceId,
        environmentVariable: variable.name,
      });
      if (reference !== undefined) return { ...rest, value: reference };
      return {
        ...rest,
        value: result.value,
        ...(result.redacted ? { valueRedacted: true } : {}),
      };
    }),
  );
}

/**
 * Maps each value a secret field holds, literal or reference, with the secret name of its slot.
 * Provider environment variables are left as they are.
 */
export function mapSettingsSecretValues(
  settings: ServerSettings,
  map: (value: SettingsSecretValue, secretName: string) => SettingsSecretValue,
): ServerSettings {
  return mapSecretFieldGroups(settings, mapSecretFieldValues(map));
}

function mapSecretFieldValues(
  map: (value: SettingsSecretValue, secretName: string) => SettingsSecretValue,
): SecretFieldsMapper {
  const mapValue = (value: unknown, secretName: string) =>
    typeof value === "string" || isSecretReference(value) ? map(value, secretName) : value;
  return (fields, secretFields, name) => {
    const next = { ...fields };
    for (const { name: field, keyed } of secretFields) {
      if (!Object.hasOwn(fields, field)) continue;
      const value = fields[field];
      if (keyed && value !== null && typeof value === "object" && !Array.isArray(value)) {
        next[field] = Object.fromEntries(
          Object.entries(value).map(([host, entry]) => [
            host,
            mapValue(entry, name(field, host.trim().toLowerCase())),
          ]),
        );
      } else if (!keyed) {
        next[field] = mapValue(value, name(field, null));
      }
    }
    return next;
  };
}

function decodeSecretFields<A>(
  traverse: (mapFields: SecretFieldsMapper) => A,
  settingsPath: string,
): Effect.Effect<A, ServerSettingsError> {
  let error: ServerSettingsError | undefined;
  const decoded = traverse((fields, secretFields) => {
    const next = { ...fields };
    for (const { name, decode } of secretFields) {
      if (error !== undefined || !Object.hasOwn(fields, name)) continue;
      const result = decode(fields[name]);
      if (Exit.isFailure(result)) {
        error = new ServerSettingsError({
          settingsPath,
          operation: "unsupported-secret-reference",
          cause: result.cause,
        });
      } else {
        next[name] = result.value;
      }
    }
    return next;
  });
  return error === undefined ? Effect.succeed(decoded) : Effect.fail(error);
}

export function normalizeSettingsSecretFields(settings: ServerSettings, settingsPath: string) {
  return decodeSecretFields((mapFields) => mapSecretFieldGroups(settings, mapFields), settingsPath);
}

export function normalizeSourceControlHostSecretFields(
  hosts: ServerSettings["sourceControlHosts"],
  settingsPath: string,
) {
  return decodeSecretFields((mapFields) => mapSourceControlFields(hosts, mapFields), settingsPath);
}

function mapSourceControlFields(
  hosts: ServerSettings["sourceControlHosts"],
  mapFields: SecretFieldsMapper,
): ServerSettings["sourceControlHosts"] {
  return Object.fromEntries(
    Object.entries(hosts).map(([kind, fields]) => [
      kind,
      mapFields(fields, sourceControlSecretFields.get(kind) ?? [], (field, serverHost) =>
        sourceControlHostSecretName({ kind, field, serverHost }),
      ),
    ]),
  );
}

function mapSecretFieldGroups(
  settings: ServerSettings,
  mapFields: SecretFieldsMapper,
  mapEnvironment: (instanceId: string, environment: ProviderEnvironment) => ProviderEnvironment = (
    _instanceId,
    environment,
  ) => environment,
): ServerSettings {
  const providerInstances = Object.fromEntries(
    Object.entries(settings.providerInstances).map(([instanceId, instance]) => {
      const config = instance.config;
      return [
        instanceId,
        {
          ...instance,
          ...(config !== null && typeof config === "object" && !Array.isArray(config)
            ? {
                config: mapFields(
                  config as Record<string, unknown>,
                  providerSecretFields.get(instance.driver) ?? [],
                  (field, serverHost) =>
                    `provider-config-${encode(instanceId)}-${encode(instance.driver)}-${encode(field)}` +
                    (serverHost === null ? "" : `-${encode(serverHost)}`),
                ),
              }
            : {}),
          ...(instance.environment
            ? { environment: mapEnvironment(instanceId, instance.environment) }
            : {}),
        },
      ];
    }),
  );

  const sourceControlHosts = mapSourceControlFields(settings.sourceControlHosts, mapFields);

  const usageLimitSources = Object.fromEntries(
    Object.entries(settings.usageLimitSources).map(([id, source]) => [
      id,
      mapFields(
        source,
        usageLimitSecretFields,
        (field, serverHost) =>
          `usage-limit-source-${encode(id)}` +
          (field === "managementKey" && serverHost === null
            ? ""
            : `-${encode(field)}${serverHost === null ? "" : `-${encode(serverHost)}`}`),
      ),
    ]),
  ) as ServerSettings["usageLimitSources"];

  const easDeviceHosts = settings.easDeviceHosts.map(
    (host) =>
      mapFields(
        host,
        easDeviceHostSecretFields,
        (field, serverHost) =>
          `device-host-${encode(host.id)}-${encode(field)}` +
          (serverHost === null ? "" : `-${encode(serverHost)}`),
      ) as EasDeviceHostConfig,
  );

  // Its own prefix: an EAS and a Simlock host may share an id.
  const simlockDeviceHosts = settings.simlockDeviceHosts.map(
    (host) =>
      mapFields(
        host,
        simlockDeviceHostSecretFields,
        (field, serverHost) =>
          `simlock-device-host-${encode(host.id)}-${encode(field)}` +
          (serverHost === null ? "" : `-${encode(serverHost)}`),
      ) as SimlockDeviceHostConfig,
  );

  return {
    ...settings,
    providerInstances,
    sourceControlHosts,
    usageLimitSources,
    easDeviceHosts,
    simlockDeviceHosts,
  };
}
