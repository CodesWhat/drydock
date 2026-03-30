import type { Request, Response } from 'express';
import { getContainerStatusSummary } from '../../util/container-summary.js';
import { sendErrorResponse } from '../error-response.js';
import {
  buildCrudHandlerContext,
  type CrudHandlerContext,
  type CrudHandlerDependencies,
} from './crud-context.js';
import {
  createGetContainerUpdateOperationsHandler,
  createRevealContainerEnvHandler,
  createWatchContainerHandler,
  createWatchContainersHandler,
} from './handlers/actions.js';
import { getContainerOrNotFound } from './handlers/common.js';
import { createGetContainersHandler } from './handlers/list.js';
import { createGetContainerReleaseNotesHandler } from './handlers/release-notes.js';
import { getPathParamValue } from './request-helpers.js';
import {
  buildSecurityVulnerabilityOverviewResponse,
  getSecurityIssueCount,
  type SecurityVulnerabilityOverviewResponse,
} from './security-overview.js';

function getContainerSummaryHandler(context: CrudHandlerContext, _req: Request, res: Response) {
  const containers = context.getContainersFromStore({});
  const containerStatus = getContainerStatusSummary(containers);
  const hotUpdates = containers.filter(
    (container) => container.updateAvailable && container.updateMaturityLevel === 'hot',
  ).length;
  const matureUpdates = containers.filter(
    (container) =>
      container.updateAvailable &&
      (container.updateMaturityLevel === 'mature' ||
        container.updateMaturityLevel === 'established'),
  ).length;
  res.status(200).json({
    containers: containerStatus,
    security: {
      issues: getSecurityIssueCount(containers),
    },
    hotUpdates,
    matureUpdates,
  });
}

function getContainerSecurityVulnerabilitiesHandler(
  context: CrudHandlerContext,
  req: Request,
  res: Response<SecurityVulnerabilityOverviewResponse>,
) {
  const totalContainers = context.getContainerCountFromStore({});
  if (totalContainers <= 0) {
    res.status(200).json(buildSecurityVulnerabilityOverviewResponse([], req.query, 0));
    return;
  }
  const containers = context.getContainersFromStore({});
  res
    .status(200)
    .json(buildSecurityVulnerabilityOverviewResponse(containers, req.query, totalContainers));
}

function getContainerHandler(context: CrudHandlerContext, req: Request, res: Response) {
  const id = getPathParamValue(req.params.id);
  const container = context.storeContainer.getContainer(id);
  if (container) {
    res.status(200).json(context.redactContainerRuntimeEnv(container));
  } else {
    sendErrorResponse(res, 404, 'Container not found');
  }
}

async function deleteContainerHandler(context: CrudHandlerContext, req: Request, res: Response) {
  const serverConfiguration = context.getServerConfiguration();
  if (!serverConfiguration.feature.delete) {
    sendErrorResponse(res, 403, 'Container deletion is disabled');
    return;
  }

  const id = getPathParamValue(req.params.id);
  const container = getContainerOrNotFound(context, id, res);
  if (!container) {
    return;
  }

  if (!container.agent) {
    context.storeContainer.deleteContainer(id);
    res.sendStatus(204);
    return;
  }

  const agent = context.getAgent(container.agent);
  if (!agent) {
    sendErrorResponse(res, 500, `Agent ${container.agent} not found`);
    return;
  }

  try {
    await agent.deleteContainer(id);
    context.storeContainer.deleteContainer(id);
    res.sendStatus(204);
  } catch (error: unknown) {
    if (context.getErrorStatusCode(error) === 404) {
      context.storeContainer.deleteContainer(id);
      res.sendStatus(204);
    } else {
      sendErrorResponse(
        res,
        500,
        `Error deleting container on agent (${context.getErrorMessage(error)})`,
      );
    }
  }
}

export function createCrudHandlers(dependencies: CrudHandlerDependencies) {
  const context = buildCrudHandlerContext(dependencies);
  const getContainers = createGetContainersHandler(context);
  const getContainerReleaseNotes = createGetContainerReleaseNotesHandler(context);
  const getContainerUpdateOperations = createGetContainerUpdateOperationsHandler(context);
  const watchContainers = createWatchContainersHandler(context);
  const watchContainer = createWatchContainerHandler(context);
  const revealContainerEnv = createRevealContainerEnvHandler(context);

  return {
    getContainers,
    getContainerSummary(req: Request, res: Response) {
      getContainerSummaryHandler(context, req, res);
    },
    getContainerSecurityVulnerabilities(
      req: Request,
      res: Response<SecurityVulnerabilityOverviewResponse>,
    ) {
      getContainerSecurityVulnerabilitiesHandler(context, req, res);
    },
    getContainer(req: Request, res: Response) {
      getContainerHandler(context, req, res);
    },
    getContainerReleaseNotes,
    getContainerUpdateOperations,
    deleteContainer(req: Request, res: Response) {
      return deleteContainerHandler(context, req, res);
    },
    watchContainers,
    watchContainer,
    revealContainerEnv,
  };
}
