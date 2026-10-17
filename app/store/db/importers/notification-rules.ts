/**
 * Importer for `notification_rules` plus its two join tables (roadmap
 * 7-STORE slice 6).
 *
 * Flat collection: each stored document is a `NotificationRule` with no
 * envelope (`app/store/notification.ts` inserts rules directly, unlike
 * `audit.ts` or `backup.ts`). The `triggers: string[]` allow-list becomes
 * rows in `notification_rule_trigger`, one per trigger with `ordinal`
 * preserving array order; the `templates` map becomes rows in
 * `notification_rule_template`, one per `(triggerId, field)` pair.
 *
 * This importer does not attempt full validation — id casing, unknown-field
 * stripping, the defaults merge for a known rule id missing a field — because
 * `notification.createCollections()` always runs immediately after import (as
 * it does on every boot) and performs exactly that normalization pass,
 * rewriting whatever this importer wrote. It only has to produce
 * schema-valid rows and a trigger list free of duplicates, since the
 * `(rule_id, trigger_id)` primary key on the join table would otherwise
 * reject a legacy document that (pre-normalization) still had one.
 *
 * A missing scalar field falls back to the matching `DEFAULT_NOTIFICATION_RULES`
 * entry for a known id, or to the same default a fresh custom rule gets from
 * `notificationRuleSchema`, rather than to a single hardcoded guess — so an
 * old document missing `enabled` on a rule the catalog defaults to `false`
 * (`agent-disconnect`, for one) does not import as `true` only to have the
 * later normalization pass treat that guess as the operator's real setting.
 */

import { uniqStrings } from '../../../util/string-array.js';
import { DEFAULT_NOTIFICATION_RULES, NOTIFICATION_BELL_THRESHOLDS } from '../../notification.js';
import type { CollectionImporter, ImportContext } from '../import.js';
import type { LokiDocument } from '../loki-json.js';

const LEGACY_COLLECTION = 'notifications';
const TARGET_TABLE = 'notification_rules';

const DEFAULT_RULE_BY_ID = new Map(DEFAULT_NOTIFICATION_RULES.map((rule) => [rule.id, rule]));
const BELL_THRESHOLDS: readonly string[] = NOTIFICATION_BELL_THRESHOLDS;
const TEMPLATE_FIELDS = new Set(['simpleTitle', 'simpleBody', 'batchTitle']);

function resolveBellThreshold(doc: LokiDocument, fallback: string): string {
  return typeof doc.bellThreshold === 'string' && BELL_THRESHOLDS.includes(doc.bellThreshold)
    ? doc.bellThreshold
    : fallback;
}

export const notificationRulesImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insertRule = db.prepare(
      `INSERT INTO notification_rules (id, name, description, enabled, bell_enabled, bell_threshold)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertTrigger = db.prepare(
      'INSERT INTO notification_rule_trigger (rule_id, trigger_id, ordinal) VALUES (?, ?, ?)',
    );
    const insertTemplateField = db.prepare(
      'INSERT INTO notification_rule_template (rule_id, trigger_id, field, value) VALUES (?, ?, ?, ?)',
    );

    let rows = 0;
    for (const doc of snapshot.documents(LEGACY_COLLECTION)) {
      if (typeof doc.id !== 'string' || doc.id.trim() === '') {
        continue;
      }
      const id = doc.id.toLowerCase();
      const defaultForId = DEFAULT_RULE_BY_ID.get(id);

      const name = typeof doc.name === 'string' ? doc.name : (defaultForId?.name ?? id);
      const description =
        typeof doc.description === 'string' ? doc.description : (defaultForId?.description ?? '');
      const enabled =
        typeof doc.enabled === 'boolean' ? doc.enabled : (defaultForId?.enabled ?? true);
      const bellEnabled =
        typeof doc.bellEnabled === 'boolean'
          ? doc.bellEnabled
          : (defaultForId?.bellEnabled ?? false);
      const bellThreshold = resolveBellThreshold(doc, defaultForId?.bellThreshold ?? 'all');

      insertRule.run(id, name, description, enabled ? 1 : 0, bellEnabled ? 1 : 0, bellThreshold);

      const triggers = uniqStrings(doc.triggers, { trim: true, removeEmpty: true });
      triggers.forEach((triggerId, ordinal) => {
        insertTrigger.run(id, triggerId, ordinal);
      });

      if (doc.templates && typeof doc.templates === 'object' && !Array.isArray(doc.templates)) {
        for (const [triggerId, fields] of Object.entries(
          doc.templates as Record<string, unknown>,
        )) {
          if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
            continue;
          }
          for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
            if (TEMPLATE_FIELDS.has(field) && typeof value === 'string') {
              insertTemplateField.run(id, triggerId, field, value);
            }
          }
        }
      }

      rows += 1;
    }
    return rows;
  },
};
