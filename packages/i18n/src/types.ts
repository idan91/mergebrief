import type en from "../locales/en.json";

// Typed keys for every consumer: an unknown catalog key fails to compile.
// The barrel's type-only re-export pulls this augmentation into any program
// that imports the package. JSON imports widen values to `string`, so
// interpolation-param sets are gate-enforced by the catalog suite, not
// compile-enforced.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
    strictKeyChecks: true;
    returnNull: false;
  }
}

type PluralBase<K extends string> = K extends `${infer Base}_one`
  ? Base
  : K extends `${infer Base}_other`
    ? Base
    : K;

type DottedLeaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${PluralBase<K>}`
    : DottedLeaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every catalog key, dotted, plural suffixes collapsed to their base key. */
export type TranslationKey = DottedLeaves<typeof en>;
