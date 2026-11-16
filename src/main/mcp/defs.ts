import type { AppHandlerVariables } from "@/types";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { CallToolResult } from "./common";

// What the areas fill (src/main/mcp/tools/*) and the registry serves. Apart
// from registry.ts, so the areas can import it without a cycle.

export type Handler = AppHandlerVariables;
type Maybe<T> = T | Promise<T>;

/**
 * A group of settings `get_settings` reads and `update_settings` changes.
 * update_settings checks the changes' keys against `schema`, merges them
 * onto `read`, checks the result with `schema`, then calls `write`, on the
 * write chain after a flush.
 */
export interface SectionDef<S extends z.ZodObject = z.ZodObject> {
  // A strict z.object of what can be changed, keys left out. Plain (no
  // preprocess or transform), so describe can show it as JSON Schema.
  schema: S;
  // The current values in the schema's shape, read from the services
  // (never through invoke), built field by field
  read: (handler: Handler) => Maybe<z.input<S>>;
  // Saves the checked values through the section's handler: invoke before
  // any await (the profile guard ran just before), then the section's push.
  // `changes` is what the client sent, for sections saved one field at a time.
  write: (
    handler: Handler,
    values: z.output<S>,
    changes: Record<string, unknown>,
  ) => Promise<CallToolResult>;
  // Facts get_settings shows next to the values, such as { hasKey }
  info?: (handler: Handler) => Maybe<Record<string, unknown>>;
  // For describe: what the fields mean, and what a value refers to
  notes?: string;
}

/**
 * A kind of item the generic `list`, `get`, `save_item`, `test` and
 * `remove` tools reach by `kind`. Each verb is there only when the kind has
 * it. save, remove and test run on the write chain after a flush.
 */
export interface KindDef<
  S extends z.ZodObject = z.ZodObject,
  T extends z.ZodObject = z.ZodObject,
> {
  // An item's fields: save_item refuses keys it doesn't have, and describe
  // shows it. The kind's save still checks the merged item.
  schema?: S;
  notes?: string;
  list?: (
    handler: Handler,
    args: { query?: string; limit: number },
  ) => Maybe<CallToolResult>;
  get?: (handler: Handler, id: string) => Maybe<CallToolResult>;
  // Merges `changes` onto the stored item, or onto a new one without `id`,
  // checks and saves it, then pushes. Takes guardProfile before reading.
  save?: (
    handler: Handler,
    id: string | undefined,
    changes: Record<string, unknown>,
  ) => Promise<CallToolResult>;
  remove?: (handler: Handler, id: string) => Promise<CallToolResult>;
  // What `test` takes besides the id, checked before `test` runs
  testArgs?: T;
  test?: (
    handler: Handler,
    id: string | undefined,
    args: z.output<T>,
  ) => Promise<CallToolResult>;
}

// MCP's defaults are destructive and open-world: every tool sets all four
export type Annotations = Required<
  Pick<
    ToolAnnotations,
    "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint"
  >
>;

/** A tool of its own, for the verbs the generic tools don't cover. */
export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  // For the model, in English
  description: string;
  // A strict, plain z.object (no preprocess or transform), so it converts to
  // JSON Schema
  input: S;
  annotations: Annotations;
  // Runs on the write chain after a flush unless readOnlyHint
  run: (handler: Handler, args: z.output<S>) => Maybe<CallToolResult>;
}

// Only to infer each def's schema types; the registry holds them erased
export const defineSection = <S extends z.ZodObject>(
  def: SectionDef<S>,
): SectionDef<any> => def;
export const defineKind = <
  S extends z.ZodObject = z.ZodObject,
  T extends z.ZodObject = z.ZodObject,
>(
  def: KindDef<S, T>,
): KindDef<any, any> => def;
export const defineTool = <S extends z.ZodObject>(
  def: ToolDef<S>,
): ToolDef<any> => def;

export type Sections = Record<string, SectionDef<any>>;
export type Kinds = Record<string, KindDef<any, any>>;

export interface Registry {
  sections: Sections;
  kinds: Kinds;
  tools: ToolDef<any>[];
}

// What a tool that reads, writes or deletes promises
export const READ: Annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const WRITE: Annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
export const DESTROY: Annotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
