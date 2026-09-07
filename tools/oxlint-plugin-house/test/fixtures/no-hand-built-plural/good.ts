type Translate = (key: string, options: { count: number }) => string;

// The same string bad.ts hand-builds. The catalog carries threads.hidden_one
// and threads.hidden_other, so a locale with three plural forms still works.
export function describe(t: Translate, count: number): string {
  return t("threads.hidden", { count });
}

export function pick(flag: boolean): string {
  return flag ? "a" : "b";
}
