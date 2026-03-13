import type { Request, Response } from 'express';
import type { Container } from '../../model/container.js';
import type { ApiComponent } from '../component.js';
import { isTriggerCompatibleWithContainer } from '../docker-trigger.js';
import { sendErrorResponse } from '../error-response.js';
import { getPathParamValue } from './request-helpers.js';

interface TriggerStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
}

interface ParsedTriggerReference {
  id: string;
  threshold: string;
}

interface TriggerComponent {
  id?: string;
  agent?: string;
  type: string;
  name: string;
  configuration: {
    threshold?: string;
  };
}

interface TriggerRuntimeComponent extends TriggerComponent {
  trigger: (container: Container) => Promise<unknown>;
}

interface TriggerStaticApi {
  parseIncludeOrIncludeTriggerString: (value: string) => ParsedTriggerReference;
  doesReferenceMatchId: (triggerReference: string, triggerId: string) => boolean;
}

export interface TriggerHandlerDependencies {
  storeContainer: TriggerStoreContainerApi;
  mapComponentsToList: (components: Record<string, TriggerRuntimeComponent>) => ApiComponent[];
  getTriggers: () => Record<string, TriggerRuntimeComponent>;
  Trigger: TriggerStaticApi;
  sanitizeLogParam: (value: unknown, maxLength?: number) => string;
  getErrorMessage: (error: unknown) => string;
  log: {
    info: (message: string) => void;
    warn: (message: string) => void;
  };
}

export function createTriggerHandlers({
  storeContainer,
  mapComponentsToList,
  getTriggers,
  Trigger,
  sanitizeLogParam,
  getErrorMessage,
  log,
}: TriggerHandlerDependencies) {
  function parseTriggerList(
    triggerString: string | undefined,
  ): ParsedTriggerReference[] | undefined {
    if (!triggerString) {
      return undefined;
    }
    return triggerString
      .split(',')
      .map((entry) => entry.trim())
      .map((entry) => Trigger.parseIncludeOrIncludeTriggerString(entry));
  }

  function resolveTriggerAssociation(
    trigger: TriggerComponent,
    includedTriggers: ParsedTriggerReference[] | undefined,
    excludedTriggers: ParsedTriggerReference[] | undefined,
  ): TriggerComponent | undefined {
    const triggerId = `${trigger.type}.${trigger.name}`;
    const triggerToAssociate = { ...trigger };

    if (includedTriggers) {
      const includedTrigger = includedTriggers.find((tr) =>
        Trigger.doesReferenceMatchId(tr.id, triggerId),
      );
      if (!includedTrigger) {
        return undefined;
      }
      triggerToAssociate.configuration.threshold = includedTrigger.threshold;
    }

    if (
      excludedTriggers?.some((excludedTrigger) =>
        Trigger.doesReferenceMatchId(excludedTrigger.id, triggerId),
      )
    ) {
      return undefined;
    }

    return triggerToAssociate;
  }

  async function getContainerTriggers(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);

    const container = storeContainer.getContainer(id);
    if (!container) {
      sendErrorResponse(res, 404, 'Container not found');
      return;
    }

    const triggerMap = getTriggers();
    const allTriggers = mapComponentsToList(triggerMap);
    const includedTriggers = parseTriggerList(container.triggerInclude);
    const excludedTriggers = parseTriggerList(container.triggerExclude);

    const associatedTriggers = allTriggers
      .filter((trigger) => {
        const triggerId = trigger.id || `${trigger.type}.${trigger.name}`;
        const runtimeTrigger = triggerMap[triggerId];
        return isTriggerCompatibleWithContainer(
          (runtimeTrigger || trigger) as unknown as TriggerComponent,
          container,
        );
      })
      .map((trigger) => resolveTriggerAssociation(trigger, includedTriggers, excludedTriggers))
      .filter((trigger) => trigger !== undefined);

    res.status(200).json({
      data: associatedTriggers,
      total: associatedTriggers.length,
    });
  }

  /**
   * Run trigger.
   * @param {*} req
   * @param {*} res
   */
  async function runTrigger(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const triggerAgent = getPathParamValue(req.params.triggerAgent);
    const triggerType = getPathParamValue(req.params.triggerType);
    const triggerName = getPathParamValue(req.params.triggerName);

    const containerToTrigger = storeContainer.getContainer(id);
    const triggerId = triggerAgent
      ? `${triggerAgent}.${triggerType}.${triggerName}`
      : `${triggerType}.${triggerName}`;
    if (containerToTrigger) {
      if (
        containerToTrigger.agent &&
        !triggerAgent &&
        ['docker', 'dockercompose'].includes(triggerType)
      ) {
        sendErrorResponse(
          res,
          400,
          `Cannot execute local ${triggerType} trigger on remote container ${containerToTrigger.agent}.${containerToTrigger.id}`,
        );
        return;
      }
      const triggerToRun = getTriggers()[triggerId];
      if (triggerToRun) {
        try {
          await triggerToRun.trigger(containerToTrigger);
          log.info(
            `Trigger executed with success (type=${sanitizeLogParam(triggerType)}, name=${sanitizeLogParam(triggerName)}, container=${sanitizeLogParam(JSON.stringify(containerToTrigger), 500)})`,
          );
          res.status(200).json({});
        } catch (error: unknown) {
          log.warn(
            `Error when running trigger (type=${sanitizeLogParam(triggerType)}, name=${sanitizeLogParam(triggerName)}) (${sanitizeLogParam(getErrorMessage(error))})`,
          );
          sendErrorResponse(
            res,
            500,
            `Error when running trigger (type=${triggerType}, name=${triggerName})`,
          );
        }
      } else {
        sendErrorResponse(res, 404, 'Trigger not found');
      }
    } else {
      sendErrorResponse(res, 404, 'Container not found');
    }
  }

  return {
    getContainerTriggers,
    runTrigger,
  };
}
