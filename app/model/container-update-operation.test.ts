import {
  getDefaultTerminalContainerUpdateOperationPhase,
  isActiveContainerUpdateOperationPhaseForStatus,
  isActiveContainerUpdateOperationStatus,
  isContainerUpdateOperationPhase,
  isContainerUpdateOperationStatus,
  resolveTerminalContainerUpdateOperationPhase,
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
    expect(isContainerUpdateOperationPhase('recovered-rollback')).toBe(true);
    expect(isContainerUpdateOperationPhase('rollback-deferred')).toBe(true);
    expect(isContainerUpdateOperationPhase('rollback-failed')).toBe(true);
    expect(isContainerUpdateOperationPhase('unknown')).toBe(false);
    expect(isContainerUpdateOperationPhase(123)).toBe(false);
    expect(isContainerUpdateOperationPhase(undefined)).toBe(false);
  });

  test('distinguishes active statuses and status-compatible active phases', () => {
    expect(isActiveContainerUpdateOperationStatus('queued')).toBe(true);
    expect(isActiveContainerUpdateOperationStatus('rolled-back')).toBe(false);
    expect(isActiveContainerUpdateOperationPhaseForStatus('queued', 'queued')).toBe(true);
    expect(isActiveContainerUpdateOperationPhaseForStatus('queued', 'pulling')).toBe(false);
    expect(isActiveContainerUpdateOperationPhaseForStatus('in-progress', 'pulling')).toBe(true);
    expect(isActiveContainerUpdateOperationPhaseForStatus('in-progress', 'rolled-back')).toBe(
      false,
    );
  });

  test('resolves invalid terminal phases back to the status default', () => {
    expect(getDefaultTerminalContainerUpdateOperationPhase('failed')).toBe('failed');
    expect(resolveTerminalContainerUpdateOperationPhase('failed', 'rolled-back')).toBe('failed');
    expect(resolveTerminalContainerUpdateOperationPhase('rolled-back', 'recovered-rollback')).toBe(
      'recovered-rollback',
    );
  });
});
