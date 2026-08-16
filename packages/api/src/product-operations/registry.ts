// The catalog store. Registration happens at module load (route files wrap
// their factories), so every failure here is a programmer error — throw, never
// Result. Enumeration feeds the committed manifest.
import type { ProductOperationDescriptor } from "./types";

const KEBAB_CASE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export interface ProductOperationRegistry {
  register(descriptor: ProductOperationDescriptor): void;
  /** Snapshot sorted by id — stable output for the manifest generator. */
  list(): readonly ProductOperationDescriptor[];
}

export function createProductOperationRegistry(): ProductOperationRegistry {
  const descriptors = new Map<string, ProductOperationDescriptor>();
  return {
    register(descriptor) {
      if (!KEBAB_CASE_ID.test(descriptor.id)) {
        throw new Error(
          `product operation id ${JSON.stringify(descriptor.id)} is not kebab-case`,
        );
      }
      if (descriptors.has(descriptor.id)) {
        throw new Error(`duplicate product operation id "${descriptor.id}"`);
      }
      descriptors.set(descriptor.id, descriptor);
    },
    list() {
      return [...descriptors.values()].toSorted((a, b) =>
        a.id.localeCompare(b.id),
      );
    },
  };
}

/** The instance the route wrappers feed; the manifest enumerates from here. */
export const productOperationRegistry = createProductOperationRegistry();
