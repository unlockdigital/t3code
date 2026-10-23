import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as OpenCode2Server from "./OpenCode2Server.ts";
import * as ScopedText from "./scopedText.ts";

it.effect("uses only the stateless prompt/model endpoint, with no session or workspace", () =>
  Effect.gen(function* () {
    const requests: unknown[] = [];
    const connection = {
      external: false,
      client: {
        generate: {
          text: (input: unknown) =>
            Effect.sync(() => {
              requests.push(input);
              return { text: "synthetic artifact" };
            }),
        },
      },
    } as unknown as OpenCode2Server.OpenCode2Connection;
    const generate = yield* ScopedText.make.pipe(
      Effect.provide(
        Layer.mock(OpenCode2Server.OpenCode2Server)({ withConnection: (use) => use(connection) }),
      ),
    );
    const modelSelection = {
      instanceId: ProviderInstanceId.make("synthetic-go"),
      model: "opencode-go/synthetic-coder",
    };
    expect(yield* generate({ prompt: "Only invented inputs", modelSelection })).toEqual({
      text: "synthetic artifact",
    });
    expect(requests).toEqual([
      {
        prompt: "Only invented inputs",
        model: { providerID: "opencode-go", id: "synthetic-coder" },
      },
    ]);
  }),
);

it.effect("blocks remote servers and unsupported agent options before sending", () =>
  Effect.gen(function* () {
    let calls = 0;
    const connection = {
      external: true,
      client: {
        generate: {
          text: () =>
            Effect.sync(() => {
              calls++;
              return { text: "unreachable" };
            }),
        },
      },
    } as unknown as OpenCode2Server.OpenCode2Connection;
    const generate = yield* ScopedText.make.pipe(
      Effect.provide(
        Layer.mock(OpenCode2Server.OpenCode2Server)({ withConnection: (use) => use(connection) }),
      ),
    );
    const modelSelection = {
      instanceId: ProviderInstanceId.make("synthetic-go"),
      model: "opencode-go/synthetic-coder",
    };
    expect((yield* Effect.result(generate({ prompt: "Invented", modelSelection })))._tag).toBe(
      "Failure",
    );
    expect(
      (yield* Effect.result(
        generate({
          prompt: "Invented",
          modelSelection: { ...modelSelection, options: [{ id: "agent", value: "build" }] },
        }),
      ))._tag,
    ).toBe("Failure");
    expect(calls).toBe(0);
  }),
);
