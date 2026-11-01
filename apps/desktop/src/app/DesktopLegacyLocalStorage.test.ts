import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLegacyLocalStorage from "./DesktopLegacyLocalStorage.ts";

it.effect("skips legacy profile inspection for an isolated fork preview", () =>
  Effect.gen(function* () {
    const legacy = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
    yield* legacy.load("/disposable/fork/profile");
    expect(Option.isNone(yield* legacy.take)).toBe(true);
    yield* legacy.complete;
  }).pipe(
    Effect.provide(
      DesktopLegacyLocalStorage.layer.pipe(
        Layer.provide(NodeServices.layer),
        Layer.provide(Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({}))),
        Layer.provide(
          Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
            isPackaged: true,
            isDevelopment: false,
            appVersion: "0.1.6-unlock.1-preview.20261101.1",
          } as DesktopEnvironment.DesktopEnvironment["Service"]),
        ),
      ),
    ),
  ),
);
