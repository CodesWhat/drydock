import { i18n } from '../boot/i18n';
import { readJsonResponse } from '../utils/api';

type GroupPolicyMaturityMode = 'all' | 'mature';
type GroupPolicyUpdateMode = 'manual' | 'notify';

interface GroupPolicyUpdatePolicy {
  maturityMode?: GroupPolicyMaturityMode;
  maturityMinAgeDays?: number;
  skipTags?: string[];
  skipDigests?: string[];
}

interface GroupPolicyActions {
  updateMode?: GroupPolicyUpdateMode;
  exclude?: string[];
}

interface GroupPolicyBody {
  updatePolicy: GroupPolicyUpdatePolicy;
  actions: GroupPolicyActions;
}

/** Current members of the policy's group. `null` in `agents` is the controller. */
interface GroupPolicyMembers {
  count: number;
  agents: (string | null)[];
}

interface GroupPolicy extends GroupPolicyBody {
  id: string;
  /** The exact group name, matched without trimming or case folding. */
  group: string;
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  members: GroupPolicyMembers;
}

interface GroupPolicyWriteResult {
  policy: GroupPolicy;
  applied: { members: number };
  warnings: string[];
  /** Present on replace and delete. `false` means the replace was a no-op. */
  changed?: boolean;
}

/** A failed request that keeps the status the editor branches on. */
class GroupPolicyHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GroupPolicyHttpError';
    this.status = status;
  }
}

const BASE_PATH = '/api/v1/group-policies';

async function throwForResponse(response: Response): Promise<never> {
  const payload = await response.json().catch(() => null);
  const message =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { error?: unknown }).error === 'string' &&
    (payload as { error: string }).error.trim()
      ? (payload as { error: string }).error
      : i18n.global.t('groupPolicyEditor.errors.requestFailed', { status: response.status });
  throw new GroupPolicyHttpError(response.status, message);
}

/** The server rejects an empty `updatePolicy` or `actions` object, so only send what is set. */
function bodyFields(body: GroupPolicyBody) {
  return {
    ...(Object.keys(body.updatePolicy).length > 0 ? { updatePolicy: body.updatePolicy } : {}),
    ...(Object.keys(body.actions).length > 0 ? { actions: body.actions } : {}),
  };
}

async function listGroupPolicies(): Promise<GroupPolicy[]> {
  const response = await fetch(BASE_PATH, { credentials: 'include' });
  if (!response.ok) {
    return throwForResponse(response);
  }
  const payload = await readJsonResponse<{ data?: GroupPolicy[] }>(response, 'Group policies');
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function createGroupPolicy(
  group: string,
  body: GroupPolicyBody,
): Promise<GroupPolicyWriteResult> {
  const response = await fetch(BASE_PATH, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group, ...bodyFields(body) }),
  });
  if (!response.ok) {
    return throwForResponse(response);
  }
  return readJsonResponse<GroupPolicyWriteResult>(response, 'Group policies');
}

async function replaceGroupPolicy(
  id: string,
  revision: number,
  body: GroupPolicyBody,
): Promise<GroupPolicyWriteResult> {
  const response = await fetch(`${BASE_PATH}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, ...bodyFields(body) }),
  });
  if (!response.ok) {
    return throwForResponse(response);
  }
  return readJsonResponse<GroupPolicyWriteResult>(response, 'Group policies');
}

async function deleteGroupPolicy(id: string, revision: number): Promise<GroupPolicyWriteResult> {
  const response = await fetch(`${BASE_PATH}/${encodeURIComponent(id)}?revision=${revision}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    return throwForResponse(response);
  }
  return readJsonResponse<GroupPolicyWriteResult>(response, 'Group policies');
}

export {
  createGroupPolicy,
  deleteGroupPolicy,
  type GroupPolicy,
  type GroupPolicyActions,
  type GroupPolicyBody,
  GroupPolicyHttpError,
  type GroupPolicyMaturityMode,
  type GroupPolicyMembers,
  type GroupPolicyUpdateMode,
  type GroupPolicyUpdatePolicy,
  type GroupPolicyWriteResult,
  listGroupPolicies,
  replaceGroupPolicy,
};
