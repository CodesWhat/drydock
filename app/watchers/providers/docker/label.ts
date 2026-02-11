// @ts-nocheck
/**
 * Supported Docker labels (dd.* preferred, wud.* legacy fallback).
 */

/**
 * Should the container be tracked? (true | false).
 */
export const ddWatch = 'dd.watch';
export const wudWatch = 'wud.watch';

/**
 * Optional regex indicating what tags to consider.
 */
export const ddTagInclude = 'dd.tag.include';
export const wudTagInclude = 'wud.tag.include';

/**
 * Optional regex indicating what tags to not consider.
 */
export const ddTagExclude = 'dd.tag.exclude';
export const wudTagExclude = 'wud.tag.exclude';

/**
 * Optional transform function to apply to the tag.
 */
export const ddTagTransform = 'dd.tag.transform';
export const wudTagTransform = 'wud.tag.transform';

/**
 * Optional path in Docker inspect JSON to derive the running tag value.
 */
export const ddInspectTagPath = 'dd.inspect.tag.path';
export const wudInspectTagPath = 'wud.inspect.tag.path';

/**
 * Optional image reference to use for update lookups.
 */
export const ddRegistryLookupImage = 'dd.registry.lookup.image';
export const wudRegistryLookupImage = 'wud.registry.lookup.image';

/**
 * Legacy alias kept for compatibility with old experimental builds.
 */
export const ddRegistryLookupUrl = 'dd.registry.lookup.url';
export const wudRegistryLookupUrl = 'wud.registry.lookup.url';

/**
 * Should container digest be tracked? (true | false).
 */
export const ddWatchDigest = 'dd.watch.digest';
export const wudWatchDigest = 'wud.watch.digest';

/**
 * Optional templated string pointing to a browsable link.
 */
export const ddLinkTemplate = 'dd.link.template';
export const wudLinkTemplate = 'wud.link.template';

/**
 * Optional friendly name to display.
 */
export const ddDisplayName = 'dd.display.name';
export const wudDisplayName = 'wud.display.name';

/**
 * Optional friendly icon to display.
 */
export const ddDisplayIcon = 'dd.display.icon';
export const wudDisplayIcon = 'wud.display.icon';

/**
 * Optional list of triggers to include
 */
export const ddTriggerInclude = 'dd.trigger.include';
export const wudTriggerInclude = 'wud.trigger.include';

/**
 * Optional list of triggers to exclude
 */
export const ddTriggerExclude = 'dd.trigger.exclude';
export const wudTriggerExclude = 'wud.trigger.exclude';

/**
 * Optional group name for container grouping / stack views.
 */
export const ddGroup = 'dd.group';
export const wudGroup = 'wud.group';
