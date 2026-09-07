// oxlint 1.72 exports no plugin types (only `RuleTester`), so the rules
// declare the slice of the ESLint-compatible API they use.
export interface RuleNode {
  readonly type: string;
}

export interface RuleContext {
  readonly filename: string;
  readonly options: readonly unknown[];
  report(descriptor: { node: RuleNode; messageId: string }): void;
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
