// oxlint 1.72 exports no plugin types (only `RuleTester`), so the rules
// declare the slice of the ESLint-compatible API they use.
// The rules read syntax only, so one loose node shape covers every field they
// touch; a missing field is undefined, never a cast.
export interface RuleNode {
  readonly type: string;
  readonly name?: string;
  readonly value?: unknown;
  readonly callee?: RuleNode;
  readonly arguments?: readonly RuleNode[];
  readonly object?: RuleNode;
  readonly property?: RuleNode;
  readonly expressions?: readonly RuleNode[];
  readonly quasis?: readonly {
    readonly value: { readonly cooked: string | null };
  }[];
}

export interface RulePosition {
  readonly line: number;
  readonly column: number;
}

export interface RuleLocation {
  readonly start: RulePosition;
  readonly end: RulePosition;
}

export interface RuleComment {
  readonly value: string;
  readonly loc: RuleLocation;
}

export interface RuleSourceCode {
  readonly lines: readonly string[];
  getAllComments(): readonly RuleComment[];
}

export type RuleReport =
  | {
      node: RuleNode;
      messageId: string;
      data?: Readonly<Record<string, string>>;
    }
  | {
      loc: RuleLocation;
      messageId: string;
      data?: Readonly<Record<string, string>>;
    };

export interface RuleContext {
  readonly filename: string;
  readonly options: readonly unknown[];
  readonly sourceCode: RuleSourceCode;
  report(descriptor: RuleReport): void;
}

export interface RuleMeta {
  readonly type: "problem" | "suggestion" | "layout";
  readonly docs: { readonly description: string };
  readonly messages: Readonly<Record<string, string>>;
  readonly schema?: readonly unknown[];
}

export type RuleVisitor = Record<string, (node: RuleNode) => void>;

export interface RuleDefinition {
  readonly meta: RuleMeta;
  create(context: RuleContext): RuleVisitor;
}

export interface HousePlugin {
  readonly meta: { readonly name: "house" };
  readonly rules: Readonly<Record<string, RuleDefinition>>;
}
