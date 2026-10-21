export interface NodeRecord {
  readonly id: number;
  readonly parentId: number | null;
  readonly name: string;
  readonly type: "file" | "directory";
  readonly size: number;
  readonly createdAt: number;
  readonly modifiedAt: number;
}

/** Internal synchronous boundary: no callbacks may yield or perform external I/O. */
export interface Storage {
  transaction<A>(body: () => A): A;
  get(id: number): NodeRecord | undefined;
  child(parentId: number, name: string): NodeRecord | undefined;
  children(parentId: number): NodeRecord[];
  insert(node: Omit<NodeRecord, "id">): NodeRecord;
  update(node: NodeRecord): void;
  readContent(id: number): Uint8Array;
  writeContent(id: number, content: Uint8Array): void;
  delete(id: number): void;
}
