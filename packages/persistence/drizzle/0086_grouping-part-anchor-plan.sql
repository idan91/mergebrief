-- contracts 0.1.0
-- A grouping part now names the anchor plan it was grouped under; one stored
-- before reads off its shape. The worker wipes a span's detail parts when its
-- grouping part is gone, so a resumed run regenerates.
DELETE FROM "generation_part" WHERE "part_key" = 'grouping' AND ("body"::jsonb ->> 'anchorPlanDigest') IS NULL;
