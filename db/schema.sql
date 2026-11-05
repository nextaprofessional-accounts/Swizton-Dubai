-- Financial values are decimal strings in validated JSONB; never binary floats.
CREATE TABLE IF NOT EXISTS app_user (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('Admin','Finance','Management')), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- One organisation in MVP. All financial mutations acquire this row FOR UPDATE.
CREATE TABLE IF NOT EXISTS organisation (
 id integer PRIMARY KEY CHECK(id=1), name text NOT NULL, revision bigint NOT NULL DEFAULT 0
);
INSERT INTO organisation(id,name) VALUES(1,'NINETY EIGHT FAHRENHEIT MEDICAL SERVICES FZCO') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS master_data (
 organisation_id integer PRIMARY KEY REFERENCES organisation(id), data jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS financial_entry (
 id uuid PRIMARY KEY, organisation_id integer NOT NULL REFERENCES organisation(id),
 kind text NOT NULL CHECK(kind IN ('bill','receipt','estimate','expense','wallet','adjustment')),
 entry_date date NOT NULL, version text NOT NULL CHECK(version IN ('Actual','Approx')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 created_by uuid NOT NULL REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(payload->>'id'=id::text), CHECK(payload->>'kind'=kind),
 CHECK(payload->>'date'=entry_date::text), CHECK(payload->>'version'=version)
);
CREATE INDEX IF NOT EXISTS financial_entry_period ON financial_entry(organisation_id,entry_date,version,kind);
CREATE UNIQUE INDEX IF NOT EXISTS hospital_invoice_unique ON financial_entry(organisation_id,(payload->>'hospital'),(payload->>'invoice')) WHERE kind='bill';
CREATE TABLE IF NOT EXISTS month_close (
 organisation_id integer NOT NULL REFERENCES organisation(id), month char(7) NOT NULL CHECK(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 locked boolean NOT NULL, closed_by uuid NOT NULL REFERENCES app_user(id), closed_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL,
 PRIMARY KEY(organisation_id,month)
);
CREATE TABLE IF NOT EXISTS audit_event (
 sequence bigserial PRIMARY KEY, actor uuid NOT NULL REFERENCES app_user(id), action text NOT NULL,
 entity_id text NOT NULL, reason text NOT NULL, before_data jsonb, after_data jsonb, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Audit events are append-only'; END; $$;
DROP TRIGGER IF EXISTS audit_append_only ON audit_event;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
-- Deploy with a non-owner application role: grant SELECT/INSERT on audit_event, never UPDATE/DELETE/TRUNCATE.

CREATE TABLE IF NOT EXISTS workflow_item (
 id uuid PRIMARY KEY, organisation_id integer NOT NULL REFERENCES organisation(id),
 kind text NOT NULL CHECK(kind IN ('adjustment_request','import_batch','settlement','budget','workbook_review','doctor_payment','lead','forecast_snapshot','cash_plan','cash_movement')),
 payload jsonb NOT NULL, created_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(payload->>'id'=id::text), CHECK(payload->>'kind'=kind)
);
CREATE INDEX IF NOT EXISTS workflow_item_kind ON workflow_item(organisation_id,kind);

CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_casefold ON app_user(lower(email));

ALTER TABLE workflow_item DROP CONSTRAINT IF EXISTS workflow_item_kind_check;
ALTER TABLE workflow_item ADD CONSTRAINT workflow_item_kind_check CHECK(kind IN ('adjustment_request','import_batch','settlement','budget','workbook_review','doctor_payment','lead','forecast_snapshot','cash_plan','cash_movement'));

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
