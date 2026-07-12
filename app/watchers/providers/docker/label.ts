/** Supported Docker labels. */

/**
 * Should the container be tracked? (true | false).
 */
export const ddWatch = 'dd.watch';

/**
 * Optional regex indicating what tags to consider.
 */
export const ddTagInclude = 'dd.tag.include';

/**
 * Optional regex indicating what tags to not consider.
 */
export const ddTagExclude = 'dd.tag.exclude';

/**
 * Optional transform function to apply to the tag.
 */
export const ddTagTransform = 'dd.tag.transform';

/**
 * Optional tag family policy ('strict' by default, or 'loose' to allow cross-family updates).
 */
export const ddTagFamily = 'dd.tag.family';

/**
 * Whether to expose informational newer-tag insight for a pinned tag.
 */
export const ddTagPinInfo = 'dd.tag.pin.info';

export const ddUpdatePolicyMaturityMode = 'dd.updatePolicy.maturityMode';
export const ddUpdatePolicyMaturityMinAgeDays = 'dd.updatePolicy.maturityMinAgeDays';
export const ddUpdatePolicySkipTags = 'dd.updatePolicy.skipTags';
export const ddUpdatePolicySkipDigests = 'dd.updatePolicy.skipDigests';

/**
 * Optional path in Docker inspect JSON to derive the running tag value.
 */
export const ddInspectTagPath = 'dd.inspect.tag.path';

/**
 * When set to 'true', routes dd.inspect.tag.path to image.softwareVersion
 * only, preserving the real image tag for update detection. Default: off.
 */
export const ddInspectTagVersionOnly = 'dd.inspect.tag.version-only';

/**
 * Optional image reference to use for update lookups.
 */
export const ddRegistryLookupImage = 'dd.registry.lookup.image';

/**
 * Legacy alias kept for compatibility with old experimental builds.
 */
export const ddRegistryLookupUrl = 'dd.registry.lookup.url';

/**
 * Should container digest be tracked? (true | false).
 */
export const ddWatchDigest = 'dd.watch.digest';

/**
 * Optional templated string pointing to a browsable link.
 */
export const ddLinkTemplate = 'dd.link.template';

/**
 * Optional friendly name to display.
 */
export const ddDisplayName = 'dd.display.name';

/**
 * Optional friendly icon to display.
 */
export const ddDisplayIcon = 'dd.display.icon';

/**
 * Optional list of triggers to include
 */
export const ddActionInclude = 'dd.action.include';
export const ddNotificationInclude = 'dd.notification.include';
/** @deprecated Removed in v1.7.0 — use ddActionInclude or ddNotificationInclude */
export const ddTriggerInclude = 'dd.trigger.include';

/**
 * Optional list of triggers to exclude
 */
export const ddActionExclude = 'dd.action.exclude';
export const ddNotificationExclude = 'dd.notification.exclude';
/** @deprecated Removed in v1.7.0 — use ddActionExclude or ddNotificationExclude */
export const ddTriggerExclude = 'dd.trigger.exclude';

/**
 * Optional source repository override used for release-notes lookup.
 */
export const ddSourceRepo = 'dd.source.repo';

/**
 * Optional group name for container grouping / stack views.
 */
export const ddGroup = 'dd.group';

/**
 * Optional shell command to run before a container update.
 */
export const ddHookPre = 'dd.hook.pre';

/**
 * Optional shell command to run after a container update.
 */
export const ddHookPost = 'dd.hook.post';

/**
 * Whether to abort the update if the pre-hook fails (default: true).
 */
export const ddHookPreAbort = 'dd.hook.pre.abort';

/**
 * Timeout in milliseconds for hook execution (default: 60000).
 */
export const ddHookTimeout = 'dd.hook.timeout';

/**
 * Per-container opt-out for webhook API calls (default: true).
 * Set to 'false' to return 403 when the webhook API targets this container.
 */
export const ddWebhookEnabled = 'dd.webhook.enabled';

/**
 * Update mode for infrastructure containers (e.g. 'infrastructure' for socket proxies).
 * When set to 'infrastructure', the container is updated via the helper-swap path
 * which connects directly to /var/run/docker.sock, bypassing any socket proxy.
 */
export const ddUpdateMode = 'dd.update.mode';

/**
 * Whether to automatically rollback on health check failure (default: false).
 */
export const ddRollbackAuto = 'dd.rollback.auto';

/**
 * Health monitoring window in milliseconds (default: 300000 = 5 min).
 */
export const ddRollbackWindow = 'dd.rollback.window';

/**
 * Health polling interval in milliseconds (default: 10000 = 10s).
 */
export const ddRollbackInterval = 'dd.rollback.interval';
