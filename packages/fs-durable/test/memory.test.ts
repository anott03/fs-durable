import { Effect } from "effect";
import { expect, it } from "vitest";
import { VirtualFileSystem } from "../src/index.js";
import { layerMemory, makeMemory } from "../src/memory.js";
import { conformance } from "./conformance.js";

conformance("memory", async (body) => body(await Effect.runPromise(makeMemory({ maxFileBytes: 64 }))));

it("provides the filesystem through an Effect layer", async () => {
  const program = Effect.gen(function* () {
    const fs = yield* VirtualFileSystem;
    yield* fs.writeFileString("/hello", "hello");
    return yield* fs.readFileString("/hello");
  });
  expect(await Effect.runPromise(program.pipe(Effect.provide(layerMemory())))).toBe("hello");
});

it("validates configuration and creates independent memory instances", async () => {
  for (const maxFileBytes of [-1, 0.5, NaN, 1_900_001]) {
    expect(await Effect.runPromise(Effect.flip(makeMemory({ maxFileBytes })))).toMatchObject({ code: "EINVAL" });
  }
  const factory = makeMemory();
  const a = await Effect.runPromise(factory);
  const b = await Effect.runPromise(factory);
  await Effect.runPromise(a.writeFileString("/file", "a"));
  expect(await Effect.runPromise(b.exists("/file"))).toBe(false);
});
