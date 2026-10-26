import { Schema } from "effect";

const metadata = {
  size: Schema.Number,
  createdAt: Schema.Number,
  modifiedAt: Schema.Number,
};

const Entry = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  ...metadata,
});

export const DemoNode = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("directory"),
    path: Schema.String,
    entries: Schema.Array(Entry),
    ...metadata,
  }),
  Schema.Struct({
    type: Schema.Literal("file"),
    path: Schema.String,
    content: Schema.String,
    ...metadata,
  }),
]);
export type DemoNode = typeof DemoNode.Type;
