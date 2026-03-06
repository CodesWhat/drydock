import { getOidcRedirection, loginBasic } from './auth';
import { getAuthentication, getAuthProviderColor, getAuthProviderIcon } from './authentication';
import {
  deleteContainer,
  getContainerLogs,
  getContainerSbom,
  getContainerTriggers,
  getContainerUpdateOperations,
  getContainerVulnerabilities,
  refreshContainer,
  runTrigger as runContainerTrigger,
  updateContainerPolicy,
} from './container';
import { getRegistry, getRegistryProviderColor, getRegistryProviderIcon } from './registry';
import { getTrigger, getTriggerProviderColor, getTriggerProviderIcon, runTrigger } from './trigger';
import { getWatcher, getWatcherProviderColor, getWatcherProviderIcon } from './watcher';

// container.ts
// @ts-expect-error should require a string container id
refreshContainer(123);
// @ts-expect-error should require a string container id
deleteContainer(123);
// @ts-expect-error should require a string container id
getContainerTriggers(123);
// @ts-expect-error should require string trigger fields
runContainerTrigger({ containerId: 1, triggerType: 2, triggerName: 3, triggerAgent: 4 });
// @ts-expect-error should require a string container id
getContainerLogs(123, 100);
// @ts-expect-error should require numeric tail
getContainerLogs('container-id', '100');
// @ts-expect-error should require a string container id
getContainerUpdateOperations(123);
// @ts-expect-error should require a string container id
getContainerVulnerabilities(123);
// @ts-expect-error should require a string container id
getContainerSbom(123, 'spdx-json');
// @ts-expect-error should require a string format
getContainerSbom('container-id', 123);
// @ts-expect-error should require string action
updateContainerPolicy('container-id', 123, {});
// @ts-expect-error should require object payload
updateContainerPolicy('container-id', 'skip-current', 123);

// trigger.ts
// @ts-expect-error should require string provider type
getTriggerProviderIcon(123);
// @ts-expect-error should require string provider type
getTriggerProviderColor(123);
// @ts-expect-error should require string type/name
getTrigger({ type: 1, name: 2, agent: 3 });
// @ts-expect-error should require string trigger names and object container
runTrigger({ triggerType: 1, triggerName: 2, container: null });

// registry.ts
// @ts-expect-error should require string provider
getRegistryProviderIcon(123);
// @ts-expect-error should require string provider
getRegistryProviderColor(123);
// @ts-expect-error should require string type/name
getRegistry({ type: 1, name: 2, agent: 3 });

// watcher.ts
// @ts-expect-error should require string provider type
getWatcherProviderIcon(123);
// @ts-expect-error should require string provider type
getWatcherProviderColor(123);
// @ts-expect-error should require string type/name
getWatcher({ type: 1, name: 2, agent: 3 });

// authentication.ts
// @ts-expect-error should require string auth provider type
getAuthProviderIcon(123);
// @ts-expect-error should require string auth provider type
getAuthProviderColor(123);
// @ts-expect-error should require string type/name
getAuthentication({ type: 1, name: 2, agent: 3 });

// auth.ts
// @ts-expect-error should require string username/password
loginBasic(1, 2, false);
// @ts-expect-error should require boolean remember flag
loginBasic('username', 'password', 'true');
// @ts-expect-error should require a string oidc provider name
getOidcRedirection(123);
