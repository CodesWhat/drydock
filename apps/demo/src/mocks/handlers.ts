import { agentHandlers } from './handlers/agents';
import { appHandlers } from './handlers/app';
import { auditHandlers } from './handlers/audit';
import { authHandlers } from './handlers/auth';
import { authenticationHandlers } from './handlers/authentications';
import { containerHandlers } from './handlers/containers';
import { fontHandlers } from './handlers/fonts';
import { iconHandlers } from './handlers/icons';
import { logHandlers } from './handlers/log';
import { notificationHandlers } from './handlers/notifications';
import { registryHandlers } from './handlers/registries';
import { securityHandlers } from './handlers/security';
import { serverHandlers } from './handlers/server';
import { settingsHandlers } from './handlers/settings';
import { storeHandlers } from './handlers/store';
import { triggerHandlers } from './handlers/triggers';
import { watcherHandlers } from './handlers/watchers';

export const handlers = [
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
];
