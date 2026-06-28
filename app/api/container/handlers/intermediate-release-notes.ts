import type { Request, Response } from 'express';
import { getIntermediateReleaseNotes } from '../../../release-notes/index.js';
import { sendErrorResponse } from '../../error-response.js';
import type { CrudHandlerContext } from '../crud-context.js';
import { getPathParamValue } from '../request-helpers.js';
import { getContainerOrNotFound } from './common.js';

export function createGetContainerIntermediateReleaseNotesHandler(context: CrudHandlerContext) {
  return async function getContainerIntermediateReleaseNotes(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const container = getContainerOrNotFound(context, id, res);
    if (!container) {
      return;
    }

    const from = typeof req.query.from === 'string' ? req.query.from.trim() : '';
    if (from === '') {
      sendErrorResponse(res, 400, "Query parameter 'from' is required");
      return;
    }

    const toRaw = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    const to = toRaw !== '' ? toRaw : (container.result?.tag?.trim() ?? '');
    if (to === '') {
      sendErrorResponse(
        res,
        422,
        "Cannot determine target tag: provide 'to' or ensure the container has a pending update",
      );
      return;
    }

    try {
      const result = await getIntermediateReleaseNotes(container, from, to);
      res.status(200).json(result);
    } catch (error: unknown) {
      sendErrorResponse(
        res,
        500,
        `Error retrieving intermediate release notes (${context.getErrorMessage(error)})`,
      );
    }
  };
}
