import * as Schema from "effect/Schema";

import { ModelSelection } from "./modelSelection.ts";

export const ModelPrivacy = Schema.Literals(["standard", "private"]);
export type ModelPrivacy = typeof ModelPrivacy.Type;

export const PrivateHelpersPolicy = Schema.Literals(["disabled", "review"]);
export type PrivateHelpersPolicy = typeof PrivateHelpersPolicy.Type;

export const PrivateModelRoute = Schema.Struct({
  modelSelection: ModelSelection,
  // Bind approval to the local provider configuration, including its launcher and environment.
  providerConfigHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
export type PrivateModelRoute = typeof PrivateModelRoute.Type;
