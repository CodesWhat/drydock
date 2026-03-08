import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { byString, byValues } from 'sort-es';
import type { RegistryState } from '../registry/index.js';
import * as registry from '../registry/index.js';
import { redactTriggerConfigurationInfrastructureDetails } from '../registry/trigger-config-redaction.js';
import { parseIntegerQueryParam } from './container/request-helpers.js';
import { sendErrorResponse } from './error-response.js';

export interface ApiComponent {
  id: string;
  type: string;
  name: string;
  configuration: unknown;
  agent?: string;
  metadata?: Record<string, unknown>;
}

interface ComponentLike {
  type: string;
  name: string;
  agent?: string;
  configuration?: unknown;
  maskConfiguration?: () => unknown;
  getMetadata?: () => Record<string, unknown>;
}

interface ComponentRouteParams {
  agent?: string;
  type: string;
  name: string;
}

type ComponentKind = keyof RegistryState;
type ComponentMap = Record<string, ComponentLike>;
type ComponentListPagination = {
  limit: number;
  offset: number;
};

const COMPONENT_LIST_MAX_LIMIT = 200;

function normalizeComponentListPagination(
  query: Request['query'] | undefined,
): ComponentListPagination {
  const queryParams = query || {};
  const parsedLimit = parseIntegerQueryParam(queryParams.limit, 0);
  const parsedOffset = parseIntegerQueryParam(queryParams.offset, 0);
  return {
    limit: Math.min(COMPONENT_LIST_MAX_LIMIT, Math.max(0, parsedLimit)),
    offset: Math.max(0, parsedOffset),
  };
}

function paginateComponentList(
  components: ApiComponent[],
  pagination: ComponentListPagination,
): ApiComponent[] {
  if (pagination.offset >= components.length) {
    return [];
  }
  if (pagination.limit === 0) {
    return components.slice(pagination.offset);
  }
  return components.slice(pagination.offset, pagination.offset + pagination.limit);
}

/**
 * Map a Component to a displayable (api/ui) item.
 * @param key
 * @param component
 * @returns {{id: *}}
 */
export function mapComponentToItem(
  key: string,
  component: ComponentLike,
  kind?: ComponentKind,
): ApiComponent {
  const configuration =
    typeof component.maskConfiguration === 'function'
      ? component.maskConfiguration()
      : component.configuration;
  const sanitizedConfiguration =
    kind === 'trigger'
      ? redactTriggerConfigurationInfrastructureDetails(configuration)
      : configuration;

  const item: ApiComponent = {
    id: key,
    type: component.type,
    name: component.name,
    configuration: sanitizedConfiguration,
    agent: component.agent,
  };

  if (typeof component.getMetadata === 'function') {
    item.metadata = component.getMetadata();
  }

  return item;
}

/**
 * Return a list instead of a map.
 * @param listFunction
 * @returns {{id: string}[]}
 */
export function mapComponentsToList(
  components: ComponentMap,
  kind?: ComponentKind,
): ApiComponent[] {
  return Object.keys(components)
    .map((key) => mapComponentToItem(key, components[key], kind))
    .sort(
      byValues([
        [(x) => x.type, byString()],
        [(x) => x.name, byString()],
      ]),
    );
}

/**
 * Get all components.
 * @param req
 * @param res
 */
function getAll(req: Request, res: Response, kind: ComponentKind): void {
  const components = registry.getState()[kind] as unknown as ComponentMap;
  const allItems = mapComponentsToList(components, kind);
  const pagination = normalizeComponentListPagination(req.query);
  const data = paginateComponentList(allItems, pagination);
  res.status(200).json({
    data,
    total: allItems.length,
    limit: pagination.limit,
    offset: pagination.offset,
    hasMore: pagination.limit > 0 && pagination.offset + data.length < allItems.length,
  });
}

/**
 * Get a component by id.
 * @param req
 * @param res
 * @param listFunction
 */
export function getById(req: Request<ComponentRouteParams>, res: Response, kind: ComponentKind) {
  const { agent, type, name } = req.params;
  const id = agent ? `${agent}.${type}.${name}` : `${type}.${name}`;
  const components = registry.getState()[kind] as unknown as ComponentMap;
  const component = components[id];
  if (component) {
    res.status(200).json(mapComponentToItem(id, component, kind));
  } else {
    sendErrorResponse(res, 404, 'Component not found');
  }
}

/**
 * Init the component router.
 * @param kind
 * @returns {*|Router}
 */
export function init(kind: ComponentKind) {
  const router = express.Router();
  router.use(nocache());
  router.get('/', (req: Request, res: Response) => getAll(req, res, kind));
  router.get('/:type/:name', (req: Request<ComponentRouteParams>, res: Response) =>
    getById(req, res, kind),
  );
  router.get('/:type/:name/:agent', (req: Request<ComponentRouteParams>, res: Response) =>
    getById(req, res, kind),
  );
  return router;
}
