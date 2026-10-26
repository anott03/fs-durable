import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { makeDurableObject, type DurableObjectStorageLike } from "../src/durable-object.js";
import { conformance } from "./conformance.js";

const run = Effect.runPromise;
const stub = () => env.WORKSPACES.getByName(crypto.randomUUID());

conformance("Durable Object SQLite", async (body) => runInDurableObject(stub(), async (_instance, state) => {
  const fs = await run(makeDurableObject(state.storage, { maxFileBytes: 64 }));
  return body(fs);
}));

it("persists files and directory moves across an actual DO eviction", async () => {
  const workspace = stub();
  await runInDurableObject(workspace, async (_instance, state) => {
    const fs = await run(makeDurableObject(state.storage));
    await run(fs.makeDirectory("/project/src", { recursive: true }));
    await run(fs.writeFileString("/project/src/main.ts", "export const hello = 'world'"));
    await run(fs.rename("/project", "/workspace"));
  });
  await evictDurableObject(workspace);
  expect(await workspace.read("/workspace/src/main.ts")).toBe("export const hello = 'world'");
  await workspace.write("/workspace/src/main.ts", "updated");
  await evictDurableObject(workspace);
  expect(await workspace.read("/workspace/src/main.ts")).toBe("updated");
});

it("reopens idempotently and leaves host tables untouched", async () => {
  await runInDurableObject(stub(), async (_instance, state) => {
    state.storage.sql.exec("CREATE TABLE host_data (value TEXT)");
    state.storage.sql.exec("INSERT INTO host_data VALUES ('keep')");
    const first = await run(makeDurableObject(state.storage));
    await run(first.writeFileString("/file", "saved"));
    const second = await run(makeDurableObject(state.storage));
    expect(await run(second.readFileString("/file"))).toBe("saved");
    await run(second.remove("/file"));
    expect(state.storage.sql.exec("SELECT value FROM host_data").one()).toEqual({ value: "keep" });
  });
});

it("rolls back node creation, metadata and content when a storage write fails", async () => {
  await runInDurableObject(stub(), async (_instance, state) => {
    let armed = false;
    const storage: DurableObjectStorageLike = {
      transactionSync: (body) => state.storage.transactionSync(body),
      sql: {
        exec: (query, ...bindings) => {
          if (armed && query.startsWith("UPDATE fs_durable_nodes SET")) throw new Error("Injected write failure");
          return state.storage.sql.exec(query, ...bindings);
        },
      },
    };
    const fs = await run(makeDurableObject(storage));
    await run(fs.writeFileString("/file", "original"));
    await run(fs.writeFileString("/target", "target"));
    const before = await run(fs.stat("/file"));
    armed = true;
    expect(await run(Effect.flip(fs.writeFileString("/file", "changed")))).toMatchObject({ code: "EIO", operation: "writeFileString" });
    expect(await run(Effect.flip(fs.writeFileString("/new", "new")))).toMatchObject({ code: "EIO" });
    expect(await run(Effect.flip(fs.rename("/file", "/target")))).toMatchObject({ code: "EIO" });
    armed = false;
    expect(await run(fs.readFileString("/file"))).toBe("original");
    expect(await run(fs.readFileString("/target"))).toBe("target");
    expect(await run(fs.stat("/file"))).toEqual(before);
    expect(await run(fs.exists("/new"))).toBe(false);
    expect(state.storage.sql.exec("SELECT count(*) AS count FROM fs_durable_contents").one()).toEqual({ count: 2 });
  });
});

it("rolls back a partially removed tree", async () => {
  await runInDurableObject(stub(), async (_instance, state) => {
    const storage: DurableObjectStorageLike = {
      transactionSync: (body) => state.storage.transactionSync(body),
      sql: {
        exec: (query, ...bindings) => {
          if (query.includes("DELETE FROM fs_durable_nodes WHERE id IN")) throw new Error("Injected delete failure");
          return state.storage.sql.exec(query, ...bindings);
        },
      },
    };
    const fs = await run(makeDurableObject(storage));
    await run(fs.makeDirectory("/tree"));
    await run(fs.writeFileString("/tree/a", "a"));
    await run(fs.writeFileString("/tree/b", "b"));
    expect(await run(Effect.flip(fs.remove("/tree", { recursive: true })))).toMatchObject({ code: "EIO" });
    expect(await run(fs.readFileString("/tree/a"))).toBe("a");
    expect(await run(fs.readFileString("/tree/b"))).toBe("b");
    expect((await run(fs.readDirectory("/tree"))).map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(state.storage.sql.exec("SELECT count(*) AS count FROM fs_durable_contents").one()).toEqual({ count: 2 });
  });
});

it("rolls back a partially copied tree when a later file exceeds the configured limit", async () => {
  await runInDurableObject(stub(), async (_instance, state) => {
    const fs = await run(makeDurableObject(state.storage));
    await run(fs.makeDirectory("/source"));
    await run(fs.writeFileString("/source/a", "small"));
    await run(fs.writeFileString("/source/z", "x".repeat(100)));
    const limited = await run(makeDurableObject(state.storage, { maxFileBytes: 64 }));
    expect(await run(limited.readFileString("/source/z"))).toBe("x".repeat(100));
    expect(await run(Effect.flip(limited.appendFileString("/source/z", "!")))).toMatchObject({ code: "EFBIG" });
    expect(await run(Effect.flip(limited.copy("/source", "/copy", { recursive: true })))).toMatchObject({ code: "EFBIG" });
    expect(await run(fs.exists("/copy"))).toBe(false);
    expect(await run(fs.readFileString("/source/z"))).toHaveLength(100);
    expect(state.storage.sql.exec("SELECT count(*) AS count FROM fs_durable_contents").one()).toEqual({ count: 2 });
  });
});

it("rejects unknown schema versions instead of overwriting them", async () => {
  await runInDurableObject(stub(), async (_instance, state) => {
    state.storage.sql.exec("UPDATE fs_durable_schema SET version = 999 WHERE id = 1");
    expect(await run(Effect.flip(makeDurableObject(state.storage)))).toMatchObject({
      code: "EIO", operation: "initialize", message: "Unsupported fs-durable schema version 999",
    });
    expect(state.storage.sql.exec("SELECT version FROM fs_durable_schema").one()).toEqual({ version: 999 });
  });
});

it("roundtrips the maximum supported single-BLOB file", async () => {
  await runInDurableObject(stub(), async (_instance, state) => {
    const fs = await run(makeDurableObject(state.storage, { maxFileBytes: 1_900_000 }));
    const data = new Uint8Array(1_900_000).fill(255);
    await run(fs.writeFile("/large", data));
    expect(await run(fs.readFile("/large"))).toEqual(data);
  });
});
