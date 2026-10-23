import * as Schema from "effect/Schema";

import { EnvironmentId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  ClaudeConsoleBillingConnection,
  ClaudeConsoleBillingReadError,
} from "./providerBilling.ts";

const TabKey = {
  threadId: TrimmedNonEmptyString,
  tabId: TrimmedNonEmptyString,
};

export const DesktopBrowserEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("claudeBilling"),
    requestId: TrimmedNonEmptyString,
    result: Schema.Union([
      Schema.Struct({ _tag: Schema.Literal("Success"), credits: Schema.Unknown }),
      Schema.Struct({ _tag: Schema.Literal("Failure"), error: ClaudeConsoleBillingReadError }),
    ]),
  }),
  Schema.Struct({ type: Schema.Literal("attached"), ...TabKey }),
  /** Its `<webview>` went away: closed, crashed, swapped, or devtools took the debugger. */
  Schema.Struct({ type: Schema.Literal("detached"), ...TabKey }),
  Schema.Struct({ type: Schema.Literal("cdp"), ...TabKey, message: Schema.String }),
]);
export type DesktopBrowserEvent = typeof DesktopBrowserEvent.Type;

export const DesktopBrowserCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("claudeBilling"),
    requestId: TrimmedNonEmptyString,
    environmentId: EnvironmentId,
    connection: ClaudeConsoleBillingConnection,
  }),
  Schema.Struct({ type: Schema.Literal("cdp"), ...TabKey, message: Schema.String }),
  Schema.Struct({ type: Schema.Literal("release"), ...TabKey }),
  Schema.Struct({
    type: Schema.Literal("pointer"),
    ...TabKey,
    phase: Schema.Literals(["move", "click"]),
    x: Schema.Finite,
    y: Schema.Finite,
  }),
]);
export type DesktopBrowserCommand = typeof DesktopBrowserCommand.Type;
