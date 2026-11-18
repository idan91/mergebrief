declare const flag: boolean;
declare const label: string | undefined;
declare const extra: { title: string } | undefined;

export const ternary = <input {...(flag ? { disabled: true } : {})} />;
export const and = <input {...(label && { "aria-label": label })} />;
export const coalesce = <input {...(extra ?? {})} />;
