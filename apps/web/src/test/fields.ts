type OptionalField<Shape> = {
  [Field in keyof Shape]-?: undefined extends Shape[Field] ? Field : never;
}[keyof Shape];

/** A copy without the listed optional fields, the way a parser leaves a wire null. */
export function omitFields<Shape extends object>(
  shape: Shape,
  ...fields: OptionalField<Shape>[]
): Shape {
  const copy = { ...shape };
  for (const field of fields) {
    Reflect.deleteProperty(copy, field);
  }
  return copy;
}
