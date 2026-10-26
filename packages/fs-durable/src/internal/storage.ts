export interface NodeRecord {
  readonly id: number;
  readonly parentId: number | null;
  readonly name: string;
  readonly type: "file" | "directory";
  readonly size: number;
  readonly createdAt: number;
  readonly modifiedAt: number;
}

/** The deepest existing node along a path and the number of segments it consumed. */
export interface Resolved {
  readonly node: NodeRecord;
  readonly depth: number;
}

/** Internal synchronous boundary: no callbacks may yield or perform external I/O. */
export interface Storage {
  transaction<A>(body: () => A): A;
  resolve(parts: ReadonlyArray<string>): Resolved;
  /** Whether `id` is `ancestorId` or one of its descendants. */
  contains(ancestorId: number, id: number): boolean;
  children(parentId: number): NodeRecord[];
  hasChildren(parentId: number): boolean;
  insert(node: Omit<NodeRecord, "id">): NodeRecord;
  move(id: number, parentId: number, name: string): void;
  resize(id: number, size: number, modifiedAt: number): void;
  touch(id: number, modifiedAt: number): void;
  /** The caller owns the returned bytes. */
  readContent(id: number): Uint8Array;
  writeContent(id: number, content: Uint8Array): void;
  appendContent(id: number, content: Uint8Array): void;
  copyContent(sourceId: number, targetId: number): void;
  /** Largest file size in the subtree rooted at `id`, or zero. */
  largestFile(id: number): number;
  copyTree(sourceId: number, parentId: number, name: string, now: number): void;
  delete(id: number): void;
  deleteTree(id: number): void;
}
