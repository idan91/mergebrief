// Catalog registration calls. A route file registers each operation it
// serves with one top-level call beside its factory — module load is what
// fills the registry, so importing the route module is registration. The
// factory itself stays a plain function, untouched.
import {
  productOperationRegistry,
  type ProductOperationRegistry,
} from "./registry";
import {
  OPERATION_KIND,
  WRITE_CLASSIFICATION,
  type ActionClassification,
  type ProductActionDescriptor,
  type ProductQueryDescriptor,
} from "./types";

type QueryInput = Omit<ProductQueryDescriptor, "kind">;
type ActionInput = Omit<ProductActionDescriptor, "kind">;

function isActionClassification(value: string): value is ActionClassification {
  return (
    value === WRITE_CLASSIFICATION.PRIVATE_WRITE ||
    value === WRITE_CLASSIFICATION.EXTERNAL_WRITE
  );
}

export interface ProductOperationRegistrars {
  readonly registerProductQuery: (descriptor: QueryInput) => void;
  readonly registerProductAction: (descriptor: ActionInput) => void;
}

export function createProductOperationRegistrars(
  registry: ProductOperationRegistry,
): ProductOperationRegistrars {
  return {
    registerProductQuery(descriptor) {
      if (descriptor.classification !== WRITE_CLASSIFICATION.READ) {
        throw new Error(
          `product query "${descriptor.id}" must be classified "read"`,
        );
      }
      registry.register({ ...descriptor, kind: OPERATION_KIND.QUERY });
    },
    registerProductAction(descriptor) {
      if (!isActionClassification(descriptor.classification)) {
        throw new Error(
          `product action "${descriptor.id}" must be classified "private-write" or "external-write"`,
        );
      }
      registry.register({ ...descriptor, kind: OPERATION_KIND.ACTION });
    },
  };
}

export const { registerProductQuery, registerProductAction } =
  createProductOperationRegistrars(productOperationRegistry);
