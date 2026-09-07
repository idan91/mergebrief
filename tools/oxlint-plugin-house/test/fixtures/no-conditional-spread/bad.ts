declare const flag: boolean;
declare const label: string | undefined;
declare function send(args: object): void;

export const ternary = { id: 1, ...(flag ? { flag } : {}) };
export const and = { id: 2, ...(label && { label }) };
export const coalesce = { id: 3, ...(label ?? {}) };
send({ id: 4, ...(flag ? { flag } : {}) });
