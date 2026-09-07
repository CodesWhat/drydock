/**
 * The collection importer registry.
 *
 * Order is the insertion order of this array, and it matters once tables
 * reference each other: an importer must run after the importers of every
 * table it points at. Slices 3 through 11 each add one entry here.
 */
import type { CollectionImporter } from '../import.js';
import { agentKeysImporter } from './agent-keys.js';
import { apiKeysImporter } from './api-keys.js';
import { appImporter } from './app.js';
import { approvalsImporter } from './approvals.js';
import { auditImporter } from './audit.js';
import { backupsImporter } from './backups.js';
import { containersImporter } from './containers.js';
import { nameBindingsImporter } from './name-bindings.js';
import { notificationHistoryImporter } from './notification-history.js';
import { notificationOutboxImporter } from './notification-outbox.js';
import { notificationRulesImporter } from './notification-rules.js';
import { secretsImporter } from './secrets.js';
import { settingsImporter } from './settings.js';
import { uiPreferencesImporter } from './ui-preferences.js';
import { updateLifecycleCacheImporter } from './update-lifecycle-cache.js';
import { updateOperationsImporter } from './update-operations.js';
import { updatePolicyRetentionCacheImporter } from './update-policy-retention-cache.js';

export const COLLECTION_IMPORTERS: readonly CollectionImporter[] = [
  appImporter,
  secretsImporter,
  settingsImporter,
  uiPreferencesImporter,
  // roadmap 7-STORE slice 4: agent-keys before name-bindings, since a binding
  // names the agent key that owns it.
  agentKeysImporter,
  nameBindingsImporter,
  apiKeysImporter,
  // roadmap 7-STORE slice 5: append-only tables, independent of each other
  // and of everything above.
  auditImporter,
  notificationHistoryImporter,
  notificationOutboxImporter,
  // roadmap 7-STORE slice 6: rules and the approval queue, independent of
  // each other and of everything above.
  notificationRulesImporter,
  approvalsImporter,
  // roadmap 7-STORE slice 7: the two caches. Both read the legacy
  // `containers` LokiJS collection directly rather than the containers
  // importer's output below, so ordering relative to it does not matter.
  updateLifecycleCacheImporter,
  updatePolicyRetentionCacheImporter,
  // roadmap 7-STORE slice 8: containers, independent of everything above.
  containersImporter,
  // roadmap 7-STORE slice 10: update operations. No foreign-key dependency on
  // the containers table (identity is recomputed from each operation's own
  // container snapshot), but ordered after it to read naturally alongside
  // the entity it tracks.
  updateOperationsImporter,
  // roadmap 7-STORE slice 10: backups, moved here (out of the slice 5 group
  // above) because its identity backfill queries the containers table this
  // import already wrote — it must run after containersImporter.
  backupsImporter,
];
