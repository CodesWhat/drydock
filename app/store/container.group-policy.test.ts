import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyDeclarativeUpdatePolicy,
  applyUpdatePolicyOverrides,
} from '../model/update-policy.js';
import { createContainerFixture } from '../test/helpers.js';
import { openDatabase } from './db/driver.js';

vi.mock('../event');

const GOLDEN_ENV_KEYS = ['DD_STORE_PATH', 'DD_STORE_FILE', 'DD_VERSION'] as const;
const GOLDEN_FIXTURE_PATH = path.resolve(__dirname, './fixtures/dd-v1.7.json');
const GOLDEN_NOW = new Date('2026-10-01T12:00:00.000Z');

/**
 * Every `containers` column that existed before group policies (migrations 1-6). The
 * golden below was captured from these columns on the code as it stood before the group
 * layer was added, so it pins what a store with zero group policies writes.
 */
const PRE_GROUP_POLICY_CONTAINER_COLUMNS = [
  'id',
  'identity_key',
  'name',
  'display_name',
  'display_icon',
  'status',
  'health',
  'watcher',
  'agent',
  'update_available',
  'update_kind',
  'update_detected_at',
  'first_seen_at',
  'maturity_gate_pending_since',
  'image_name',
  'image_tag_value',
  'image_digest_value',
  'error_message',
  'security_state_hash',
  'image',
  'result',
  'update_kind_detail',
  'security',
  'update_policy',
  'update_policy_declarative',
  'update_policy_overrides',
  'update_policy_sources',
  'update_rollback',
  'details',
  'labels',
  'link_config',
  'tag_config',
  'trigger_config',
  'source_repo',
  'current_release_notes',
];

describe('zero group policies (golden)', () => {
  test('a v1.7 import and a representative write sequence store exactly the pre-group-policy rows', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-group-policy-golden-'));
    const previousEnv = Object.fromEntries(GOLDEN_ENV_KEYS.map((key) => [key, process.env[key]]));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(GOLDEN_NOW);

    try {
      process.env.DD_STORE_PATH = tempDir;
      process.env.DD_STORE_FILE = 'dd.json';
      process.env.DD_VERSION = '1.8.0';
      fs.copyFileSync(GOLDEN_FIXTURE_PATH, path.join(tempDir, 'dd.json'));
      vi.resetModules();

      const store = await import('./index.js');
      const container = await import('./container.js');
      await store.init();

      // A legacy record (flat updatePolicy, no declarative layer) written back unchanged.
      container.updateContainer(container.getContainerRaw('container-full-app'));

      // A label-only patch that moves a container into a group no policy names.
      container.updateContainerFields('container-cache-web', {
        status: 'exited',
        labels: { 'dd.group': 'payments' },
      });

      // A watcher insert in a Compose project, with env and label layers.
      const composeMember = createContainerFixture({
        id: 'golden-compose-one',
        name: 'golden-compose',
        watcher: 'local',
        labels: { 'com.docker.compose.project': 'payments' },
      });
      applyDeclarativeUpdatePolicy(composeMember as never, {
        env: { maturityMode: 'mature' },
        label: { skipTags: ['9.9.9'] },
      });
      container.insertContainer(composeMember);

      // An override written the way the update-policy PATCH handler writes one.
      const overridden = container.getContainerRaw('golden-compose-one');
      applyUpdatePolicyOverrides(overridden as never, { maturityMinAgeDays: 3 });
      container.updateContainer(overridden, { authoritativeEmptyOverrides: true });

      // A recreate: the override is stashed and restored onto the new id.
      container.deleteContainer('golden-compose-one', { replacementExpected: true });
      const recreated = createContainerFixture({
        id: 'golden-compose-two',
        name: 'golden-compose',
        watcher: 'local',
        labels: { 'com.docker.compose.project': 'payments' },
      });
      applyDeclarativeUpdatePolicy(recreated as never, {
        env: { maturityMode: 'mature' },
        label: { skipTags: ['9.9.9'] },
      });
      container.insertContainer(recreated);

      // An agent-owned insert, normalized the way agent inventory normalizes one.
      const agentOwned = createContainerFixture({
        id: 'golden-agent',
        name: 'golden-agent',
        watcher: 'local',
        agent: 'edge-one',
        labels: { 'dd.group': 'payments' },
      });
      applyUpdatePolicyOverrides(agentOwned as never, {});
      container.insertContainer(agentOwned);

      await store.save();
      const database = openDatabase(path.join(tempDir, 'dd.sqlite'), { readOnly: true });
      try {
        const rows = database
          .prepare(
            `SELECT ${PRE_GROUP_POLICY_CONTAINER_COLUMNS.join(', ')} FROM containers ORDER BY id`,
          )
          .all();
        expect(rows).toMatchInlineSnapshot(`
          [
            {
              "agent": null,
              "current_release_notes": null,
              "details": null,
              "display_icon": "mdi:docker",
              "display_name": "cache-web",
              "error_message": null,
              "first_seen_at": null,
              "health": null,
              "id": "container-cache-web",
              "identity_key": "::local::cache-web",
              "image": "{"id":"image-id-cache-web","registry":{"name":"hub","url":"https://registry-fixture.test"},"name":"library/web","tag":{"value":"one","semver":false,"tagPrecision":"floating"},"digest":{"watch":false},"architecture":"amd64","os":"linux"}",
              "image_digest_value": null,
              "image_name": "library/web",
              "image_tag_value": "one",
              "labels": "{"dd.group":"payments"}",
              "link_config": "{}",
              "maturity_gate_pending_since": null,
              "name": "cache-web",
              "result": "{"tag":"one"}",
              "security": null,
              "security_state_hash": "2b3909dbc97b1747d572c243b149e763dad0122482935e6f1e4a0ce09d06112d",
              "source_repo": null,
              "status": "exited",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": null,
              "update_kind": "unknown",
              "update_kind_detail": "{"kind":"unknown","semverDiff":"unknown"}",
              "update_policy": null,
              "update_policy_declarative": null,
              "update_policy_overrides": null,
              "update_policy_sources": null,
              "update_rollback": null,
              "watcher": "local",
            },
            {
              "agent": "edge-one",
              "current_release_notes": null,
              "details": "{"ports":["8080/tcp"],"volumes":["/data"],"env":[{"key":"NODE_ENV","value":"production"}]}",
              "display_icon": "mdi:docker",
              "display_name": "Full App",
              "error_message": null,
              "first_seen_at": "2026-10-01T12:00:00.000Z",
              "health": "healthy",
              "id": "container-full-app",
              "identity_key": "edge-one::local::full-app",
              "image": "{"id":"image-id-full-app","registry":{"name":"hub","url":"https://registry-fixture.test"},"name":"library/full-app","tag":{"value":"1.0.0","semver":true,"tagPrecision":"specific"},"digest":{"watch":true,"value":"digest-placeholder-full-app-one","repo":"library/full-app"},"architecture":"amd64","os":"linux"}",
              "image_digest_value": "digest-placeholder-full-app-one",
              "image_name": "library/full-app",
              "image_tag_value": "1.0.0",
              "labels": "{"dd.watch":"true"}",
              "link_config": "{"link":"https://links-fixture.test/full-app","linkTemplate":"https://links-fixture.test/full-app","portLabel":"8080"}",
              "maturity_gate_pending_since": "2026-10-01T12:00:00.000Z",
              "name": "full-app",
              "result": "{"tag":"1.1.0","digest":"digest-placeholder-full-app-two","created":"2026-01-11T00:00:00.000Z","link":"https://links-fixture.test/full-app"}",
              "security": "{"scan":{"scanner":"trivy","image":"library/full-app:1.0.0","scannedAt":"2026-01-08T00:00:00.000Z","status":"passed","blockSeverities":["CRITICAL"],"blockingCount":0,"summary":{"unknown":0,"low":1,"medium":0,"high":0,"critical":0},"vulnerabilities":[]}}",
              "security_state_hash": "9889fead21e54a412d07842a172ab21335ae966f3daf0ccf31dd81adb391f6b7",
              "source_repo": "library/full-app-source",
              "status": "running",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": "2026-10-01T12:00:00.000Z",
              "update_kind": "tag",
              "update_kind_detail": "{"kind":"tag","localValue":"1.0.0","remoteValue":"1.1.0","semverDiff":"minor"}",
              "update_policy": "{"maturityMode":"mature","maturityMinAgeDays":3}",
              "update_policy_declarative": null,
              "update_policy_overrides": null,
              "update_policy_sources": null,
              "update_rollback": null,
              "watcher": "local",
            },
            {
              "agent": null,
              "current_release_notes": null,
              "details": null,
              "display_icon": "mdi:docker",
              "display_name": "shared-svc",
              "error_message": null,
              "first_seen_at": null,
              "health": null,
              "id": "container-shared-svc-a",
              "identity_key": "::watcher-a::shared-svc",
              "image": "{"id":"image-id-shared-svc-a","registry":{"name":"hub","url":"https://registry-fixture.test"},"name":"library/shared","tag":{"value":"one","semver":false,"tagPrecision":"floating"},"digest":{"watch":false},"architecture":"amd64","os":"linux"}",
              "image_digest_value": null,
              "image_name": "library/shared",
              "image_tag_value": "one",
              "labels": null,
              "link_config": "{}",
              "maturity_gate_pending_since": null,
              "name": "shared-svc",
              "result": "{"tag":"one"}",
              "security": null,
              "security_state_hash": "2b3909dbc97b1747d572c243b149e763dad0122482935e6f1e4a0ce09d06112d",
              "source_repo": null,
              "status": "unknown",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": null,
              "update_kind": "unknown",
              "update_kind_detail": "{"kind":"unknown","semverDiff":"unknown"}",
              "update_policy": null,
              "update_policy_declarative": null,
              "update_policy_overrides": null,
              "update_policy_sources": null,
              "update_rollback": null,
              "watcher": "watcher-a",
            },
            {
              "agent": null,
              "current_release_notes": null,
              "details": null,
              "display_icon": "mdi:docker",
              "display_name": "shared-svc",
              "error_message": null,
              "first_seen_at": null,
              "health": null,
              "id": "container-shared-svc-b",
              "identity_key": "::watcher-b::shared-svc",
              "image": "{"id":"image-id-shared-svc-b","registry":{"name":"hub","url":"https://registry-fixture.test"},"name":"library/shared","tag":{"value":"one","semver":false,"tagPrecision":"floating"},"digest":{"watch":false},"architecture":"amd64","os":"linux"}",
              "image_digest_value": null,
              "image_name": "library/shared",
              "image_tag_value": "one",
              "labels": null,
              "link_config": "{}",
              "maturity_gate_pending_since": null,
              "name": "shared-svc",
              "result": "{"tag":"one"}",
              "security": null,
              "security_state_hash": "2b3909dbc97b1747d572c243b149e763dad0122482935e6f1e4a0ce09d06112d",
              "source_repo": null,
              "status": "unknown",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": null,
              "update_kind": "unknown",
              "update_kind_detail": "{"kind":"unknown","semverDiff":"unknown"}",
              "update_policy": null,
              "update_policy_declarative": null,
              "update_policy_overrides": null,
              "update_policy_sources": null,
              "update_rollback": null,
              "watcher": "watcher-b",
            },
            {
              "agent": "edge-one",
              "current_release_notes": null,
              "details": null,
              "display_icon": "mdi:docker",
              "display_name": "golden-agent",
              "error_message": null,
              "first_seen_at": null,
              "health": null,
              "id": "golden-agent",
              "identity_key": "edge-one::local::golden-agent",
              "image": "{"id":"image-123456789","registry":{"name":"registry","url":"https://hub"},"name":"organization/image","tag":{"value":"version","semver":false},"digest":{"watch":false},"architecture":"arch","os":"os","created":"2021-06-12T05:33:38.440Z"}",
              "image_digest_value": null,
              "image_name": "organization/image",
              "image_tag_value": "version",
              "labels": "{"dd.group":"payments"}",
              "link_config": "{}",
              "maturity_gate_pending_since": null,
              "name": "golden-agent",
              "result": "{"tag":"version"}",
              "security": null,
              "security_state_hash": "2b3909dbc97b1747d572c243b149e763dad0122482935e6f1e4a0ce09d06112d",
              "source_repo": null,
              "status": "unknown",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": null,
              "update_kind": "unknown",
              "update_kind_detail": "{"kind":"unknown","semverDiff":"unknown"}",
              "update_policy": null,
              "update_policy_declarative": "{"env":{},"label":{}}",
              "update_policy_overrides": "{}",
              "update_policy_sources": "{}",
              "update_rollback": null,
              "watcher": "local",
            },
            {
              "agent": null,
              "current_release_notes": null,
              "details": null,
              "display_icon": "mdi:docker",
              "display_name": "golden-compose",
              "error_message": null,
              "first_seen_at": null,
              "health": null,
              "id": "golden-compose-two",
              "identity_key": "::local::golden-compose",
              "image": "{"id":"image-123456789","registry":{"name":"registry","url":"https://hub"},"name":"organization/image","tag":{"value":"version","semver":false},"digest":{"watch":false},"architecture":"arch","os":"os","created":"2021-06-12T05:33:38.440Z"}",
              "image_digest_value": null,
              "image_name": "organization/image",
              "image_tag_value": "version",
              "labels": "{"com.docker.compose.project":"payments"}",
              "link_config": "{}",
              "maturity_gate_pending_since": null,
              "name": "golden-compose",
              "result": "{"tag":"version"}",
              "security": null,
              "security_state_hash": "2b3909dbc97b1747d572c243b149e763dad0122482935e6f1e4a0ce09d06112d",
              "source_repo": null,
              "status": "unknown",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": null,
              "update_kind": "unknown",
              "update_kind_detail": "{"kind":"unknown","semverDiff":"unknown"}",
              "update_policy": "{"maturityMode":"mature","skipTags":["9.9.9"],"maturityMinAgeDays":3}",
              "update_policy_declarative": "{"env":{"maturityMode":"mature"},"label":{"skipTags":["9.9.9"]}}",
              "update_policy_overrides": "{"maturityMinAgeDays":3}",
              "update_policy_sources": "{"maturityMode":"env","skipTags":"label","maturityMinAgeDays":"override"}",
              "update_rollback": null,
              "watcher": "local",
            },
          ]
        `);
      } finally {
        database.close();
      }
    } finally {
      vi.useRealTimers();
      GOLDEN_ENV_KEYS.forEach((key) => {
        const value = previousEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      fs.rmSync(tempDir, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});
