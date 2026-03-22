import type { Request, Response } from 'express';
import { getFullReleaseNotesForContainer } from '../../../release-notes/index.js';
import { sendErrorResponse } from '../../error-response.js';
import type { CrudHandlerContext } from '../crud-context.js';
import { getPathParamValue } from '../request-helpers.js';
import { getContainerOrNotFound } from './common.js';

export function createGetContainerReleaseNotesHandler(context: CrudHandlerContext) {
  return async function getContainerReleaseNotes(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const container = getContainerOrNotFound(context, id, res);
    if (!container) {
      return;
    }

    try {
      const releaseNotes = await getFullReleaseNotesForContainer(container);
      if (!releaseNotes) {
        sendErrorResponse(res, 404, 'Release notes not available');
        return;
      }
      res.status(200).json(releaseNotes);
    } catch (error: unknown) {
      sendErrorResponse(
        res,
        500,
        `Error retrieving release notes (${context.getErrorMessage(error)})`,
      );
    }
  };
}
