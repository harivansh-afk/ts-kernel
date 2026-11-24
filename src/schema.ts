type Schema = Record<string, unknown>;
type Context = { root: unknown; open: ReadonlySet<string> };

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const PRIMITIVES: Record<string, string> = { string: "string", number: "number", integer: "number", boolean: "boolean", null: "null" };
const COMBINATORS: readonly (readonly [keyword: string, joiner: string])[] = [
  ["anyOf", " | "],
  ["oneOf", " | "],
  ["allOf", " & "],
];

const isSchema = (value: unknown): value is Schema => typeof value === "object" && value !== null;

export const key = (name: string): string => (IDENTIFIER.test(name) ? name : JSON.stringify(name));

export const identifier = (name: string): string => name.replace(/[^\w$]/g, "_").replace(/^(?=\d)/, "_");

export const inputOptional = (schema: unknown): boolean => !isSchema(schema) || !Array.isArray(schema.required) || schema.required.length === 0;

export const typeOf = (schema: unknown, pad = ""): string => convert(schema, pad, { root: schema, open: new Set() });

function resolve(ref: string, root: unknown): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const unescape = (part: string) => part.replace(/~1/g, "/").replace(/~0/g, "~");
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((at, part) => (isSchema(at) ? at[unescape(part)] : undefined), root);
}

function convert(schema: unknown, pad: string, context: Context): string {
  if (schema === false) return "never";
  if (!isSchema(schema)) return "unknown";
  if (typeof schema.$ref === "string") return reference(schema.$ref, pad, context);
  return literal(schema) ?? combined(schema, pad, context) ?? byType(schema, pad, context);
}

function literal(schema: Schema): string | undefined {
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  return undefined;
}

function combined(schema: Schema, pad: string, context: Context): string | undefined {
  const combinator = COMBINATORS.find(([keyword]) => Array.isArray(schema[keyword]));
  if (combinator) return (schema[combinator[0]] as unknown[]).map((part) => convert(part, pad, context)).join(combinator[1]) || "unknown";
  if (Array.isArray(schema.type)) return schema.type.map((type) => convert({ ...schema, type }, pad, context)).join(" | ");
  return undefined;
}

function byType(schema: Schema, pad: string, context: Context): string {
  if (schema.type === "array") return `Array<${convert(schema.items, pad, context)}>`;
  if (schema.type === "object" || schema.properties) return object(schema, pad, context);
  return PRIMITIVES[String(schema.type)] ?? "unknown";
}

function reference(ref: string, pad: string, context: Context): string {
  if (context.open.has(ref)) return "unknown";
  return convert(resolve(ref, context.root), pad, { root: context.root, open: new Set([...context.open, ref]) });
}

function describe(schema: unknown, pad: string): string {
  if (!isSchema(schema) || typeof schema.description !== "string" || !schema.description.trim()) return "";
  const firstLine = schema.description.trim().split("\n")[0]!.replace(/\*\//g, "* /");
  return `${pad}/** ${firstLine} */\n`;
}

function object(schema: Schema, pad: string, context: Context): string {
  const properties = isSchema(schema.properties) ? schema.properties : {};
  const names = Object.keys(properties);
  if (!names.length) return `Record<string, ${isSchema(schema.additionalProperties) ? convert(schema.additionalProperties, pad, context) : "unknown"}>`;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const inner = `${pad}  `;
  const lines = names.map((name) => {
    const optional = required.has(name) ? "" : "?";
    return `${describe(properties[name], inner)}${inner}${key(name)}${optional}: ${convert(properties[name], inner, context)};`;
  });
  return `{\n${lines.join("\n")}\n${pad}}`;
}
