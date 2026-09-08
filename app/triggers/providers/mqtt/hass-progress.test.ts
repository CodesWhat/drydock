import {
  IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES,
  TERMINAL_CONTAINER_UPDATE_OPERATION_STATUSES,
} from '../../../model/container-update-operation.js';
import {
  buildHassUpdateState,
  getHassUpdateProgress,
  HASS_UPDATE_PERCENTAGE_BY_PHASE,
  HASS_UPDATE_STATE_KEY,
} from './hass-progress.js';

test('HASS_UPDATE_STATE_KEY is the payload key the hass value_template reads', () => {
  expect(HASS_UPDATE_STATE_KEY).toBe('update_state');
});

test('every in-progress phase, and queued, maps to a percentage', () => {
  for (const phase of ['queued', ...IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES]) {
    const percentage = HASS_UPDATE_PERCENTAGE_BY_PHASE[phase];
    expect(typeof percentage, `phase ${phase} has no percentage`).toBe('number');
    expect(percentage).toBeGreaterThanOrEqual(0);
    expect(percentage).toBeLessThanOrEqual(100);
  }
});

test('no terminal status name leaks into the phase ladder', () => {
  for (const status of TERMINAL_CONTAINER_UPDATE_OPERATION_STATUSES) {
    expect(HASS_UPDATE_PERCENTAGE_BY_PHASE[status]).toBeUndefined();
  }
});

test('the happy-path ladder increases monotonically', () => {
  const happyPath = [
    'queued',
    'pulling',
    'scanning',
    'sbom-generating',
    'prepare',
    'renamed',
    'new-created',
    'old-stopped',
    'new-started',
    'health-gate',
    'health-gate-passed',
  ];
  const percentages = happyPath.map((phase) => HASS_UPDATE_PERCENTAGE_BY_PHASE[phase]);
  expect(percentages).toStrictEqual([5, 10, 30, 35, 40, 50, 60, 70, 80, 85, 95]);
  for (let index = 1; index < percentages.length; index += 1) {
    expect(percentages[index]).toBeGreaterThan(percentages[index - 1]);
  }
});

test('rollback and portainer phases keep their documented positions', () => {
  expect(HASS_UPDATE_PERCENTAGE_BY_PHASE['rollback-started']).toBe(90);
  expect(HASS_UPDATE_PERCENTAGE_BY_PHASE['rollback-deferred']).toBe(90);
  expect(HASS_UPDATE_PERCENTAGE_BY_PHASE['portainer-target']).toBe(60);
  expect(HASS_UPDATE_PERCENTAGE_BY_PHASE['portainer-restore']).toBe(90);
});

test('getHassUpdateProgress reports the ladder percentage for an active phase', () => {
  expect(getHassUpdateProgress({ phase: 'pulling' })).toStrictEqual({
    in_progress: true,
    update_percentage: 10,
  });
  expect(getHassUpdateProgress({ phase: 'health-gate' })).toStrictEqual({
    in_progress: true,
    update_percentage: 85,
  });
});

test('getHassUpdateProgress falls back to an indeterminate spinner for an unmapped phase', () => {
  expect(getHassUpdateProgress({ phase: 'a-phase-added-later' })).toStrictEqual({
    in_progress: true,
    update_percentage: null,
  });
});

test('getHassUpdateProgress treats an active operation with no phase as indeterminate', () => {
  expect(getHassUpdateProgress({})).toStrictEqual({
    in_progress: true,
    update_percentage: null,
  });
});

test('getHassUpdateProgress reports idle when there is no active operation', () => {
  expect(getHassUpdateProgress(undefined)).toStrictEqual({
    in_progress: false,
    update_percentage: null,
  });
});

test('buildHassUpdateState carries the installed version alongside the progress fields', () => {
  expect(
    buildHassUpdateState({
      installedVersion: '1.25.0',
      progress: { in_progress: true, update_percentage: 40 },
    }),
  ).toStrictEqual({
    installed_version: '1.25.0',
    in_progress: true,
    update_percentage: 40,
  });
});

test('buildHassUpdateState omits installed_version when the container has no tag value', () => {
  const progress = { in_progress: false, update_percentage: null };
  for (const installedVersion of [undefined, '', 42, null]) {
    expect(buildHassUpdateState({ installedVersion, progress })).toStrictEqual(progress);
  }
});

test('buildHassUpdateState only emits keys home assistant accepts', () => {
  const allowedKeys = new Set([
    'installed_version',
    'latest_version',
    'title',
    'release_summary',
    'release_url',
    'entity_picture',
    'in_progress',
    'update_percentage',
  ]);
  const state = buildHassUpdateState({
    installedVersion: '1.0.0',
    progress: { in_progress: true, update_percentage: 5 },
  });
  for (const key of Object.keys(state)) {
    expect(allowedKeys.has(key), `key ${key} is not in the hass update schema`).toBe(true);
  }
});
