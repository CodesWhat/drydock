import type Docker from './Docker.js';
import type { DockerWatcherConfiguration } from './Docker.js';

type IsAny<T> = 0 extends 1 & T ? true : false;
type ExpectFalse<T extends false> = T;

type _watchCronNotAny = ExpectFalse<IsAny<Docker['watchCron']>>;
type _watchCronTimeoutNotAny = ExpectFalse<IsAny<Docker['watchCronTimeout']>>;
type _watchCronDebouncedNotAny = ExpectFalse<IsAny<Docker['watchCronDebounced']>>;
type _listenDockerEventsTimeoutNotAny = ExpectFalse<IsAny<Docker['listenDockerEventsTimeout']>>;
type _dockerEventsStreamNotAny = ExpectFalse<IsAny<Docker['dockerEventsStream']>>;

type _watchDigestConfigNotAny = ExpectFalse<IsAny<DockerWatcherConfiguration['watchdigest']>>;
type _oidcConfigNotAny = ExpectFalse<
  IsAny<NonNullable<NonNullable<DockerWatcherConfiguration['auth']>['oidc']>>
>;

type _findNewVersionReturnNotAny = ExpectFalse<
  IsAny<Awaited<ReturnType<Docker['findNewVersion']>>>
>;
