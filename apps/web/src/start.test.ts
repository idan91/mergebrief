import { describe, expect, it } from "vitest";

import { apiErrorSerializationAdapter } from "./data/apiFetch";
import { startInstance } from "./start";

describe("start instance", () => {
  it("registers the ApiError serialization adapter", async () => {
    const options = await startInstance.getOptions();

    expect(options.serializationAdapters).toContain(
      apiErrorSerializationAdapter,
    );
  });
});
