// pg_dump output carries session settings, comments and restrict markers that
// are not schema. Normalization drops exactly those and keeps every statement
// byte for byte, so two dumps of the same schema compare equal.
import { describe, expect, it } from "vitest";
import { normalizeDump } from "../../scripts/squash/logic/dump-schema";

const CREATE_WEBHOOK_DELIVERY = [
  "CREATE TABLE public.webhook_delivery (",
  "    signature_digest text NOT NULL,",
  "    delivery_id text,",
  "    received_at timestamp with time zone DEFAULT now() NOT NULL,",
  "    CONSTRAINT webhook_delivery_delivery_id_shape CHECK (((delivery_id IS NULL) OR (delivery_id ~ '^[A-Za-z0-9_-]{1,64}$'::text))),",
  "    CONSTRAINT webhook_delivery_signature_digest_shape CHECK ((signature_digest ~ '^[0-9a-f]{64}$'::text))",
  ");",
].join("\n");

const ADD_PRIMARY_KEY = [
  "ALTER TABLE ONLY public.webhook_delivery",
  "    ADD CONSTRAINT webhook_delivery_pkey PRIMARY KEY (signature_digest);",
].join("\n");

/** A captured pg_dump 17.10 fragment: header, settings, schema noise, two statements, footer. */
const DUMP_FRAGMENT = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "",
  "\\restrict lDgt9WM80qZygByaBVM7n9yE5ClzzvEsU4KlVjHdbOsqwY4Qioc4u5ttLPVFBdH",
  "",
  "-- Dumped from database version 17.10",
  "-- Dumped by pg_dump version 17.10",
  "",
  "SET statement_timeout = 0;",
  "SET client_encoding = 'UTF8';",
  "SET standard_conforming_strings = on;",
  "SELECT pg_catalog.set_config('search_path', '', false);",
  "SET row_security = off;",
  "",
  "--",
  "-- Name: public; Type: SCHEMA; Schema: -; Owner: -",
  "--",
  "",
  "CREATE SCHEMA public;",
  "",
  "",
  "--",
  "-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -",
  "--",
  "",
  "COMMENT ON SCHEMA public IS 'standard public schema';",
  "",
  "",
  "SET default_tablespace = '';",
  "",
  "SET default_table_access_method = heap;",
  "",
  "--",
  "-- Name: webhook_delivery; Type: TABLE; Schema: public; Owner: -",
  "--",
  "",
  CREATE_WEBHOOK_DELIVERY,
  "",
  "",
  "--",
  "-- Name: webhook_delivery webhook_delivery_pkey; Type: CONSTRAINT; Schema: public; Owner: -",
  "--",
  "",
  ADD_PRIMARY_KEY,
  "",
  "",
  "--",
  "-- PostgreSQL database dump complete",
  "--",
  "",
  "\\unrestrict lDgt9WM80qZygByaBVM7n9yE5ClzzvEsU4KlVjHdbOsqwY4Qioc4u5ttLPVFBdH",
  "",
].join("\n");

describe("normalizeDump", () => {
  it("keeps the statements byte for byte and drops every noise class", () => {
    expect(normalizeDump(DUMP_FRAGMENT)).toBe(
      `${CREATE_WEBHOOK_DELIVERY}\n${ADD_PRIMARY_KEY}\n`,
    );
  });

  it("strips a restrict marker with a different random token", () => {
    const text =
      "\\restrict abc123\nCREATE TABLE public.t (\n    id integer\n);\n\\unrestrict abc123\n";
    expect(normalizeDump(text)).toBe(
      "CREATE TABLE public.t (\n    id integer\n);\n",
    );
  });

  it("keeps a statement line that starts with SELECT inside a view body", () => {
    const text = "CREATE VIEW public.v AS\n SELECT 1;\n";
    expect(normalizeDump(text)).toBe(text);
  });

  it("is idempotent", () => {
    const once = normalizeDump(DUMP_FRAGMENT);
    expect(normalizeDump(once)).toBe(once);
  });
});
