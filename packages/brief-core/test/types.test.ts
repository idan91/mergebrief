import { describe, expect, it } from "vitest";
import { enumPreservingJsonSchema } from "generators";
import {
  BriefGenerationSchema,
  BriefSchema,
  IntentBuckets,
  IntentCheckGenerationSchema,
  briefGenerationSchemaWith,
  DeltaBriefSchema,
  IntentCheckSchema,
  RevisionNarrativeSchema,
} from "../src/types";
import {
  makeValidBrief,
  makeValidDeltaBrief,
  makeValidRevisionNarrative,
} from "./helpers";

describe("BriefSchema", () => {
  it("accepts a well-formed brief", () => {
    expect(BriefSchema.safeParse(makeValidBrief()).success).toBe(true);
  });

  it("rejects an out-of-vocabulary category", () => {
    const bad = makeValidBrief();
    bad.changeGroups[0]!.dominantCategory = "refactor-everything" as never;
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an out-of-vocabulary risk-surface attribute", () => {
    const bad = makeValidBrief();
    bad.chunks[0]!.riskSurface = ["scary"] as never;
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts the trio attributes with a riskNotes entry", () => {
    const withNotes = makeValidBrief();
    withNotes.chunks[0]!.riskSurface = [
      "new-dependency",
      "new-abstraction",
      "comment-contradicts-code",
    ];
    Object.assign(withNotes.chunks[0]!, {
      riskNotes: [
        {
          attr: "comment-contradicts-code",
          note: "comment says retries 3 times (L12), code retries once (L15)",
        },
      ],
    });
    expect(BriefSchema.safeParse(withNotes).success).toBe(true);
  });

  it("rejects a riskNotes entry with an out-of-vocabulary attr", () => {
    const bad = makeValidBrief();
    Object.assign(bad.chunks[0]!, {
      riskNotes: [{ attr: "scary", note: "n" }],
    });
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts the anchor stamp and its absence; rejects unknown states", () => {
    const anchored = {
      ...makeValidBrief(),
      anchor: { state: "anchored" },
    };
    expect(BriefSchema.safeParse(anchored).success).toBe(true);

    const restart = {
      ...makeValidBrief(),
      anchor: { state: "fresh-restart", reason: "model-swap" },
    };
    expect(BriefSchema.safeParse(restart).success).toBe(true);

    // Pre-feature briefs have no anchor; the read path must keep parsing.
    expect(BriefSchema.safeParse(makeValidBrief()).success).toBe(true);

    const bad = {
      ...makeValidBrief(),
      anchor: { state: "floating" },
    };
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });

  it("keeps anchor out of the model-facing generation schema", () => {
    expect("anchor" in BriefGenerationSchema.shape).toBe(false);
  });

  it("accepts a well-formed readingOrder", () => {
    const withOrder = {
      ...makeValidBrief(),
      readingOrder: [
        { groupId: "g1", why: "establishes the schema the rest builds on" },
      ],
    };
    expect(BriefSchema.safeParse(withOrder).success).toBe(true);
  });

  it("rejects a readingOrder step missing why", () => {
    const bad = {
      ...makeValidBrief(),
      readingOrder: [{ groupId: "g1" }],
    };
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });
});

describe("DeltaBriefSchema", () => {
  it("accepts a well-formed delta", () => {
    expect(DeltaBriefSchema.safeParse(makeValidDeltaBrief()).success).toBe(
      true,
    );
  });
});

describe("RevisionNarrativeSchema", () => {
  it("accepts a well-formed revision narrative", () => {
    expect(
      RevisionNarrativeSchema.safeParse(makeValidRevisionNarrative()).success,
    ).toBe(true);
  });
});

const chunk = (riskSurface: string[]) => ({
  id: "c1",
  changeGroupId: "g1",
  file: "services/billing/invoice.ts",
  concern: "implementation",
  role: "core",
  loc: { added: 1, deleted: 0 },
  addedRanges: [{ start: 1, end: 1 }],
  removedRanges: [],
  riskSurface,
});
const briefGen = (riskSurface: string[]) => ({
  summary: "s",
  intentCheck: {
    ticketUrls: [],
    ticketTitles: [],
    specificity: "none",
    scopeNote: "",
    items: [],
    alignment: { read: "", goal: "", response: "" },
  },
  changeGroups: [
    {
      id: "g1",
      title: "t",
      summary: "s",
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [chunk(riskSurface)],
  concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
});

const validIntentCheck = {
  ticketUrls: ["https://tracker.example/T-1"],
  specificity: "precise",
  scopeNote: "",
  accomplished: [
    {
      intent: "add the widget endpoint",
      quote: "Add a widget endpoint returning the list",
      sourceUrl: "https://tracker.example/T-1",
      groupIds: ["g1"],
      acknowledged: false,
    },
  ],
  statedButMissing: [
    {
      intent: "document the endpoint",
      quote: "and document it in the API guide",
      sourceUrl: "https://tracker.example/T-1",
      groupIds: [],
      acknowledged: false,
    },
  ],
  doneButUnstated: [
    {
      intent: "drive-by lint fix",
      quote: "",
      sourceUrl: "",
      groupIds: ["g1"],
      acknowledged: false,
    },
  ],
  deviations: [
    {
      intent: "drops the widget cache the ticket asked to keep",
      quote: "keep the widget cache",
      sourceUrl: "https://tracker.example/T-1",
      groupIds: ["g1"],
      acknowledged: true,
    },
  ],
  maskedFixes: [
    {
      intent: "claims the flaky test is fixed but only skips it",
      quote: "fixes the flaky widget test",
      sourceUrl: "https://tracker.example/T-1",
      groupIds: ["g1"],
      acknowledged: false,
    },
  ],
};

/**
 * The GENERATION shape of the same check: one tagged `items` array. Five bucket
 * arrays cannot compile into the grammar at any field count;
 * `fanOutIntentCheck` converts this to the stored shape above.
 */
const validGenerationIntentCheck = {
  ticketUrls: ["https://tracker.example/T-1"],
  ticketTitles: ["Widget endpoint returns the list"],
  specificity: "precise",
  scopeNote: "",
  items: [
    {
      bucket: "accomplished",
      intent: "add the widget endpoint",
      quote: "Add a widget endpoint returning the list",
      sourceUrl: "https://tracker.example/T-1",
      groupIds: ["g1"],
      acknowledged: false,
    },
    {
      bucket: "deviations",
      intent: "drops the widget cache the ticket asked to keep",
      quote: "keep the widget cache",
      sourceUrl: "https://tracker.example/T-1",
      groupIds: ["g1"],
      acknowledged: true,
    },
  ],
  alignment: { read: "", goal: "", response: "" },
};

describe("IntentCheckSchema", () => {
  it("accepts a well-formed intent check", () => {
    expect(IntentCheckSchema.safeParse(validIntentCheck).success).toBe(true);
  });

  it("accepts broad/none specificity with empty buckets", () => {
    for (const specificity of ["broad", "none"]) {
      const parsed = IntentCheckSchema.safeParse({
        ticketUrls: [],
        specificity,
        scopeNote: "",
        accomplished: [],
        statedButMissing: [],
        doneButUnstated: [],
        deviations: [],
        maskedFixes: [],
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("requires the alarm buckets; strict structured output has no optionals", () => {
    const { deviations: _d, ...noDeviations } =
      structuredClone(validIntentCheck);
    expect(IntentCheckSchema.safeParse(noDeviations).success).toBe(false);
    const { maskedFixes: _c, ...noClaimed } = structuredClone(validIntentCheck);
    expect(IntentCheckSchema.safeParse(noClaimed).success).toBe(false);
  });

  it("requires acknowledged on every bucket's items, one shared shape", () => {
    const bad = structuredClone(validIntentCheck);
    const target: Partial<(typeof bad.accomplished)[number]> =
      bad.accomplished[0]!;
    delete target.acknowledged;
    expect(IntentCheckSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an out-of-vocabulary specificity", () => {
    const bad = { ...structuredClone(validIntentCheck), specificity: "vague" };
    expect(IntentCheckSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a stated ask missing its quote; strict output has no optionals", () => {
    const bad = structuredClone(validIntentCheck);
    const target: Partial<(typeof bad.statedButMissing)[number]> =
      bad.statedButMissing[0]!;
    delete target.quote;
    expect(IntentCheckSchema.safeParse(bad).success).toBe(false);
  });

  it("requires groupIds on BOTH stated-side buckets, one shared shape", () => {
    const noAccomplishedIds = structuredClone(validIntentCheck);
    const accomplished: Partial<
      (typeof noAccomplishedIds.accomplished)[number]
    > = noAccomplishedIds.accomplished[0]!;
    delete accomplished.groupIds;
    expect(IntentCheckSchema.safeParse(noAccomplishedIds).success).toBe(false);

    const noMissingIds = structuredClone(validIntentCheck);
    const missing: Partial<(typeof noMissingIds.statedButMissing)[number]> =
      noMissingIds.statedButMissing[0]!;
    delete missing.groupIds;
    expect(IntentCheckSchema.safeParse(noMissingIds).success).toBe(false);
  });

  it("defaults ticketTitles to [] on a legacy stored check", () => {
    // validIntentCheck deliberately carries no ticketTitles; it doubles as
    // the legacy-artifact fixture.
    const legacy = IntentCheckSchema.safeParse(
      structuredClone(validIntentCheck),
    );
    expect(legacy.success).toBe(true);
    if (!legacy.success) {
      return;
    }
    expect(legacy.data.ticketTitles).toEqual([]);
  });

  it("all five buckets share ONE item shape for the grammar budget", () => {
    // A doneButUnstated item parses with the same fields as a stated ask; the
    // ticket-side fields must be "" there, enforced by the validator, not the
    // schema, since one shared shape is all the grammar budget allows.
    const parsed = IntentCheckSchema.safeParse({
      ...structuredClone(validIntentCheck),
      doneButUnstated: [
        {
          intent: "d",
          quote: "",
          sourceUrl: "",
          groupIds: ["g1"],
          acknowledged: false,
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(
      Object.keys(parsed.data.doneButUnstated[0] ?? {}).toSorted(),
    ).toEqual(["acknowledged", "groupIds", "intent", "quote", "sourceUrl"]);
  });
});

describe("IntentCheckGenerationSchema: grammar budget", () => {
  it("accepts the tagged one-array wire shape", () => {
    expect(
      IntentCheckGenerationSchema.safeParse(validGenerationIntentCheck).success,
    ).toBe(true);
  });

  it("REQUIRES ticketTitles on the wire, which has no optional fields", () => {
    const bad: Record<string, unknown> = structuredClone(
      validGenerationIntentCheck,
    );
    delete bad["ticketTitles"];
    expect(IntentCheckGenerationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an item with no bucket tag, which the fan-out cannot dispatch", () => {
    const bad = structuredClone(validGenerationIntentCheck);
    const target: Partial<(typeof bad.items)[number]> = bad.items[0]!;
    delete target.bucket;
    expect(IntentCheckGenerationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an out-of-vocabulary bucket tag from the closed set", () => {
    const bad = structuredClone(validGenerationIntentCheck);
    const target = bad.items[0];
    if (target) {
      target.bucket = "invented";
    }
    expect(IntentCheckGenerationSchema.safeParse(bad).success).toBe(false);
  });

  it("matches the registered bucket names to the stored arrays", () => {
    const storedArrays = Object.keys(IntentCheckSchema.shape).filter(
      (key) =>
        ![
          "ticketUrls",
          "ticketTitles",
          "specificity",
          "scopeNote",
          "primaryTicket",
          "alignment",
        ].includes(key),
    );
    expect(storedArrays.toSorted()).toEqual(
      Object.values(IntentBuckets).toSorted(),
    );
  });

  it("keeps the generation shape leaner than five arrays", () => {
    // One `$ref` site instead of five. The grammar inlines per site, so this
    // is the property that makes the intent check compile at all.
    const arrayFields = Object.entries(
      IntentCheckGenerationSchema.shape,
    ).filter(([, schema]) => schema.def.type === "array");
    expect(arrayFields.map(([name]) => name).toSorted()).toEqual([
      "items",
      "ticketTitles",
      "ticketUrls",
    ]);
  });
});

describe("intentCheck on the brief schemas: the back-compat split", () => {
  it("BriefGenerationSchema REQUIRES intentCheck", () => {
    const { intentCheck: _dropped, ...withoutIntent } = briefGen([
      "mutates-state",
    ]);
    expect(BriefGenerationSchema.safeParse(withoutIntent).success).toBe(false);
    expect(
      BriefGenerationSchema.safeParse({
        ...withoutIntent,
        intentCheck: validGenerationIntentCheck,
      }).success,
    ).toBe(true);
  });

  it("BriefSchema read path treats intentCheck as optional for old briefs", () => {
    expect(BriefSchema.safeParse(makeValidBrief()).success).toBe(true);
    const withIntent = {
      ...makeValidBrief(),
      intentCheck: validIntentCheck,
    };
    const parsed = BriefSchema.safeParse(withIntent);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.intentCheck?.specificity).toBe("precise");
  });

  it("delta and revision-narrative schemas never carry intentCheck", () => {
    const delta = DeltaBriefSchema.safeParse({
      ...makeValidDeltaBrief(),
      intentCheck: validIntentCheck,
    });
    expect(delta.success).toBe(true);
    if (!delta.success) {
      return;
    }
    expect("intentCheck" in delta.data).toBe(false);
    // RevisionNarrativeSchema is .strict(); an invented intentCheck hard-fails.
    const narrative = RevisionNarrativeSchema.safeParse({
      ...makeValidRevisionNarrative(),
      intentCheck: validIntentCheck,
    });
    expect(narrative.success).toBe(false);
  });

  it("emits the specificity enum in the enum-preserving json_schema", () => {
    const wire = JSON.stringify(
      enumPreservingJsonSchema(BriefGenerationSchema),
    );
    expect(wire).toContain('"precise"');
    expect(wire).toContain('"broad"');
    // "none" is a common word; assert the full enum array to be safe.
    expect(wire.replace(/\s/g, "")).toContain(
      '"enum":["precise","broad","none"]',
    );
  });

  it("emits the bucket enum on the wire, and no five-array residue", () => {
    // The fan-out dispatches on `bucket`, so the closed vocabulary must reach
    // the wire for server-side enforcement, not just the client-side Zod parse.
    const wire = JSON.stringify(
      enumPreservingJsonSchema(BriefGenerationSchema),
    ).replace(/\s/g, "");
    expect(wire).toContain(
      `"enum":[${Object.values(IntentBuckets)
        .map((b) => `"${b}"`)
        .join(",")}]`,
    );
    expect(wire).toContain('"items"');
    // The five stored bucket arrays must NOT appear as generation properties;
    // five array `$ref` sites is exactly what blows the grammar budget.
    for (const bucket of Object.values(IntentBuckets)) {
      expect(wire).not.toContain(`"${bucket}":{"type":"array"`);
    }
  });
});

describe("briefGenerationSchemaWith: per-generation vocabulary", () => {
  it("returns the exact static schema when no custom names exist", () => {
    expect(briefGenerationSchemaWith([])).toBe(BriefGenerationSchema);
  });

  it("accepts an injected custom name alongside built-ins", () => {
    const schema = briefGenerationSchemaWith(["touches-billing"]);
    const parsed = schema.safeParse(
      briefGen(["touches-auth", "touches-billing"]),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects a token that is neither built-in nor injected", () => {
    const schema = briefGenerationSchemaWith(["touches-billing"]);
    expect(schema.safeParse(briefGen(["not-a-thing"])).success).toBe(false);
    // The static schema rejects the custom name too; the extension is per-generation.
    expect(
      BriefGenerationSchema.safeParse(briefGen(["touches-billing"])).success,
    ).toBe(false);
  });

  it("carries injected names into the enum-preserving json_schema", () => {
    const wire = JSON.stringify(
      enumPreservingJsonSchema(briefGenerationSchemaWith(["touches-billing"])),
    );
    expect(wire).toContain('"touches-billing"');
    expect(wire).toContain('"touches-auth"');
    // And the base schema's wire form does NOT know the custom name.
    const baseWire = JSON.stringify(
      enumPreservingJsonSchema(briefGenerationSchemaWith([])),
    );
    expect(baseWire).not.toContain('"touches-billing"');
  });
});
