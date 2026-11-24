import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRELUDE = join(ROOT, ".cell", "prelude.d.ts");
const SESSION = join(ROOT, ".cell", "session.d.ts");
const CELL = join(ROOT, ".cell", "cell.ts");
const MAX_SHOWN_ERRORS = 8;
const TYPE_FORMAT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType;

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  types: ["bun"],
  typeRoots: [join(ROOT, "node_modules", "@types")],
};

export type Declared = { name: string; kind: "const" | "let" | "type" | "opaque"; node: ts.Node };
export type Verdict = { kind: "refused"; why: string } | { kind: "admitted"; commit(): void };

const patternNames = (name: ts.BindingName): ts.Identifier[] =>
  ts.isIdentifier(name) ? [name] : name.elements.flatMap((element) => (ts.isBindingElement(element) ? patternNames(element.name) : []));

function declaredBy(statement: ts.Statement): Declared[] {
  if (ts.isVariableStatement(statement)) {
    const kind = statement.declarationList.flags & ts.NodeFlags.Const ? "const" : "let";
    const names = statement.declarationList.declarations.flatMap((declaration) => patternNames(declaration.name));
    return names.map((node) => ({ name: node.text, kind, node }));
  }
  if (ts.isFunctionDeclaration(statement) && statement.name) return [{ name: statement.name.text, kind: "const", node: statement.name }];
  if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [{ name: statement.name.text, kind: "opaque", node: statement }];
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return [{ name: statement.name.text, kind: "type", node: statement }];
  return [];
}

export const declared = (file: ts.SourceFile): Declared[] => file.statements.flatMap(declaredBy);

const slot = (d: Declared): string => `${d.kind === "type" ? "type" : "value"} ${d.name}`;

const untyped = (d: Declared): string => (d.kind === "type" ? `type ${d.name} = any;` : `declare let ${d.name}: any;`);

function typed(d: Declared, checker: ts.TypeChecker): string {
  switch (d.kind) {
    case "type":
      return d.node.getText().replace(/\n/g, " ");
    case "opaque":
      return untyped(d);
    case "const":
    case "let": {
      const type = checker.typeToString(checker.getTypeAtLocation(d.node), undefined, TYPE_FORMAT);
      return `declare ${d.kind} ${d.name}: ${type.replace(/\n/g, " ")};`;
    }
  }
}

function refusal(errors: readonly ts.Diagnostic[], file: ts.SourceFile): string {
  const lines = errors.slice(0, MAX_SHOWN_ERRORS).map((error) => {
    const line = file.getLineAndCharacterOfPosition(error.start ?? 0).line + 1;
    return `  line ${line}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`;
  });
  const hidden = errors.length - lines.length;
  return [
    `Not run: ${errors.length} type error${errors.length === 1 ? "" : "s"}. Nothing of the cell ran.`,
    ...lines,
    ...(hidden > 0 ? [`  and ${hidden} more`] : []),
    "help('server.tool') shows a call's signature.",
  ].join("\n");
}

export class Checker {
  private readonly files = new Map<string, string>([[SESSION, ""]]);
  private readonly libraries = new Map<string, ts.SourceFile | undefined>();
  private readonly session = new Map<string, string>();
  private readonly host: ts.CompilerHost;
  private program: ts.Program | undefined;

  constructor(prelude: string) {
    this.files.set(PRELUDE, prelude);
    const base = ts.createCompilerHost(OPTIONS, true);
    this.host = {
      ...base,
      fileExists: (path) => this.files.has(path) || base.fileExists(path),
      readFile: (path) => this.files.get(path) ?? base.readFile(path),
      getSourceFile: (path, version) => {
        const text = this.files.get(path);
        if (text !== undefined) return ts.createSourceFile(path, text, version, true);
        if (!this.libraries.has(path)) this.libraries.set(path, base.getSourceFile(path, version));
        return this.libraries.get(path);
      },
    };
  }

  private errorsIn(path: string): { program: ts.Program; file: ts.SourceFile; errors: ts.Diagnostic[] } {
    const program = ts.createProgram({ rootNames: [PRELUDE, SESSION, CELL], options: OPTIONS, host: this.host, oldProgram: this.program });
    this.program = program;
    const file = program.getSourceFile(path)!;
    const found = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)];
    return { program, file, errors: found.filter((d) => d.category === ts.DiagnosticCategory.Error) };
  }

  private remember(lines: readonly (readonly [slot: string, line: string])[]): void {
    for (const [name, line] of lines) this.session.set(name, line);
    this.files.set(SESSION, [...this.session.values()].join("\n"));
  }

  check(source: string): Verdict {
    this.files.set(CELL, `${source}\nexport {};\n`);
    const { program, file, errors } = this.errorsIn(CELL);
    if (errors.length) return { kind: "refused", why: refusal(errors, file) };
    const checker = program.getTypeChecker();
    const found = declared(file).map((d) => ({ slot: slot(d), typed: typed(d, checker), untyped: untyped(d) }));
    return {
      kind: "admitted",
      commit: () => {
        this.remember(found.map((d) => [d.slot, d.typed]));
        if (this.errorsIn(SESSION).errors.length) this.remember(found.map((d) => [d.slot, d.untyped]));
      },
    };
  }
}
