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
import { nameBindingsImporter } from './name-bindings.js';
import { notificationHistoryImporter } from './notification-history.js';
import { notificationOutboxImporter } from './notification-outbox.js';
import { notificationRulesImporter } from './notification-rules.js';
import { secretsImporter } from './secrets.js';
import { settingsImporter } from './settings.js';
import { uiPreferencesImporter } from './ui-preferences.js';

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
  backupsImporter,
  notificationHistoryImporter,
  notificationOutboxImporter,
  // roadmap 7-STORE slice 6: rules and the approval queue, independent of
  // each other and of everything above.
  notificationRulesImporter,
  approvalsImporter,
];
