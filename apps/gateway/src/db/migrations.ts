/**
 * Schema is written in portable SQL (TEXT/INTEGER, explicit FKs, no SQLite-only
 * types) so it maps 1:1 onto Postgres/Supabase. Timestamps are epoch millis.
 * Token amounts are TEXT decimal strings of 6-decimal base units (bigint-safe).
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
CREATE TABLE agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  address       TEXT NOT NULL UNIQUE,
  budget        TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE verification_policies (
  id            TEXT NOT NULL,
  version       INTEGER NOT NULL,
  name          TEXT NOT NULL,
  definition    TEXT NOT NULL,
  digest        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE TABLE services (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL,
  provider_name    TEXT NOT NULL,
  provider_address TEXT NOT NULL,
  endpoint         TEXT NOT NULL,
  mode             TEXT NOT NULL CHECK (mode IN ('sync','async')),
  price            TEXT NOT NULL,
  policy_id        TEXT NOT NULL,
  policy_version   INTEGER NOT NULL,
  capability       TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  FOREIGN KEY (policy_id, policy_version) REFERENCES verification_policies(id, version)
);

CREATE TABLE pacts (
  id               TEXT PRIMARY KEY,
  agent_id         TEXT NOT NULL REFERENCES agents(id),
  service_id       TEXT NOT NULL REFERENCES services(id),
  policy_id        TEXT NOT NULL,
  policy_version   INTEGER NOT NULL,
  request          TEXT NOT NULL,
  request_digest   TEXT NOT NULL,
  price            TEXT NOT NULL,
  max_amount       TEXT NOT NULL,
  rail             TEXT NOT NULL,
  state            TEXT NOT NULL,
  outcome          TEXT,
  challenge_id     TEXT,
  channel_id       TEXT UNIQUE,
  deadline_at      INTEGER NOT NULL,
  idempotency_key  TEXT NOT NULL,
  retry_of         TEXT REFERENCES pacts(id),
  scenario         TEXT,
  origin           TEXT NOT NULL DEFAULT 'api',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  authorized_at    INTEGER,
  completed_at     INTEGER,
  UNIQUE (agent_id, idempotency_key),
  FOREIGN KEY (policy_id, policy_version) REFERENCES verification_policies(id, version)
);
CREATE INDEX pacts_state_idx ON pacts(state);
CREATE INDEX pacts_created_idx ON pacts(created_at);

CREATE TABLE authorizations (
  pact_id          TEXT PRIMARY KEY REFERENCES pacts(id),
  channel_id       TEXT NOT NULL UNIQUE,
  descriptor       TEXT NOT NULL,
  payer            TEXT NOT NULL,
  deposit          TEXT NOT NULL,
  voucher_amount   TEXT NOT NULL,
  voucher_sig      TEXT NOT NULL,
  open_tx_hash     TEXT UNIQUE,
  challenge_id     TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

CREATE TABLE payment_events (
  id          TEXT PRIMARY KEY,
  pact_id     TEXT NOT NULL REFERENCES pacts(id),
  kind        TEXT NOT NULL,
  amount      TEXT,
  tx_hash     TEXT,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX payment_events_pact_idx ON payment_events(pact_id);

CREATE TABLE work_items (
  id                    TEXT PRIMARY KEY,
  pact_id               TEXT NOT NULL UNIQUE REFERENCES pacts(id),
  status                TEXT NOT NULL,
  provider_job_id       TEXT,
  dispatched_at         INTEGER NOT NULL,
  delivered_at          INTEGER,
  http_status           INTEGER,
  content_type          TEXT,
  body_text             TEXT,
  latency_ms            INTEGER,
  transport_error       TEXT,
  echoed_pact_id        TEXT,
  echoed_request_digest TEXT,
  claimed_result_digest TEXT,
  signature             TEXT,
  result_digest         TEXT,
  duplicate_deliveries  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX work_items_result_idx ON work_items(result_digest);

CREATE TABLE verification_runs (
  id              TEXT PRIMARY KEY,
  pact_id         TEXT NOT NULL UNIQUE REFERENCES pacts(id),
  policy_id       TEXT NOT NULL,
  policy_version  INTEGER NOT NULL,
  verdict         TEXT NOT NULL,
  checks          TEXT NOT NULL,
  reasons         TEXT NOT NULL,
  result_digest   TEXT,
  item_count      INTEGER,
  semantic        TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE settlements (
  id              TEXT PRIMARY KEY,
  pact_id         TEXT NOT NULL UNIQUE REFERENCES pacts(id),
  kind            TEXT NOT NULL CHECK (kind IN ('capture','refund')),
  capture_amount  TEXT NOT NULL,
  refund_amount   TEXT,
  status          TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed')),
  tx_hash         TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  confirmed_at    INTEGER
);

CREATE TABLE work_receipts (
  id              TEXT PRIMARY KEY,
  pact_id         TEXT NOT NULL UNIQUE REFERENCES pacts(id),
  body            TEXT NOT NULL,
  receipt_digest  TEXT NOT NULL,
  signature       TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE TABLE failures (
  id          TEXT PRIMARY KEY,
  pact_id     TEXT REFERENCES pacts(id),
  stage       TEXT NOT NULL,
  code        TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX failures_pact_idx ON failures(pact_id);

CREATE TABLE audit_events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  pact_id     TEXT,
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX audit_events_pact_idx ON audit_events(pact_id);

CREATE TABLE local_ledger (
  address     TEXT PRIMARY KEY,
  balance     TEXT NOT NULL
);

CREATE TABLE local_channels (
  channel_id  TEXT PRIMARY KEY,
  descriptor  TEXT NOT NULL,
  deposit     TEXT NOT NULL,
  settled     TEXT NOT NULL DEFAULT '0',
  closed      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`,
  },
  {
    id: 2,
    name: 'service_input_schema',
    sql: `ALTER TABLE services ADD COLUMN input_schema TEXT NOT NULL DEFAULT '{"type":"object"}';`,
  },
]
