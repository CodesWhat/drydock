/**
 * The v1.8 store schema (roadmap 7-STORE, slice 1).
 *
 * Two rules decide what is a column and what is JSON, per spec section 2.1:
 *
 * 1. A field becomes a column when the code queries, filters, sorts or
 *    individually patches it. Everything else lives inside a JSON TEXT column.
 * 2. Opaque blobs the store is documented never to inspect are TEXT holding
 *    JSON and are never indexed: `notification_outbox.payload`,
 *    `ui_preferences.preferences`,
 *    `update_policy_retention_cache.update_policy_overrides`,
 *    `update_operations.container_snapshot` and
 *    `update_operations.portainer_recovery`.
 *
 * Every table is STRICT. A type mistake becomes an error at write time instead
 * of a silently coerced value, which is exactly the class of bug the JSON store
 * could not catch at all.
 *
 * Booleans are INTEGER 0/1, timestamps are ISO-8601 TEXT except where the
 * current record already carries epoch milliseconds, which stay INTEGER.
 */

/**
 * Owned by the migration runner rather than by the initial migration, because
 * the runner has to read it before it knows whether the initial migration ran.
 */
export const SCHEMA_MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  note       TEXT
) STRICT;
`;

/** Key/value bookkeeping that is not schema versioning: the import marker lives here. */
const STORE_METADATA_SQL = `
CREATE TABLE store_metadata (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

const SINGLETON_TABLES_SQL = `
CREATE TABLE app_info (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  name    TEXT NOT NULL,
  version TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  internetless_mode INTEGER NOT NULL DEFAULT 0,
  update_mode       TEXT NOT NULL DEFAULT 'manual'
) STRICT;

CREATE TABLE secrets (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  session_secret TEXT
) STRICT;
`;

const CONTAINERS_SQL = `
CREATE TABLE containers (
  id                          TEXT PRIMARY KEY,
  identity_key                TEXT NOT NULL,
  name                        TEXT NOT NULL,
  display_name                TEXT NOT NULL,
  display_icon                TEXT,
  status                      TEXT NOT NULL,
  health                      TEXT,
  watcher                     TEXT NOT NULL,
  agent                       TEXT,
  update_available            INTEGER NOT NULL DEFAULT 0,
  update_kind                 TEXT,
  update_detected_at          TEXT,
  first_seen_at               TEXT,
  maturity_gate_pending_since TEXT,
  image_name                  TEXT NOT NULL,
  image_tag_value             TEXT NOT NULL,
  image_digest_value          TEXT,
  error_message               TEXT,
  security_state_hash         TEXT,
  image                       TEXT NOT NULL,
  result                      TEXT,
  update_kind_detail          TEXT,
  security                    TEXT,
  update_policy               TEXT,
  update_policy_declarative   TEXT,
  update_policy_overrides     TEXT,
  update_policy_sources       TEXT,
  update_rollback             TEXT,
  details                     TEXT,
  labels                      TEXT,
  link_config                 TEXT,
  tag_config                  TEXT,
  trigger_config              TEXT
) STRICT;

CREATE INDEX containers_identity_key ON containers(identity_key);
CREATE INDEX containers_watcher_status ON containers(watcher, status);
CREATE INDEX containers_update_available ON containers(update_available)
  WHERE update_available = 1;
CREATE INDEX containers_name ON containers(name);
`;

const UPDATE_OPERATIONS_SQL = `
CREATE TABLE update_operations (
  id                        TEXT PRIMARY KEY,
  container_identity_key    TEXT,
  container_id              TEXT,
  container_name            TEXT NOT NULL,
  new_container_id          TEXT,
  old_container_id          TEXT,
  old_name                  TEXT,
  temp_name                 TEXT,
  status                    TEXT NOT NULL,
  phase                     TEXT NOT NULL,
  kind                      TEXT,
  batch_id                  TEXT,
  queue_position            INTEGER,
  queue_total               INTEGER,
  trigger_name              TEXT,
  agent                     TEXT,
  watcher                   TEXT,
  from_version              TEXT,
  to_version                TEXT,
  target_image              TEXT,
  rollback_reason           TEXT,
  last_error                TEXT,
  skipped_dependency_reason TEXT,
  blocking_container_id     TEXT,
  blocking_operation_id     TEXT,
  cancel_requested          INTEGER NOT NULL DEFAULT 0,
  old_container_was_running INTEGER,
  old_container_stopped     INTEGER,
  helper_lifecycle_owner    TEXT,
  finalize_secret_hash      TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  completed_at              TEXT,
  recovered_at              TEXT,
  container_snapshot        TEXT,
  portainer_recovery        TEXT
) STRICT;

CREATE INDEX update_operations_identity_status
  ON update_operations(container_identity_key, status);
CREATE INDEX update_operations_container_id ON update_operations(container_id);
CREATE INDEX update_operations_batch_id ON update_operations(batch_id);
CREATE INDEX update_operations_status_updated_at ON update_operations(status, updated_at);
`;

const HISTORY_TABLES_SQL = `
CREATE TABLE audit (
  id                     TEXT PRIMARY KEY,
  timestamp              TEXT NOT NULL,
  timestamp_ms           INTEGER NOT NULL,
  action                 TEXT NOT NULL,
  container_name         TEXT NOT NULL,
  container_identity_key TEXT,
  container_image        TEXT,
  from_version           TEXT,
  to_version             TEXT,
  update_kind            TEXT,
  semver_diff            TEXT,
  trigger_name           TEXT,
  status                 TEXT NOT NULL,
  details                TEXT
) STRICT;

CREATE INDEX audit_timestamp ON audit(timestamp_ms DESC);
CREATE INDEX audit_action_timestamp ON audit(action, timestamp_ms DESC);

CREATE TABLE backups (
  id                     TEXT PRIMARY KEY,
  container_identity_key TEXT,
  container_name         TEXT NOT NULL,
  container_id           TEXT,
  image_name             TEXT NOT NULL,
  image_tag              TEXT NOT NULL,
  image_digest           TEXT,
  timestamp              TEXT NOT NULL,
  trigger_name           TEXT NOT NULL
) STRICT;

CREATE INDEX backups_identity_time ON backups(container_identity_key, timestamp DESC);
`;

const APPROVALS_SQL = `
CREATE TABLE approvals (
  id                     TEXT PRIMARY KEY,
  schema_version         INTEGER NOT NULL,
  container_id           TEXT NOT NULL,
  container_identity_key TEXT NOT NULL,
  container_name         TEXT NOT NULL,
  watcher                TEXT NOT NULL,
  agent                  TEXT,
  image                  TEXT NOT NULL,
  from_ref               TEXT NOT NULL,
  to_ref                 TEXT NOT NULL,
  candidate_ref          TEXT NOT NULL,
  update_kind            TEXT NOT NULL,
  semver_diff            TEXT NOT NULL,
  release_notes_url      TEXT,
  scan_critical          INTEGER,
  scan_high              INTEGER,
  scan_medium            INTEGER,
  scan_low               INTEGER,
  scan_unknown           INTEGER,
  scan_at                TEXT,
  created_at             TEXT NOT NULL,
  created_at_ms          INTEGER NOT NULL,
  decision               TEXT NOT NULL,
  decided_at             TEXT,
  decided_by             TEXT,
  decision_note          TEXT,
  deferred_until         TEXT,
  operation_id           TEXT,
  outcome                TEXT,
  resolved_at            TEXT,
  resolution             TEXT,
  UNIQUE (container_id, candidate_ref)
) STRICT;

CREATE INDEX approvals_decision_created_at ON approvals(decision, created_at_ms);
`;

const CREDENTIAL_TABLES_SQL = `
CREATE TABLE api_keys (
  key_id         TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  name           TEXT NOT NULL,
  secret_hash    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  parent_key_id  TEXT,
  expires_at     TEXT,
  rate_limit_max INTEGER,
  last_used_at   TEXT,
  revoked_at     TEXT,
  revoked_by     TEXT
) STRICT;

CREATE INDEX api_keys_parent_key_id ON api_keys(parent_key_id);

CREATE TABLE api_key_scope (
  key_id TEXT NOT NULL REFERENCES api_keys(key_id) ON DELETE CASCADE,
  scope  TEXT NOT NULL,
  PRIMARY KEY (key_id, scope)
) STRICT;

CREATE INDEX api_key_scope_scope ON api_key_scope(scope);

CREATE TABLE agent_keys (
  key_id     TEXT PRIMARY KEY,
  pubkey     TEXT NOT NULL,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE name_bindings (
  agent_name   TEXT PRIMARY KEY,
  key_id       TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL
) STRICT;

CREATE INDEX name_bindings_key_id ON name_bindings(key_id);
`;

const NOTIFICATION_TABLES_SQL = `
CREATE TABLE notification_rules (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 0,
  bell_enabled   INTEGER NOT NULL DEFAULT 0,
  bell_threshold TEXT NOT NULL
) STRICT;

CREATE TABLE notification_rule_trigger (
  rule_id    TEXT NOT NULL REFERENCES notification_rules(id) ON DELETE CASCADE,
  trigger_id TEXT NOT NULL,
  ordinal    INTEGER NOT NULL,
  PRIMARY KEY (rule_id, trigger_id)
) STRICT;

CREATE INDEX notification_rule_trigger_trigger_id ON notification_rule_trigger(trigger_id);

CREATE TABLE notification_rule_template (
  rule_id    TEXT NOT NULL REFERENCES notification_rules(id) ON DELETE CASCADE,
  trigger_id TEXT NOT NULL,
  field      TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (rule_id, trigger_id, field)
) STRICT;

CREATE TABLE notification_history (
  key                    TEXT PRIMARY KEY,
  trigger_id             TEXT NOT NULL,
  container_identity_key TEXT NOT NULL,
  event_kind             TEXT NOT NULL,
  result_hash            TEXT NOT NULL,
  notified_at            TEXT NOT NULL
) STRICT;

CREATE INDEX notification_history_trigger_id ON notification_history(trigger_id);
CREATE INDEX notification_history_identity_key
  ON notification_history(container_identity_key);

CREATE TABLE notification_outbox (
  id              TEXT PRIMARY KEY,
  event_name      TEXT NOT NULL,
  trigger_id      TEXT NOT NULL,
  container_id    TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL,
  next_attempt_at TEXT NOT NULL,
  status          TEXT NOT NULL,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  delivered_at    TEXT,
  failed_at       TEXT,
  payload         TEXT NOT NULL
) STRICT;

CREATE INDEX notification_outbox_status_next_attempt
  ON notification_outbox(status, next_attempt_at);
CREATE INDEX notification_outbox_trigger_id ON notification_outbox(trigger_id);
CREATE INDEX notification_outbox_delivered_at ON notification_outbox(delivered_at);
CREATE INDEX notification_outbox_failed_at ON notification_outbox(failed_at);
`;

const CACHE_AND_SESSION_TABLES_SQL = `
CREATE TABLE ui_preferences (
  username       TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  preferences    TEXT NOT NULL,
  updated_at     TEXT NOT NULL
) STRICT;

CREATE TABLE update_lifecycle_cache (
  cache_key                   TEXT PRIMARY KEY,
  update_detected_at          TEXT NOT NULL,
  first_seen_at               TEXT,
  maturity_gate_pending_since TEXT,
  result_signature            TEXT NOT NULL,
  expires_at                  INTEGER NOT NULL
) STRICT;

CREATE INDEX update_lifecycle_cache_expires_at ON update_lifecycle_cache(expires_at);

CREATE TABLE update_policy_retention_cache (
  cache_key               TEXT PRIMARY KEY,
  update_policy_overrides TEXT,
  expires_at              INTEGER NOT NULL
) STRICT;

CREATE INDEX update_policy_retention_cache_expires_at
  ON update_policy_retention_cache(expires_at);

CREATE TABLE sessions (
  sid        TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  data       TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_expires ON sessions(expires_at);
`;

/** Everything the initial migration creates, `schema_migrations` excepted. */
export const INITIAL_SCHEMA_SQL = [
  STORE_METADATA_SQL,
  SINGLETON_TABLES_SQL,
  CONTAINERS_SQL,
  UPDATE_OPERATIONS_SQL,
  HISTORY_TABLES_SQL,
  APPROVALS_SQL,
  CREDENTIAL_TABLES_SQL,
  NOTIFICATION_TABLES_SQL,
  CACHE_AND_SESSION_TABLES_SQL,
].join('\n');

/** Every table the initial migration creates, in no particular order. */
export const INITIAL_SCHEMA_TABLES: readonly string[] = [
  'agent_keys',
  'api_key_scope',
  'api_keys',
  'app_info',
  'approvals',
  'audit',
  'backups',
  'containers',
  'name_bindings',
  'notification_history',
  'notification_outbox',
  'notification_rule_template',
  'notification_rule_trigger',
  'notification_rules',
  'secrets',
  'sessions',
  'settings',
  'store_metadata',
  'ui_preferences',
  'update_lifecycle_cache',
  'update_operations',
  'update_policy_retention_cache',
];
