import {
  isContainerUpdateOperationPhase,
  isContainerUpdateOperationStatus,
} from './container-update-operation.js';

describe('container update operation guards', () => {
  test('accepts known statuses and rejects non-status values', () => {
    expect(isContainerUpdateOperationStatus('in-progress')).toBe(true);
    expect(isContainerUpdateOperationStatus('failed')).toBe(true);
    expect(isContainerUpdateOperationStatus('unknown')).toBe(false);
    expect(isContainerUpdateOperationStatus(123)).toBe(false);
    expect(isContainerUpdateOperationStatus(undefined)).toBe(false);
  });

  test('accepts known phases and rejects non-phase values', () => {
    expect(isContainerUpdateOperationPhase('pulling')).toBe(true);
    expect(isContainerUpdateOperationPhase('rollback-deferred')).toBe(true);
    expect(isContainerUpdateOperationPhase('rollback-failed')).toBe(true);
    expect(isContainerUpdateOperationPhase('unknown')).toBe(false);
    expect(isContainerUpdateOperationPhase(123)).toBe(false);
    expect(isContainerUpdateOperationPhase(undefined)).toBe(false);
  });
});
