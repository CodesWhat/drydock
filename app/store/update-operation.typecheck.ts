import { reopenTerminalOperation, updateOperation } from './update-operation.js';

updateOperation('op-1', { status: 'queued' });
updateOperation('op-1', { status: 'in-progress', phase: 'prepare' });
updateOperation('op-1', { completedAt: undefined });

// @ts-expect-error terminal statuses must go through markOperationTerminal
updateOperation('op-1', { status: 'failed' });

// @ts-expect-error terminal phases must go through markOperationTerminal
updateOperation('op-1', { phase: 'failed' });

// @ts-expect-error active updates cannot set completedAt strings
updateOperation('op-1', { completedAt: '2026-02-23T00:00:00.000Z' });

reopenTerminalOperation('op-1', { status: 'in-progress', phase: 'prepare' });

// @ts-expect-error reopenTerminalOperation requires an active status
reopenTerminalOperation('op-1', { phase: 'prepare' });

// @ts-expect-error reopenTerminalOperation only accepts active phases
reopenTerminalOperation('op-1', { status: 'in-progress', phase: 'failed' });
