import { HttpResponse, http } from 'msw';
import { containers } from '../data/containers';
import { createGroupPolicySeed, type DemoGroupPolicy } from '../data/groupPolicies';
import { errorResponse } from './errors';
import { readJsonRecord } from './json';

const policies = createGroupPolicySeed();
const actor = 'demo';
const MATURITY_MODES = new Set(['all', 'mature']);
const UPDATE_MODES = new Set(['manual', 'notify']);
let counter = 0;

function membersOf(group: string) {
  const members = containers.filter(
    (container) => (container.labels as Record<string, string>)['dd.group'] === group,
  );
  return { count: members.length, agents: members.length > 0 ? [null] : [] };
}

function view(policy: DemoGroupPolicy) {
  return structuredClone({ ...policy, members: membersOf(policy.group) });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function parseUpdatePolicy(value: unknown): DemoGroupPolicy['updatePolicy'] | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'updatePolicy must be an object';
  }
  const input = value as Record<string, unknown>;
  const result: DemoGroupPolicy['updatePolicy'] = {};
  if (input.maturityMode !== undefined) {
    if (typeof input.maturityMode !== 'string' || !MATURITY_MODES.has(input.maturityMode)) {
      return 'maturityMode must be all or mature';
    }
    result.maturityMode = input.maturityMode as 'all' | 'mature';
  }
  for (const key of [
    'maturityMinAgeDays',
    'maturitySkipReleases',
    'maturityReleaseFallbackDays',
  ] as const) {
    const entry = input[key];
    if (entry !== undefined) {
      if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0) {
        return `${key} must be a non-negative integer`;
      }
      result[key] = entry;
    }
  }
  for (const key of ['skipTags', 'skipDigests'] as const) {
    const entry = input[key];
    if (entry !== undefined) {
      if (!isStringArray(entry)) return `${key} must be an array of strings`;
      result[key] = entry;
    }
  }
  return result;
}

function parseActions(value: unknown): DemoGroupPolicy['actions'] | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'actions must be an object';
  }
  const input = value as Record<string, unknown>;
  const result: DemoGroupPolicy['actions'] = {};
  if (input.updateMode !== undefined) {
    if (typeof input.updateMode !== 'string' || !UPDATE_MODES.has(input.updateMode)) {
      return 'updateMode must be manual or notify';
    }
    result.updateMode = input.updateMode as 'manual' | 'notify';
  }
  if (input.exclude !== undefined) {
    if (!isStringArray(input.exclude)) return 'exclude must be an array of strings';
    result.exclude = input.exclude;
  }
  return result;
}

function parseBodyFields(body: Record<string, unknown>) {
  const updatePolicy = body.updatePolicy === undefined ? {} : parseUpdatePolicy(body.updatePolicy);
  if (typeof updatePolicy === 'string') return updatePolicy;
  const actions = body.actions === undefined ? {} : parseActions(body.actions);
  if (typeof actions === 'string') return actions;
  if (Object.keys(updatePolicy).length === 0 && Object.keys(actions).length === 0) {
    return 'Provide at least one of updatePolicy or actions';
  }
  return { updatePolicy, actions };
}

function writeResult(policy: DemoGroupPolicy, extra: Record<string, unknown> = {}) {
  const policyView = view(policy);
  return {
    ...extra,
    policy: policyView,
    applied: { members: policyView.members.count },
    warnings: [],
  };
}

export const groupPolicyHandlers = [
  http.get('/api/v1/group-policies', () => {
    const data = policies.map(view);
    return HttpResponse.json({ data, total: data.length });
  }),

  http.post('/api/v1/group-policies', async ({ request }) => {
    const body = await readJsonRecord(request);
    if (!body) return errorResponse(400, 'Request body must be a JSON object');
    if (typeof body.group !== 'string' || body.group === '') {
      return errorResponse(400, 'group must be a non-empty string');
    }
    if (policies.some((policy) => policy.group === body.group)) {
      return errorResponse(409, `A policy for group '${body.group}' already exists`);
    }
    const fields = parseBodyFields(body);
    if (typeof fields === 'string') return errorResponse(400, fields);
    const now = new Date().toISOString();
    counter += 1;
    const policy: DemoGroupPolicy = {
      id: `demo-gp-new-${counter}`,
      group: body.group,
      revision: 1,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
      ...fields,
    };
    policies.push(policy);
    return HttpResponse.json(writeResult(policy), { status: 201 });
  }),

  http.put('/api/v1/group-policies/:id', async ({ params, request }) => {
    const policy = policies.find((candidate) => candidate.id === params.id);
    if (!policy) return errorResponse(404, 'Group policy not found');
    const body = await readJsonRecord(request);
    if (!body) return errorResponse(400, 'Request body must be a JSON object');
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      return errorResponse(400, 'revision must be an integer');
    }
    if (body.revision !== policy.revision) {
      return errorResponse(409, 'The policy changed since it was read; reload and try again');
    }
    const fields = parseBodyFields(body);
    if (typeof fields === 'string') return errorResponse(400, fields);
    if (
      JSON.stringify(fields) ===
      JSON.stringify({ updatePolicy: policy.updatePolicy, actions: policy.actions })
    ) {
      return HttpResponse.json(writeResult(policy, { changed: false }));
    }
    policy.updatePolicy = fields.updatePolicy;
    policy.actions = fields.actions;
    policy.revision += 1;
    policy.updatedAt = new Date().toISOString();
    policy.updatedBy = actor;
    return HttpResponse.json(writeResult(policy, { changed: true }));
  }),

  http.delete('/api/v1/group-policies/:id', ({ params, request }) => {
    const index = policies.findIndex((candidate) => candidate.id === params.id);
    if (index === -1) return errorResponse(404, 'Group policy not found');
    const revision = Number(new URL(request.url).searchParams.get('revision'));
    if (!Number.isInteger(revision)) return errorResponse(400, 'revision must be an integer');
    if (revision !== policies[index].revision) {
      return errorResponse(409, 'The policy changed since it was read; reload and try again');
    }
    const [removed] = policies.splice(index, 1);
    return HttpResponse.json(writeResult(removed, { changed: true }));
  }),
];
