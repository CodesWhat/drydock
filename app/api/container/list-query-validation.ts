import type { Request } from 'express';
import joi from 'joi';
import type { ContainerMaturityFilter } from './maturity.js';
import { getFirstQueryValue } from './query-values.js';
import type { ContainerSortMode } from './sorting.js';
import { CONTAINER_SORT_MODES, parseContainerSortMode } from './sorting.js';

const CONTAINER_LIST_QUERY_SCHEMA = joi.object({
  sort: joi
    .string()
    .valid(...CONTAINER_SORT_MODES)
    .messages({
      'any.only': 'Invalid sort value',
    }),
  status: joi
    .string()
    .valid(
      'update-available',
      'up-to-date',
      'running',
      'stopped',
      'exited',
      'paused',
      'restarting',
      'dead',
      'created',
    )
    .messages({
      'any.only': 'Invalid status filter value',
    }),
  kind: joi.string().valid('major', 'minor', 'patch', 'digest').messages({
    'any.only': 'Invalid kind filter value',
  }),
  watcher: joi.string().trim().min(1).messages({
    'string.empty': 'Invalid watcher filter value',
    'string.min': 'Invalid watcher filter value',
  }),
  maturity: joi.string().valid('hot', 'mature', 'established').messages({
    'any.only': 'Invalid maturity filter value',
  }),
});

export type ContainerRuntimeStatus =
  | 'running'
  | 'stopped'
  | 'exited'
  | 'paused'
  | 'restarting'
  | 'dead'
  | 'created';

export type ContainerUpdateStatus = 'update-available' | 'up-to-date';

export interface ValidatedContainerListQuery {
  sortMode: ContainerSortMode;
  status?: ContainerUpdateStatus | ContainerRuntimeStatus;
  kind?: 'major' | 'minor' | 'patch' | 'digest';
  watcher?: string;
  maturity?: ContainerMaturityFilter;
}

export function validateContainerListQuery(query: Request['query']): ValidatedContainerListQuery {
  const { value, error } = CONTAINER_LIST_QUERY_SCHEMA.validate(
    {
      sort: getFirstQueryValue(query.sort),
      status: getFirstQueryValue(query.status),
      kind: getFirstQueryValue(query.kind),
      watcher: getFirstQueryValue(query.watcher),
      maturity: getFirstQueryValue(query.maturity),
    },
    {
      abortEarly: true,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return {
    sortMode: parseContainerSortMode(value.sort),
    status: value.status,
    kind: value.kind,
    watcher: value.watcher,
    maturity: value.maturity,
  };
}
