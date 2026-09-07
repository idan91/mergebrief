declare const flag: boolean;
declare const base: { id: number };
declare const extra: { flag: boolean } | undefined;

export const plain = { ...base, id: 1 };

export function buildAssigned(): { id: number; flag?: boolean } {
  const result: { id: number; flag?: boolean } = { id: 2 };

  if (flag) result.flag = flag;

  return result;
}

export const list = [1, ...(extra ? [extra] : [])];
