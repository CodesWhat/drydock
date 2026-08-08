import {
  CONTAINER_UPDATE_OPERATION_PHASES,
  getDefaultTerminalContainerUpdateOperationPhase,
  IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES,
  isActiveContainerUpdateOperationPhase,
  isActiveContainerUpdateOperationPhaseForStatus,
  isActiveContainerUpdateOperationStatus,
  isContainerUpdateOperationKind,
  isContainerUpdateOperationPhase,
  isContainerUpdateOperationStatus,
  isExpiredContainerUpdateOperationPhase,
  isSkippedDependencyContainerUpdateOperationPhase,
  isTerminalContainerUpdateOperationPhase,
  isTerminalContainerUpdateOperationPhaseForStatus,
  isTerminalContainerUpdateOperationStatus,
  resolveTerminalContainerUpdateOperationPhase,
} from './container-update-operation.js';

describe('container update operation guards', () => {
  test('signature-verifying is not in CONTAINER_UPDATE_OPERATION_PHASES', () => {
    expect(
      (CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes('signature-verifying'),
    ).toBe(false);
  });

  test('signature-verifying is not in IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES', () => {
    expect(
      (IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(
        'signature-verifying',
      ),
    ).toBe(false);
  });

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

  test('accepts known kinds, active phases, and terminal statuses', () => {
    expect(isContainerUpdateOperationKind('container-update')).toBe(true);
    expect(isContainerUpdateOperationKind('unknown')).toBe(false);
    expect(isTerminalContainerUpdateOperationStatus('failed')).toBe(true);
    expect(isTerminalContainerUpdateOperationStatus('queued')).toBe(false);
    expect(isActiveContainerUpdateOperationPhase('pulling')).toBe(true);
    expect(isActiveContainerUpdateOperationPhase('succeeded')).toBe(false);
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
    expect(getDefaultTerminalContainerUpdateOperationPhase('succeeded')).toBe('succeeded');
    expect(getDefaultTerminalContainerUpdateOperationPhase('failed')).toBe('failed');
    expect(resolveTerminalContainerUpdateOperationPhase('failed', 'rolled-back')).toBe('failed');
    expect(resolveTerminalContainerUpdateOperationPhase('rolled-back', 'recovered-rollback')).toBe(
      'recovered-rollback',
    );
  });

  test('asserts on impossible active-status switch fallthroughs', () => {
    expect(() =>
      isActiveContainerUpdateOperationPhaseForStatus('invalid' as never, 'queued'),
    ).toThrow('Unexpected container update operation state');
  });

  test('asserts on impossible terminal-status switch fallthroughs', () => {
    expect(() =>
      isTerminalContainerUpdateOperationPhaseForStatus('invalid' as never, 'failed'),
    ).toThrow('Unexpected container update operation state');
    expect(() => getDefaultTerminalContainerUpdateOperationPhase('invalid' as never)).toThrow(
      'Unexpected container update operation state',
    );
  });

  test('isExpiredContainerUpdateOperationPhase identifies expired phases', () => {
    expect(isExpiredContainerUpdateOperationPhase('expired')).toBe(true);
    expect(isExpiredContainerUpdateOperationPhase('failed')).toBe(false);
    expect(isExpiredContainerUpdateOperationPhase('queued')).toBe(false);
    expect(isExpiredContainerUpdateOperationPhase(123)).toBe(false);
    expect(isExpiredContainerUpdateOperationPhase(undefined)).toBe(false);
  });

  test('isTerminalContainerUpdateOperationPhase accepts expired', () => {
    expect(isTerminalContainerUpdateOperationPhase('expired')).toBe(true);
  });

  test('isTerminalContainerUpdateOperationPhaseForStatus handles expired status', () => {
    expect(isTerminalContainerUpdateOperationPhaseForStatus('expired', 'expired')).toBe(true);
    expect(isTerminalContainerUpdateOperationPhaseForStatus('expired', 'failed')).toBe(false);
  });

  test('getDefaultTerminalContainerUpdateOperationPhase returns expired for expired status', () => {
    expect(getDefaultTerminalContainerUpdateOperationPhase('expired')).toBe('expired');
  });

  test('resolveTerminalContainerUpdateOperationPhase handles expired status', () => {
    expect(resolveTerminalContainerUpdateOperationPhase('expired', undefined)).toBe('expired');
    expect(resolveTerminalContainerUpdateOperationPhase('expired', 'expired')).toBe('expired');
  });

  test('CONTAINER_UPDATE_OPERATION_PHASES includes expired', () => {
    expect((CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes('expired')).toBe(true);
  });

  test('isContainerUpdateOperationStatus accepts expired', () => {
    expect(isContainerUpdateOperationStatus('expired')).toBe(true);
  });

  test('isTerminalContainerUpdateOperationStatus accepts expired', () => {
    expect(isTerminalContainerUpdateOperationStatus('expired')).toBe(true);
  });

  test('isSkippedDependencyContainerUpdateOperationPhase identifies skipped-dependency phases', () => {
    expect(isSkippedDependencyContainerUpdateOperationPhase('skipped-dependency')).toBe(true);
    expect(isSkippedDependencyContainerUpdateOperationPhase('failed')).toBe(false);
    expect(isSkippedDependencyContainerUpdateOperationPhase('queued')).toBe(false);
    expect(isSkippedDependencyContainerUpdateOperationPhase(123)).toBe(false);
    expect(isSkippedDependencyContainerUpdateOperationPhase(undefined)).toBe(false);
  });

  test('isTerminalContainerUpdateOperationPhase accepts skipped-dependency', () => {
    expect(isTerminalContainerUpdateOperationPhase('skipped-dependency')).toBe(true);
  });

  test('isTerminalContainerUpdateOperationPhaseForStatus handles skipped-dependency status', () => {
    expect(
      isTerminalContainerUpdateOperationPhaseForStatus('skipped-dependency', 'skipped-dependency'),
    ).toBe(true);
    expect(isTerminalContainerUpdateOperationPhaseForStatus('skipped-dependency', 'failed')).toBe(
      false,
    );
  });

  test('getDefaultTerminalContainerUpdateOperationPhase returns skipped-dependency for skipped-dependency status', () => {
    expect(getDefaultTerminalContainerUpdateOperationPhase('skipped-dependency')).toBe(
      'skipped-dependency',
    );
  });

  test('resolveTerminalContainerUpdateOperationPhase handles skipped-dependency status', () => {
    expect(resolveTerminalContainerUpdateOperationPhase('skipped-dependency', undefined)).toBe(
      'skipped-dependency',
    );
    expect(
      resolveTerminalContainerUpdateOperationPhase('skipped-dependency', 'skipped-dependency'),
    ).toBe('skipped-dependency');
  });

  test('CONTAINER_UPDATE_OPERATION_PHASES includes skipped-dependency', () => {
    expect(
      (CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes('skipped-dependency'),
    ).toBe(true);
  });

  test('isContainerUpdateOperationStatus accepts skipped-dependency', () => {
    expect(isContainerUpdateOperationStatus('skipped-dependency')).toBe(true);
  });

  test('isTerminalContainerUpdateOperationStatus accepts skipped-dependency', () => {
    expect(isTerminalContainerUpdateOperationStatus('skipped-dependency')).toBe(true);
  });
});
