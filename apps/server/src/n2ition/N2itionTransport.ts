import { N2itionConnectionError } from "@t3tools/contracts/n2itionConnection";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, FetchHttpClient } from "effect/http";
const isConnectionError = Schema.is(N2itionConnectionError);
export class N2itionTransport extends Context.Service<
  N2itionTransport,
  {
    readonly snapshot: (input: {
      origin: string;
      token: string;
      purpose: "interactive" | "automatic";
      digest?: string;
    }) => Effect.Effect<string, N2itionConnectionError>;
  }
>()("t3/n2ition/N2itionTransport") {}
const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const snapshot = Effect.fn("N2itionTransport.snapshot")(
    function* (input: {
      origin: string;
      token: string;
      purpose: "interactive" | "automatic";
      digest?: string;
    }) {
      const response = yield* client.get(new URL("/api/teddy/v1/snapshot", input.origin).href, {
        headers: {
          Authorization: `Bearer ${input.token}`,
          "X-Teddy-Purpose": input.purpose,
          ...(input.digest ? { "X-Teddy-Digest": input.digest } : {}),
        },
      });
      if (response.status !== 200)
        return yield* new N2itionConnectionError({
          reason:
            response.status === 401
              ? "unauthorized"
              : response.status === 403
                ? "revoked"
                : response.status === 423
                  ? "paused"
                  : response.status === 413
                    ? "too_large"
                    : response.status === 429
                      ? "rate_limited"
                      : "unavailable",
        });
      if (Number(response.headers["content-length"]) > 2097152)
        return yield* new N2itionConnectionError({ reason: "too_large" });
      const body = yield* response.stream.pipe(
        Stream.runFoldEffect(
          () => ({ bytes: 0, chunks: [] as Uint8Array[] }),
          (state, chunk) => {
            if (state.bytes + chunk.byteLength > 2097152)
              return Effect.fail(new N2itionConnectionError({ reason: "too_large" }));
            state.chunks.push(chunk);
            return Effect.succeed({ bytes: state.bytes + chunk.byteLength, chunks: state.chunks });
          },
        ),
      );
      return Buffer.concat(body.chunks).toString("utf8");
    },
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
    Effect.timeout(8000),
    Effect.mapError((cause) =>
      isConnectionError(cause) ? cause : new N2itionConnectionError({ reason: "unavailable" }),
    ),
  );
  return N2itionTransport.of({ snapshot });
});
export const layer = Layer.effect(N2itionTransport, make);
