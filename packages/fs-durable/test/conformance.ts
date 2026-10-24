import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { FsErrorCode, VirtualFileSystem } from "../src/index.js";
import type { FsError } from "../src/errors.js";

export type WithFileSystem = <A>(body: (fs: VirtualFileSystem) => Promise<A>) => Promise<A>;
const run = Effect.runPromise;

async function fails<A>(effect: Effect.Effect<A, FsError>, code: FsErrorCode) {
  const error = await run(Effect.flip(effect));
  expect(error).toMatchObject({ _tag: "FsError", code });
}

export function conformance(name: string, withFs: WithFileSystem) {
  describe(name, () => {
    it("starts with an empty root and supports empty files", () => withFs(async (fs) => {
      expect(await run(fs.stat("/"))).toMatchObject({ type: "directory", size: 0 });
      expect(await run(fs.readDirectory("/"))).toEqual([]);
      await run(fs.writeFileString("/empty", ""));
      expect(await run(fs.readFile("/empty"))).toEqual(new Uint8Array());
      expect(await run(fs.stat("/empty"))).toMatchObject({ type: "file", size: 0 });
    }));

    it("roundtrips UTF-8 and binary, including sliced buffers", () => withFs(async (fs) => {
      await run(fs.writeFileString("/unicode", "Hello 🌍"));
      expect(await run(fs.readFileString("/unicode"))).toBe("Hello 🌍");
      expect((await run(fs.stat("/unicode"))).size).toBe(new TextEncoder().encode("Hello 🌍").length);
      const data = new Uint8Array([9, 0, 255, 128, 9]);
      await run(fs.writeFile("/binary", data.subarray(1, 4)));
      data.fill(7);
      const read = await run(fs.readFile("/binary"));
      expect(read).toEqual(new Uint8Array([0, 255, 128]));
      read.fill(0);
      expect(await run(fs.readFile("/binary"))).toEqual(new Uint8Array([0, 255, 128]));
    }));

    it("replaces files and honors exclusive creation", () => withFs(async (fs) => {
      await run(fs.writeFileString("/a", "long content"));
      const before = await run(fs.stat("/a"));
      await run(fs.writeFileString("/a", "x"));
      expect(await run(fs.readFileString("/a"))).toBe("x");
      expect((await run(fs.stat("/a"))).createdAt).toBe(before.createdAt);
      await fails(fs.writeFileString("/a", "bad", { exclusive: true }), "EEXIST");
      expect(await run(fs.readFileString("/a"))).toBe("x");
      await run(fs.writeFileString("/new", "ok", { exclusive: true }));
    }));

    it("preserves UTF-8 BOMs and enforces text limits in bytes", () => withFs(async (fs) => {
      await run(fs.writeFileString("/bom", "\uFEFFhello"));
      expect(await run(fs.readFileString("/bom"))).toBe("\uFEFFhello");
      await fails(fs.writeFileString("/large", "🌍".repeat(17)), "EFBIG");
      expect(await run(fs.exists("/large"))).toBe(false);
    }));

    it("creates directory trees and returns deterministic immediate entries", () => withFs(async (fs) => {
      await run(fs.makeDirectory("/a/b/c", { recursive: true }));
      await run(fs.makeDirectory("/a/b", { recursive: true }));
      await run(fs.writeFileString("/a/z", "z"));
      await run(fs.writeFileString("/a/A", "A"));
      expect((await run(fs.readDirectory("/a"))).map((e) => e.name)).toEqual(["A", "b", "z"]);
      await fails(fs.makeDirectory("/a"), "EEXIST");
      await fails(fs.makeDirectory("/missing/child"), "ENOENT");
      await fails(fs.makeDirectory("/a/z/child", { recursive: true }), "ENOTDIR");
      await run(fs.makeDirectory("/", { recursive: true }));
    }));

    it("uses lexical, absolute, case-sensitive paths", () => withFs(async (fs) => {
      await run(fs.makeDirectory("/dir"));
      await run(fs.writeFileString("//dir/./a/../file/", "ok"));
      expect(await run(fs.readFileString("/dir/file"))).toBe("ok");
      expect(await run(fs.exists("/dir/File"))).toBe(false);
      for (const path of ["", "relative", "/../escape", "/a/../../escape", "/nul\0", "/" + "x".repeat(256), "/" + "é".repeat(128), "/" + "a/".repeat(2100)]) {
        await fails(fs.stat(path), "EINVAL");
      }
      await run(fs.writeFileString("/dir/back\\slash", "literal"));
      expect(await run(fs.exists("/dir/back\\slash"))).toBe(true);
    }));

    it("distinguishes missing paths, files and directories", () => withFs(async (fs) => {
      await fails(fs.readFile("/missing"), "ENOENT");
      await fails(fs.readFile("/"), "EISDIR");
      await fails(fs.writeFileString("/", "bad"), "EISDIR");
      await fails(fs.writeFileString("/missing/file", "bad"), "ENOENT");
      await run(fs.writeFileString("/a", "a"));
      await fails(fs.readDirectory("/a"), "ENOTDIR");
      await fails(fs.stat("/a/child"), "ENOTDIR");
      expect(await run(fs.exists("/a/child"))).toBe(false);
      await fails(fs.remove("/a/child", { force: true }), "ENOTDIR");
      expect(await run(fs.exists("/missing"))).toBe(false);
    }));

    it("appends bytes and creates missing files", () => withFs(async (fs) => {
      await run(fs.appendFileString("/a", "one"));
      await run(fs.appendFileString("/a", "🌍"));
      expect(await run(fs.readFileString("/a"))).toBe("one🌍");
      await fails(fs.appendFileString("/", "x"), "EISDIR");
    }));

    it("truncates and zero-fills extensions", () => withFs(async (fs) => {
      await run(fs.writeFile("/a", new Uint8Array([1, 2, 3])));
      await run(fs.truncate("/a", 2));
      await run(fs.truncate("/a", 5));
      expect(await run(fs.readFile("/a"))).toEqual(new Uint8Array([1, 2, 0, 0, 0]));
      for (const size of [-1, 0.5, NaN, Infinity]) await fails(fs.truncate("/a", size), "EINVAL");
      await fails(fs.truncate("/missing"), "ENOENT");
      await fails(fs.truncate("/"), "EISDIR");
      await run(fs.truncate("/a"));
      expect((await run(fs.stat("/a"))).size).toBe(0);
    }));

    it("moves whole trees without changing file contents", () => withFs(async (fs) => {
      await run(fs.makeDirectory("/a/b", { recursive: true }));
      await run(fs.writeFileString("/a/b/file", "keep"));
      await run(fs.rename("/a", "/moved"));
      expect(await run(fs.exists("/a"))).toBe(false);
      expect(await run(fs.readFileString("/moved/b/file"))).toBe("keep");
      await run(fs.rename("/moved", "/moved"));
      await fails(fs.rename("/moved", "/moved/b/inside"), "EINVAL");
      await fails(fs.rename("/moved", "/missing/moved"), "ENOENT");
      expect(await run(fs.readFileString("/moved/b/file"))).toBe("keep");
    }));

    it("replaces files and empty directories on rename, but not nonempty directories", () => withFs(async (fs) => {
      await run(fs.writeFileString("/a", "A"));
      await run(fs.writeFileString("/b", "B"));
      await run(fs.rename("/a", "/b"));
      expect(await run(fs.readFileString("/b"))).toBe("A");
      expect(await run(fs.exists("/a"))).toBe(false);
      await run(fs.makeDirectory("/dir/child", { recursive: true }));
      await run(fs.makeDirectory("/empty"));
      await fails(fs.rename("/b", "/empty"), "EISDIR");
      await fails(fs.rename("/empty", "/b"), "ENOTDIR");
      await fails(fs.rename("/empty", "/dir"), "ENOTEMPTY");
      await run(fs.rename("/dir", "/empty"));
      expect(await run(fs.exists("/empty/child"))).toBe(true);
    }));

    it("copies independent files and directory trees", () => withFs(async (fs) => {
      await run(fs.makeDirectory("/a/b", { recursive: true }));
      await run(fs.writeFileString("/a/b/file", "original"));
      await fails(fs.copy("/a", "/copy"), "EISDIR");
      await run(fs.copy("/a", "/copy", { recursive: true }));
      await run(fs.writeFileString("/copy/b/file", "changed"));
      expect(await run(fs.readFileString("/a/b/file"))).toBe("original");
      await run(fs.copy("/a/b/file", "/file"));
      await fails(fs.copy("/a/b/file", "/file"), "EEXIST");
      await run(fs.copy("/copy/b/file", "/file", { overwrite: true }));
      expect(await run(fs.readFileString("/file"))).toBe("changed");
      await fails(fs.copy("/file", "/file", { overwrite: true }), "EINVAL");
      await fails(fs.copy("/a", "/a/b/c", { recursive: true }), "EINVAL");
      await fails(fs.copy("/a", "/copy", { recursive: true, overwrite: true }), "EEXIST");
    }));

    it("removes trees, protects root, and ignores only missing paths with force", () => withFs(async (fs) => {
      await run(fs.makeDirectory("/a/b", { recursive: true }));
      await run(fs.writeFileString("/a/b/file", "data"));
      await fails(fs.remove("/a"), "ENOTEMPTY");
      await run(fs.remove("/a", { recursive: true }));
      expect(await run(fs.exists("/a"))).toBe(false);
      await fails(fs.remove("/missing"), "ENOENT");
      await run(fs.remove("/missing", { force: true }));
      await fails(fs.remove("/", { recursive: true, force: true }), "EBUSY");
      await fails(fs.rename("/", "/renamed"), "EBUSY");
      await fails(fs.copy("/", "/copy", { recursive: true }), "EBUSY");
    }));

    it("serializes concurrent appends without losing updates", () => withFs(async (fs) => {
      await Promise.all(Array.from({ length: 40 }, () => run(fs.appendFileString("/log", "x"))));
      expect(await run(fs.readFileString("/log"))).toBe("x".repeat(40));
      const results = await Promise.all(Array.from({ length: 10 }, () => run(Effect.result(fs.writeFileString("/exclusive", "x", { exclusive: true })))));
      expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
    }));

    it("enforces file limits atomically (test backend uses a 64 byte limit)", () => withFs(async (fs) => {
      await run(fs.writeFileString("/a", "x".repeat(64)));
      await fails(fs.writeFileString("/a", "x".repeat(65)), "EFBIG");
      await fails(fs.appendFileString("/a", "!"), "EFBIG");
      await fails(fs.truncate("/a", 65), "EFBIG");
      await fails(fs.appendFileString("/new", "x".repeat(65)), "EFBIG");
      await fails(fs.appendFile("/new-binary", new Uint8Array(65)), "EFBIG");
      expect(await run(fs.exists("/new"))).toBe(false);
      expect(await run(fs.exists("/new-binary"))).toBe(false);
      expect(await run(fs.readFileString("/a"))).toBe("x".repeat(64));
      expect((await run(fs.stat("/a"))).size).toBe(64);
    }));

    it("does not evaluate effects until run, and allows replaying reads", () => withFs(async (fs) => {
      const write = fs.writeFileString("/lazy", "written");
      expect(await run(fs.exists("/lazy"))).toBe(false);
      await run(write);
      const read = fs.readFileString("/lazy");
      expect(await run(read)).toBe("written");
      await run(fs.writeFileString("/lazy", "new"));
      expect(await run(read)).toBe("new");
    }));
  });
}
