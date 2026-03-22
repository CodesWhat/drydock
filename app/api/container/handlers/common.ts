import type { Response } from 'express';
import type { Container } from '../../../model/container.js';
import { sendErrorResponse } from '../../error-response.js';
import type { CrudHandlerContext } from '../crud-context.js';

export function getContainerOrNotFound(
  context: CrudHandlerContext,
  id: string,
  res: Response,
): Container | undefined {
  const container = context.storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
    return undefined;
  }
  return container;
}

export function resolveWatcherIdForContainer(container: Container): string {
  let watcherId = `docker.${container.watcher}`;
  if (container.agent) {
    watcherId = `${container.agent}.${watcherId}`;
  }
  return watcherId;
}
