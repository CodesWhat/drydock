/**
 * The collection importer registry.
 *
 * Order is the insertion order of this array, and it matters once tables
 * reference each other: an importer must run after the importers of every
 * table it points at. Slices 3 through 11 each add one entry here.
 */
import type { CollectionImporter } from '../import.js';
import { appImporter } from './app.js';
import { secretsImporter } from './secrets.js';
import { settingsImporter } from './settings.js';
import { uiPreferencesImporter } from './ui-preferences.js';

export const COLLECTION_IMPORTERS: readonly CollectionImporter[] = [
  appImporter,
  secretsImporter,
  settingsImporter,
  uiPreferencesImporter,
];
