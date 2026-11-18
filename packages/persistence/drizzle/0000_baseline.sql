CREATE TABLE public.api_token (
    id bigint NOT NULL,
    token_hash text NOT NULL,
    user_id bigint NOT NULL,
    user_login text,
    name text NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    grant_id bigint,
    scope text NOT NULL,
    CONSTRAINT api_token_scope_check CHECK ((scope = ANY (ARRAY['read'::text, 'private-write'::text, 'external-write'::text])))
);
--> statement-breakpoint
ALTER TABLE public.api_token ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.api_token_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    installation_id bigint,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_type text NOT NULL,
    actor_id bigint,
    target_type text,
    target_id bigint,
    metadata jsonb,
    operation text NOT NULL,
    outcome text NOT NULL,
    classification text,
    channel text,
    credential_id bigint,
    request_id text,
    client text,
    source text DEFAULT 'installation'::text NOT NULL,
    CONSTRAINT audit_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['reviewer'::text, 'app'::text, 'system'::text]))),
    CONSTRAINT audit_log_channel_check CHECK (((channel IS NULL) OR (channel = ANY (ARRAY['cookie'::text, 'bearer'::text, 'webhook'::text, 'worker'::text])))),
    CONSTRAINT audit_log_classification_check CHECK (((classification IS NULL) OR (classification = ANY (ARRAY['private-write'::text, 'external-write'::text])))),
    CONSTRAINT audit_log_client_shape CHECK (((client IS NULL) OR (client ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'::text))),
    CONSTRAINT audit_log_operation_shape CHECK ((operation ~ '^[a-z][a-z0-9-]{0,63}$'::text)),
    CONSTRAINT audit_log_outcome_check CHECK ((outcome = ANY (ARRAY['ok'::text, 'denied'::text, 'failed'::text]))),
    CONSTRAINT audit_log_request_id_shape CHECK (((request_id IS NULL) OR (request_id ~ '^[A-Za-z0-9_-]{1,64}$'::text))),
    CONSTRAINT audit_log_source_shape CHECK ((((source = 'installation'::text) AND (installation_id IS NOT NULL)) OR ((source = 'url'::text) AND (installation_id IS NULL)))),
    CONSTRAINT audit_log_target_type_shape CHECK (((target_type IS NULL) OR (target_type ~ '^[a-z][a-z0-9_]{0,63}$'::text)))
);
--> statement-breakpoint
ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.auth_session (
    id bigint NOT NULL,
    session_token_hash text NOT NULL,
    reviewer_id bigint NOT NULL,
    reviewer_login text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    grant_id bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE public.auth_session ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.auth_session_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.brief (
    id bigint NOT NULL,
    installation_id bigint,
    pull_request_id bigint NOT NULL,
    base_sha text NOT NULL,
    head_sha text NOT NULL,
    head_index integer NOT NULL,
    commit_count integer NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    effort text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    repo_config text,
    anchor_state text,
    anchor_reason text,
    body_version integer NOT NULL,
    session_chunk_count integer,
    session_group_count integer,
    session_flag_count integer,
    carried_chunk_ids text[],
    used_group_ids text[] NOT NULL,
    CONSTRAINT brief_anchor_reason_shape CHECK ((((anchor_state = 'fresh-restart'::text) AND (anchor_reason = 'model-swap'::text)) OR ((anchor_state IS DISTINCT FROM 'fresh-restart'::text) AND (anchor_reason IS NULL)))),
    CONSTRAINT brief_anchor_state_check CHECK (((anchor_state IS NULL) OR (anchor_state = ANY (ARRAY['anchored'::text, 'fresh-restart'::text, 'none'::text])))),
    CONSTRAINT brief_body_check CHECK ((body IS JSON OBJECT)),
    CONSTRAINT brief_repo_config_check CHECK ((repo_config IS JSON OBJECT))
);
--> statement-breakpoint
ALTER TABLE public.brief ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.brief_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.checkpoint (
    id bigint NOT NULL,
    installation_id bigint,
    pull_request_id bigint NOT NULL,
    reviewer_id bigint NOT NULL,
    reviewer_login text,
    last_submitted_sha text NOT NULL,
    submitted_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE public.checkpoint ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.checkpoint_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.chunk_layout (
    id bigint NOT NULL,
    installation_id bigint,
    pull_request_id bigint NOT NULL,
    brief_id bigint NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chunk_layout_body_check CHECK ((body IS JSON OBJECT))
);
--> statement-breakpoint
ALTER TABLE public.chunk_layout ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.chunk_layout_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.comparison_marks (
    id bigint NOT NULL,
    installation_id bigint,
    pull_request_id bigint NOT NULL,
    baseline_sha text NOT NULL,
    head_sha text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    prev_base_sha text NOT NULL,
    new_base_sha text NOT NULL,
    CONSTRAINT comparison_marks_body_check CHECK ((body IS JSON OBJECT))
);
--> statement-breakpoint
ALTER TABLE public.comparison_marks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.comparison_marks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.delta (
    id bigint NOT NULL,
    installation_id bigint,
    pull_request_id bigint NOT NULL,
    baseline_sha text NOT NULL,
    head_sha text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    effort text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    body_version integer NOT NULL,
    skipped boolean DEFAULT false NOT NULL,
    unchanged boolean DEFAULT false NOT NULL,
    CONSTRAINT delta_body_check CHECK ((body IS JSON OBJECT))
);
--> statement-breakpoint
ALTER TABLE public.delta ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.delta_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.disposition (
    id bigint NOT NULL,
    installation_id bigint,
    file_path text NOT NULL,
    attribute text NOT NULL,
    region_start integer NOT NULL,
    region_end integer NOT NULL,
    decision text NOT NULL,
    reason text,
    decided_at timestamp with time zone NOT NULL,
    review_session_id bigint NOT NULL,
    carry_status text,
    evidence_status text,
    evidence_kind text,
    evidence_ref text,
    CONSTRAINT disposition_carry_status_check CHECK (((carry_status IS NULL) OR (carry_status = ANY (ARRAY['new'::text, 'reopened'::text, 'settled'::text, 'dropped'::text])))),
    CONSTRAINT disposition_decision_check CHECK ((decision = ANY (ARRAY['addressed'::text, 'dismissed'::text]))),
    CONSTRAINT disposition_evidence_kind_check CHECK (((evidence_kind IS NULL) OR (evidence_kind = ANY (ARRAY['linked-comment'::text, 'chunk-reviewed'::text, 'manual-note'::text])))),
    CONSTRAINT disposition_evidence_status_check CHECK (((evidence_status IS NULL) OR (evidence_status = 'missing-evidence'::text)))
);
--> statement-breakpoint
ALTER TABLE public.disposition ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.disposition_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.generation (
    id bigint NOT NULL,
    installation_id bigint,
    pull_request_id bigint NOT NULL,
    kind text NOT NULL,
    head_sha text NOT NULL,
    baseline_sha text,
    status text NOT NULL,
    phase text,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    repo_config text,
    error_code text,
    error_params jsonb,
    run_id uuid,
    lease_expires_at timestamp with time zone,
    claims integer DEFAULT 0 NOT NULL,
    triggered_at timestamp with time zone DEFAULT to_timestamp((0)::double precision) NOT NULL,
    awaits_recovery boolean DEFAULT false NOT NULL,
    CONSTRAINT generation_claim_has_lease CHECK (((run_id IS NULL) = (lease_expires_at IS NULL))),
    CONSTRAINT generation_claim_is_running CHECK (((run_id IS NULL) OR (status = 'running'::text))),
    CONSTRAINT generation_error_code_check CHECK (((error_code IS NULL) OR (error_code = ANY (ARRAY['provider-auth'::text, 'provider-rate-limit'::text, 'provider-timeout'::text, 'provider-unavailable'::text, 'provider-refusal'::text, 'provider-spend-limit'::text, 'output-invalid'::text, 'output-secret'::text, 'output-cut'::text, 'generation-config'::text, 'github-access'::text, 'diff-too-large'::text, 'github-unavailable'::text, 'attempts-exhausted'::text, 'unknown'::text])))),
    CONSTRAINT generation_failed_has_code CHECK (((status <> 'failed'::text) OR (error_code IS NOT NULL))),
    CONSTRAINT generation_kind_baseline_shape CHECK ((((kind = 'brief'::text) AND (baseline_sha IS NULL)) OR ((kind = ANY (ARRAY['delta'::text, 'revision-narrative'::text])) AND (baseline_sha IS NOT NULL)))),
    CONSTRAINT generation_kind_check CHECK ((kind = ANY (ARRAY['brief'::text, 'delta'::text, 'revision-narrative'::text]))),
    CONSTRAINT generation_phase_check CHECK (((phase IS NULL) OR (phase = ANY (ARRAY['fetching'::text, 'redacting'::text, 'generating'::text, 'writing'::text])))),
    CONSTRAINT generation_repo_config_check CHECK ((repo_config IS JSON OBJECT)),
    CONSTRAINT generation_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'superseded'::text, 'capped'::text, 'awaiting-trigger'::text])))
);
--> statement-breakpoint
CREATE TABLE public.generation_attempt (
    id bigint NOT NULL,
    installation_id bigint,
    run_id uuid NOT NULL,
    generation_id bigint NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    units integer DEFAULT 1 NOT NULL,
    parts_done integer DEFAULT 0 NOT NULL,
    parts_total integer,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT generation_attempt_parts_done_check CHECK ((parts_done >= 0)),
    CONSTRAINT generation_attempt_parts_total_check CHECK (((parts_total IS NULL) OR (parts_total >= 0))),
    CONSTRAINT generation_attempt_units_check CHECK ((units >= 0))
);
--> statement-breakpoint
ALTER TABLE public.generation_attempt ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.generation_attempt_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
ALTER TABLE public.generation ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.generation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.generation_part (
    id bigint NOT NULL,
    installation_id bigint,
    pull_request_id bigint NOT NULL,
    base_sha text NOT NULL,
    head_sha text NOT NULL,
    part_key text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT generation_part_body_check CHECK ((body IS JSON OBJECT)),
    CONSTRAINT generation_part_part_key_check CHECK ((part_key ~ '^[a-z][a-z0-9]*(:[a-z0-9]+)*$'::text))
);
--> statement-breakpoint
ALTER TABLE public.generation_part ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.generation_part_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.github_grant (
    id bigint NOT NULL,
    gh_token_ciphertext text NOT NULL,
    gh_refresh_token_ciphertext text NOT NULL,
    key_ref text NOT NULL,
    refresh_expires_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE public.github_grant ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.github_grant_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.hunk_span (
    id bigint NOT NULL,
    installation_id bigint,
    pull_request_id bigint NOT NULL,
    baseline_sha text NOT NULL,
    head_sha text NOT NULL,
    spans text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hunk_span_spans_check CHECK ((spans IS JSON ARRAY))
);
--> statement-breakpoint
ALTER TABLE public.hunk_span ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.hunk_span_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.inbox_archive (
    id bigint NOT NULL,
    installation_id bigint,
    pull_request_id bigint NOT NULL,
    reviewer_id bigint NOT NULL,
    head_sha text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE public.inbox_archive ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.inbox_archive_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.instance_version (
    id boolean DEFAULT true NOT NULL,
    version text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instance_version_single_row CHECK (id)
);
--> statement-breakpoint
CREATE TABLE public.pull_request (
    id bigint NOT NULL,
    installation_id bigint,
    repo_id bigint NOT NULL,
    pr_number integer NOT NULL,
    repo_slug text,
    state text NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    entry_comment_id bigint,
    title text,
    base_sha text,
    draft boolean DEFAULT false NOT NULL,
    author_login text,
    owner_user_id bigint,
    source text DEFAULT 'installation'::text NOT NULL,
    github_updated_at timestamp with time zone,
    github_read_at timestamp with time zone,
    github_head_sha text,
    github_unreachable_at timestamp with time zone,
    stack jsonb,
    stack_read_at timestamp with time zone,
    row_version integer DEFAULT 0 NOT NULL,
    trigger_approved_by bigint,
    trigger_approved_at timestamp with time zone,
    CONSTRAINT pull_request_open_retention_shape CHECK (((state <> 'open'::text) OR (closed_at IS NULL))),
    CONSTRAINT pull_request_owner_shape CHECK ((((source = 'installation'::text) AND (installation_id IS NOT NULL) AND (owner_user_id IS NULL)) OR ((source = 'url'::text) AND (installation_id IS NULL) AND (owner_user_id IS NOT NULL)))),
    CONSTRAINT pull_request_state_check CHECK ((state = ANY (ARRAY['open'::text, 'closed'::text, 'merged'::text]))),
    CONSTRAINT pull_request_trigger_approval_shape CHECK (((trigger_approved_by IS NULL) = (trigger_approved_at IS NULL)))
);
--> statement-breakpoint
ALTER TABLE public.pull_request ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pull_request_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.review_draft_comment (
    id bigint NOT NULL,
    installation_id bigint,
    review_session_id bigint NOT NULL,
    file_path text NOT NULL,
    side text,
    start_line integer,
    end_line integer,
    body text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    anchor_status text,
    carried_from_session_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    carried_from_comment_id bigint,
    start_side text,
    kind text DEFAULT 'line'::text NOT NULL,
    publish_claim uuid,
    publish_claimed_at timestamp with time zone,
    CONSTRAINT review_draft_comment_anchor_shape CHECK ((((kind = 'line'::text) AND (side IS NOT NULL) AND (start_line IS NOT NULL) AND (end_line IS NOT NULL) AND (start_line > 0) AND (end_line > 0) AND ((start_side IS NOT NULL) OR (end_line >= start_line))) OR ((kind = 'file'::text) AND (start_line IS NULL) AND (end_line IS NULL) AND (side IS NULL) AND (start_side IS NULL)))),
    CONSTRAINT review_draft_comment_anchor_status_check CHECK (((anchor_status IS NULL) OR (anchor_status = ANY (ARRAY['moved'::text, 'orphaned'::text])))),
    CONSTRAINT review_draft_comment_kind_check CHECK ((kind = ANY (ARRAY['line'::text, 'file'::text]))),
    CONSTRAINT review_draft_comment_publish_claim_pair_check CHECK (((publish_claim IS NULL) = (publish_claimed_at IS NULL))),
    CONSTRAINT review_draft_comment_side_check CHECK ((side = ANY (ARRAY['old'::text, 'new'::text]))),
    CONSTRAINT review_draft_comment_start_side_check CHECK (((start_side IS NULL) OR ((start_side = ANY (ARRAY['old'::text, 'new'::text])) AND (start_side <> side)))),
    CONSTRAINT review_draft_comment_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text])))
);
--> statement-breakpoint
ALTER TABLE public.review_draft_comment ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.review_draft_comment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.review_group_reclassification (
    id bigint NOT NULL,
    installation_id bigint,
    review_session_id bigint NOT NULL,
    change_group_id text NOT NULL,
    category text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_group_reclassification_category_check CHECK ((category = ANY (ARRAY['bugfix'::text, 'logic-refactor'::text, 'move-with-edits'::text, 'lib-bump'::text, 'pure-move'::text, 'new-feature'::text, 'dependency-update'::text, 'schema-change'::text])))
);
--> statement-breakpoint
ALTER TABLE public.review_group_reclassification ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.review_group_reclassification_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.review_read_mark (
    id bigint NOT NULL,
    installation_id bigint,
    review_session_id bigint NOT NULL,
    chunk_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE public.review_read_mark ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.review_read_mark_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.review_session (
    id bigint NOT NULL,
    installation_id bigint,
    brief_id bigint NOT NULL,
    reviewer_id bigint NOT NULL,
    review_outcome text DEFAULT 'comment'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    carried_item_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT review_session_review_outcome_check CHECK ((review_outcome = ANY (ARRAY['comment'::text, 'approve'::text, 'request-changes'::text])))
);
--> statement-breakpoint
ALTER TABLE public.review_session ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.review_session_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.review_submitted_review (
    id bigint NOT NULL,
    installation_id bigint,
    review_session_id bigint NOT NULL,
    github_review_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE public.review_submitted_review ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.review_submitted_review_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.revision_narrative (
    id bigint NOT NULL,
    installation_id bigint,
    pull_request_id bigint NOT NULL,
    brief_id bigint NOT NULL,
    prev_head_sha text NOT NULL,
    head_sha text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    effort text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    body_version integer NOT NULL,
    unchanged boolean DEFAULT false NOT NULL,
    skipped boolean DEFAULT false NOT NULL,
    CONSTRAINT revision_narrative_body_check CHECK ((body IS JSON OBJECT))
);
--> statement-breakpoint
ALTER TABLE public.revision_narrative ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.revision_narrative_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.user_settings (
    gh_user_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    dismissed_version text
);
--> statement-breakpoint
CREATE TABLE public.webhook_delivery (
    signature_digest text NOT NULL,
    delivery_id text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT webhook_delivery_delivery_id_shape CHECK (((delivery_id IS NULL) OR (delivery_id ~ '^[A-Za-z0-9_-]{1,64}$'::text))),
    CONSTRAINT webhook_delivery_signature_digest_shape CHECK ((signature_digest ~ '^[0-9a-f]{64}$'::text))
);
--> statement-breakpoint
ALTER TABLE ONLY public.api_token
    ADD CONSTRAINT api_token_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.api_token
    ADD CONSTRAINT api_token_token_hash_unique UNIQUE (token_hash);
--> statement-breakpoint
ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_session_token_hash_unique UNIQUE (session_token_hash);
--> statement-breakpoint
ALTER TABLE ONLY public.brief
    ADD CONSTRAINT brief_natural_key UNIQUE NULLS NOT DISTINCT (installation_id, pull_request_id, base_sha, head_sha);
--> statement-breakpoint
ALTER TABLE ONLY public.brief
    ADD CONSTRAINT brief_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.checkpoint
    ADD CONSTRAINT checkpoint_natural_key UNIQUE NULLS NOT DISTINCT (installation_id, pull_request_id, reviewer_id);
--> statement-breakpoint
ALTER TABLE ONLY public.checkpoint
    ADD CONSTRAINT checkpoint_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.chunk_layout
    ADD CONSTRAINT chunk_layout_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.comparison_marks
    ADD CONSTRAINT comparison_marks_natural_key UNIQUE NULLS NOT DISTINCT (installation_id, pull_request_id, baseline_sha, head_sha);
--> statement-breakpoint
ALTER TABLE ONLY public.comparison_marks
    ADD CONSTRAINT comparison_marks_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.delta
    ADD CONSTRAINT delta_natural_key UNIQUE NULLS NOT DISTINCT (installation_id, pull_request_id, baseline_sha, head_sha);
--> statement-breakpoint
ALTER TABLE ONLY public.delta
    ADD CONSTRAINT delta_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.disposition
    ADD CONSTRAINT disposition_natural_key UNIQUE (review_session_id, file_path, attribute, region_start, region_end);
--> statement-breakpoint
ALTER TABLE ONLY public.disposition
    ADD CONSTRAINT disposition_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.generation_attempt
    ADD CONSTRAINT generation_attempt_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.generation_attempt
    ADD CONSTRAINT generation_attempt_run_id_key UNIQUE (run_id);
--> statement-breakpoint
ALTER TABLE ONLY public.generation
    ADD CONSTRAINT generation_natural_key UNIQUE NULLS NOT DISTINCT (installation_id, pull_request_id, kind, head_sha, baseline_sha);
--> statement-breakpoint
ALTER TABLE ONLY public.generation_part
    ADD CONSTRAINT generation_part_natural_key UNIQUE NULLS NOT DISTINCT (installation_id, pull_request_id, base_sha, head_sha, part_key);
--> statement-breakpoint
ALTER TABLE ONLY public.generation_part
    ADD CONSTRAINT generation_part_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.generation
    ADD CONSTRAINT generation_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.github_grant
    ADD CONSTRAINT github_grant_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.hunk_span
    ADD CONSTRAINT hunk_span_natural_key UNIQUE NULLS NOT DISTINCT (installation_id, pull_request_id, baseline_sha, head_sha);
--> statement-breakpoint
ALTER TABLE ONLY public.hunk_span
    ADD CONSTRAINT hunk_span_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.inbox_archive
    ADD CONSTRAINT inbox_archive_natural_key UNIQUE NULLS NOT DISTINCT (installation_id, pull_request_id, reviewer_id);
--> statement-breakpoint
ALTER TABLE ONLY public.inbox_archive
    ADD CONSTRAINT inbox_archive_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.instance_version
    ADD CONSTRAINT instance_version_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.pull_request
    ADD CONSTRAINT pull_request_natural_key UNIQUE (installation_id, repo_id, pr_number);
--> statement-breakpoint
ALTER TABLE ONLY public.pull_request
    ADD CONSTRAINT pull_request_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.review_draft_comment
    ADD CONSTRAINT review_draft_comment_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.review_group_reclassification
    ADD CONSTRAINT review_group_reclassification_natural_key UNIQUE (review_session_id, change_group_id);
--> statement-breakpoint
ALTER TABLE ONLY public.review_group_reclassification
    ADD CONSTRAINT review_group_reclassification_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.review_read_mark
    ADD CONSTRAINT review_read_mark_natural_key UNIQUE (review_session_id, chunk_id);
--> statement-breakpoint
ALTER TABLE ONLY public.review_read_mark
    ADD CONSTRAINT review_read_mark_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.review_session
    ADD CONSTRAINT review_session_natural_key UNIQUE NULLS NOT DISTINCT (installation_id, brief_id, reviewer_id);
--> statement-breakpoint
ALTER TABLE ONLY public.review_session
    ADD CONSTRAINT review_session_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.review_submitted_review
    ADD CONSTRAINT review_submitted_review_natural_key UNIQUE (review_session_id, github_review_id);
--> statement-breakpoint
ALTER TABLE ONLY public.review_submitted_review
    ADD CONSTRAINT review_submitted_review_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.revision_narrative
    ADD CONSTRAINT revision_narrative_natural_key UNIQUE NULLS NOT DISTINCT (installation_id, pull_request_id, prev_head_sha, head_sha);
--> statement-breakpoint
ALTER TABLE ONLY public.revision_narrative
    ADD CONSTRAINT revision_narrative_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (gh_user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.webhook_delivery
    ADD CONSTRAINT webhook_delivery_pkey PRIMARY KEY (signature_digest);
--> statement-breakpoint
CREATE INDEX api_token_grant_idx ON public.api_token USING btree (grant_id);
--> statement-breakpoint
CREATE INDEX api_token_user_idx ON public.api_token USING btree (user_id);
--> statement-breakpoint
CREATE INDEX audit_log_occurred_at_idx ON public.audit_log USING btree (occurred_at);
--> statement-breakpoint
CREATE INDEX auth_session_expires_at_idx ON public.auth_session USING btree (expires_at);
--> statement-breakpoint
CREATE INDEX auth_session_grant_idx ON public.auth_session USING btree (grant_id);
--> statement-breakpoint
CREATE UNIQUE INDEX brief_pull_request_head_index_key ON public.brief USING btree (pull_request_id, head_index);
--> statement-breakpoint
CREATE INDEX checkpoint_pull_request_idx ON public.checkpoint USING btree (pull_request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX chunk_layout_brief_id_key ON public.chunk_layout USING btree (brief_id);
--> statement-breakpoint
CREATE INDEX chunk_layout_pull_request_idx ON public.chunk_layout USING btree (pull_request_id);
--> statement-breakpoint
CREATE INDEX comparison_marks_pull_request_idx ON public.comparison_marks USING btree (pull_request_id);
--> statement-breakpoint
CREATE INDEX delta_pull_request_idx ON public.delta USING btree (pull_request_id);
--> statement-breakpoint
CREATE INDEX generation_attempt_started_at_idx ON public.generation_attempt USING btree (started_at);
--> statement-breakpoint
CREATE INDEX generation_part_pull_request_idx ON public.generation_part USING btree (pull_request_id);
--> statement-breakpoint
CREATE INDEX generation_pull_request_created_at_idx ON public.generation USING btree (pull_request_id, created_at);
--> statement-breakpoint
CREATE INDEX github_grant_user_idx ON public.github_grant USING btree (user_id);
--> statement-breakpoint
CREATE INDEX hunk_span_pull_request_idx ON public.hunk_span USING btree (pull_request_id);
--> statement-breakpoint
CREATE INDEX inbox_archive_pull_request_reviewer_idx ON public.inbox_archive USING btree (pull_request_id, reviewer_id);
--> statement-breakpoint
CREATE INDEX pull_request_closed_at_idx ON public.pull_request USING btree (closed_at) WHERE (closed_at IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX pull_request_owner_natural_key ON public.pull_request USING btree (owner_user_id, repo_id, pr_number) WHERE (installation_id IS NULL);
--> statement-breakpoint
CREATE INDEX pull_request_repo_idx ON public.pull_request USING btree (repo_id);
--> statement-breakpoint
CREATE INDEX review_draft_comment_carried_from_session_idx ON public.review_draft_comment USING btree (carried_from_session_id) WHERE (carried_from_session_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX review_draft_comment_session_idx ON public.review_draft_comment USING btree (review_session_id);
--> statement-breakpoint
CREATE INDEX review_session_brief_idx ON public.review_session USING btree (brief_id);
--> statement-breakpoint
CREATE INDEX review_session_reviewer_brief_idx ON public.review_session USING btree (reviewer_id, brief_id);
--> statement-breakpoint
CREATE INDEX revision_narrative_brief_idx ON public.revision_narrative USING btree (brief_id);
--> statement-breakpoint
CREATE INDEX revision_narrative_pull_request_idx ON public.revision_narrative USING btree (pull_request_id);
--> statement-breakpoint
CREATE INDEX webhook_delivery_received_at_idx ON public.webhook_delivery USING btree (received_at);
--> statement-breakpoint
ALTER TABLE ONLY public.api_token
    ADD CONSTRAINT api_token_grant_id_github_grant_id_fk FOREIGN KEY (grant_id) REFERENCES public.github_grant(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_grant_id_github_grant_id_fk FOREIGN KEY (grant_id) REFERENCES public.github_grant(id);
--> statement-breakpoint
ALTER TABLE ONLY public.brief
    ADD CONSTRAINT brief_pull_request_id_pull_request_id_fk FOREIGN KEY (pull_request_id) REFERENCES public.pull_request(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.checkpoint
    ADD CONSTRAINT checkpoint_pull_request_id_pull_request_id_fk FOREIGN KEY (pull_request_id) REFERENCES public.pull_request(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chunk_layout
    ADD CONSTRAINT chunk_layout_brief_id_brief_id_fk FOREIGN KEY (brief_id) REFERENCES public.brief(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chunk_layout
    ADD CONSTRAINT chunk_layout_pull_request_id_pull_request_id_fk FOREIGN KEY (pull_request_id) REFERENCES public.pull_request(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.comparison_marks
    ADD CONSTRAINT comparison_marks_pull_request_id_pull_request_id_fk FOREIGN KEY (pull_request_id) REFERENCES public.pull_request(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.delta
    ADD CONSTRAINT delta_pull_request_id_pull_request_id_fk FOREIGN KEY (pull_request_id) REFERENCES public.pull_request(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.disposition
    ADD CONSTRAINT disposition_review_session_id_review_session_id_fk FOREIGN KEY (review_session_id) REFERENCES public.review_session(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.generation_part
    ADD CONSTRAINT generation_part_pull_request_id_pull_request_id_fk FOREIGN KEY (pull_request_id) REFERENCES public.pull_request(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.generation
    ADD CONSTRAINT generation_pull_request_id_pull_request_id_fk FOREIGN KEY (pull_request_id) REFERENCES public.pull_request(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.hunk_span
    ADD CONSTRAINT hunk_span_pull_request_id_pull_request_id_fk FOREIGN KEY (pull_request_id) REFERENCES public.pull_request(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.inbox_archive
    ADD CONSTRAINT inbox_archive_pull_request_id_pull_request_id_fk FOREIGN KEY (pull_request_id) REFERENCES public.pull_request(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.review_draft_comment
    ADD CONSTRAINT review_draft_comment_carried_from_session_id_review_session_id_ FOREIGN KEY (carried_from_session_id) REFERENCES public.review_session(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.review_draft_comment
    ADD CONSTRAINT review_draft_comment_review_session_id_review_session_id_fk FOREIGN KEY (review_session_id) REFERENCES public.review_session(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.review_group_reclassification
    ADD CONSTRAINT review_group_reclassification_review_session_id_review_session_ FOREIGN KEY (review_session_id) REFERENCES public.review_session(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.review_read_mark
    ADD CONSTRAINT review_read_mark_review_session_id_review_session_id_fk FOREIGN KEY (review_session_id) REFERENCES public.review_session(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.review_session
    ADD CONSTRAINT review_session_brief_id_brief_id_fk FOREIGN KEY (brief_id) REFERENCES public.brief(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.review_submitted_review
    ADD CONSTRAINT review_submitted_review_review_session_id_review_session_id_fk FOREIGN KEY (review_session_id) REFERENCES public.review_session(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.revision_narrative
    ADD CONSTRAINT revision_narrative_brief_id_brief_id_fk FOREIGN KEY (brief_id) REFERENCES public.brief(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.revision_narrative
    ADD CONSTRAINT revision_narrative_pull_request_id_pull_request_id_fk FOREIGN KEY (pull_request_id) REFERENCES public.pull_request(id) ON DELETE CASCADE;