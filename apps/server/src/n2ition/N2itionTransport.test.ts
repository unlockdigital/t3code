import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as References from "effect/References";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";

import * as Transport from "./N2itionTransport.ts";

const origin = "https://n2ition.example/some/path?existing=query-secret";
const token = "synthetic-token";
const expectedUrl = "https://n2ition.example/api/teddy/v1/snapshot";

type Fetch = typeof globalThis.fetch;

const withFetch = <A, E>(fetch: Fetch, effect: Effect.Effect<A, E, Transport.N2itionTransport>) =>
  effect.pipe(
    Effect.provide(Transport.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
  );

const snapshot = (digest?: string) =>
  Effect.gen(function* () {
    const service = yield* Transport.N2itionTransport;
    return yield* service.snapshot({
      origin,
      token,
      purpose: "interactive",
      ...(digest === undefined ? {} : { digest }),
    });
  });

const snapshotError = (fetch: Fetch, digest?: string) =>
  snapshot(digest).pipe(
    Effect.matchEffect({
      onFailure: Effect.succeed,
      onSuccess: () => Effect.die("Expected snapshot to fail"),
    }),
    (effect) => withFetch(fetch, effect),
  );

it.effect(
  "sends a fixed-path GET with authorization in headers and redirect errors enabled",
  () => {
    const requests: Array<{ input: Parameters<Fetch>[0]; init: Parameters<Fetch>[1] }> = [];
    const fetch: Fetch = async (input, init) => {
      requests.push({ input, init });
      return new Response("synthetic snapshot", { status: 200 });
    };

    return Effect.gen(function* () {
      expect(yield* withFetch(fetch, snapshot("fixture-digest"))).toBe("synthetic snapshot");
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(String(request?.input)).toBe(expectedUrl);
      expect(request?.init?.method).toBe("GET");
      expect(request?.init?.redirect).toBe("error");
      const headers = new Headers(request?.init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(headers.get("x-teddy-purpose")).toBe("interactive");
      expect(headers.get("x-teddy-digest")).toBe("fixture-digest");
      expect(String(request?.input)).not.toContain(token);
      expect(String(request?.input)).not.toContain("query-secret");
    });
  },
);

it.effect("rejects a response whose content length exceeds the snapshot cap", () => {
  const fetch: Fetch = async () =>
    new Response("small body", {
      status: 200,
      headers: { "content-length": "2097153" },
    });

  return Effect.gen(function* () {
    const error = yield* snapshotError(fetch);
    expect(error).toMatchObject({ _tag: "N2itionConnectionError", reason: "too_large" });
  });
});

it.effect("caps streamed response bytes when content length is absent", () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2097152));
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
  const fetch: Fetch = async () => new Response(body, { status: 200 });

  return Effect.gen(function* () {
    const error = yield* snapshotError(fetch);
    expect(error).toMatchObject({ _tag: "N2itionConnectionError", reason: "too_large" });
  });
});

it.effect.each([
  { status: 401, reason: "unauthorized" },
  { status: 403, reason: "revoked" },
  { status: 423, reason: "paused" },
  { status: 429, reason: "rate_limited" },
  { status: 500, reason: "unavailable" },
] as const)("maps HTTP $status to a sanitized $reason error", ({ status, reason }) => {
  const fetch: Fetch = async () =>
    new Response("upstream detail containing synthetic-token", { status });

  return Effect.gen(function* () {
    const error = yield* snapshotError(fetch);
    expect(error).toMatchObject({ _tag: "N2itionConnectionError", reason });
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain("upstream detail");
  });
});

it.effect("maps unexpected fetch failures to a sanitized unavailable error", () => {
  const fetch: Fetch = async () => {
    throw new Error("synthetic-token leaked from upstream");
  };

  return Effect.gen(function* () {
    const error = yield* snapshotError(fetch);
    expect(error).toMatchObject({ _tag: "N2itionConnectionError", reason: "unavailable" });
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain("leaked from upstream");
  });
});

it.effect(
  "initiates fetch within the immediate consent continuation before waiting for a response",
  () => {
    let started = false;
    let respond: (response: Response) => void = () => {
      throw new Error("Fetch has not started");
    };
    const fetch: Fetch = () => {
      started = true;
      return new Promise<Response>((resolve) => {
        respond = resolve;
      });
    };
    return withFetch(
      fetch,
      Effect.gen(function* () {
        const running = yield* Effect.forkChild(snapshot(), { startImmediately: true }).pipe(
          Effect.provideService(References.PreventSchedulerYield, true),
        );
        expect(started).toBe(true);
        respond(new Response("synthetic snapshot", { status: 200 }));
        expect(yield* Fiber.join(running)).toBe("synthetic snapshot");
      }),
    );
  },
);
