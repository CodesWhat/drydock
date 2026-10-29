import { agentHandlers } from './handlers/agents';
import { apiKeyHandlers } from './handlers/apiKeys';
import { appHandlers } from './handlers/app';
import { approvalHandlers } from './handlers/approvals';
import { auditHandlers } from './handlers/audit';
import { authHandlers } from './handlers/auth';
import { authenticationHandlers } from './handlers/authentications';
import { configEditorHandlers } from './handlers/configEditor';
import { containerOpsHandlers } from './handlers/containerOps';
import { containerHandlers } from './handlers/containers';
import { fontHandlers } from './handlers/fonts';
import { groupPolicyHandlers } from './handlers/groupPolicies';
import { iconHandlers } from './handlers/icons';
import { imageHandlers } from './handlers/images';
import { labelOverrideHandlers } from './handlers/labelOverrides';
import { logHandlers } from './handlers/log';
import { notificationHandlers } from './handlers/notifications';
import { preferencesHandlers } from './handlers/preferences';
import { registryHandlers } from './handlers/registries';
import { securityHandlers } from './handlers/security';
import { serverHandlers } from './handlers/server';
import { settingsHandlers } from './handlers/settings';
import { skipsHandlers } from './handlers/skips';
import { statsHandlers } from './handlers/stats';
import { storeHandlers } from './handlers/store';
import { totpHandlers } from './handlers/totp';
import { triggerHandlers } from './handlers/triggers';
import { watcherHandlers } from './handlers/watchers';

export const handlers = [
  // Literal and deeper paths first: they must win over `/containers/:id` and
  // `/:type/:name/:agent` in the handler files below.
  ...apiKeyHandlers,
  ...configEditorHandlers,
  ...containerOpsHandlers,
  ...groupPolicyHandlers,
  ...labelOverrideHandlers,
  ...preferencesHandlers,
  ...skipsHandlers,
  ...statsHandlers,
  ...totpHandlers,
  ...authHandlers,
  ...containerHandlers,
  ...securityHandlers,
  ...registryHandlers,
  ...watcherHandlers,
  ...triggerHandlers,
  ...agentHandlers,
  ...auditHandlers,
  ...notificationHandlers,
  ...settingsHandlers,
  ...serverHandlers,
  ...appHandlers,
  ...storeHandlers,
  ...logHandlers,
  ...authenticationHandlers,
  ...fontHandlers,
  ...iconHandlers,
  ...approvalHandlers,
  ...imageHandlers,
];
