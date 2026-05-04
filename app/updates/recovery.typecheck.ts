import type { Container } from '../model/container.js';
import { findRecoveryUpdateTrigger } from './recovery.js';
import type { AcceptedContainerUpdateRequest } from './request-update.js';

const container = {} as Container;

const updateTrigger: AcceptedContainerUpdateRequest['trigger'] | undefined =
  findRecoveryUpdateTrigger(container);
void updateTrigger;

// @ts-expect-error recovery must expose an update-trigger accessor, not arbitrary registry state.
const outboxOnlyTrigger: { dispatchOutboxEntry: () => Promise<void> } =
  findRecoveryUpdateTrigger(container);
void outboxOnlyTrigger;
