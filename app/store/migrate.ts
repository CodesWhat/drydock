import logger from '../log/index.js';
import { classifyTagPrecision } from '../tag/precision.js';
import * as storeContainer from './container.js';

const log = logger.child({ component: 'store' });

function backfillMissingTagPrecision() {
  const containers = storeContainer.getContainersRaw();

  for (const container of containers) {
    const tag = container.image?.tag;
    if (!tag || tag.tagPrecision !== undefined) {
      continue;
    }

    storeContainer.updateContainer({
      ...container,
      image: {
        ...container.image,
        tag: {
          ...tag,
          tagPrecision: classifyTagPrecision(tag.value, container.transformTags),
        },
      },
    });
  }
}

/**
 * Data migration function.
 * @param from version
 * @param to version
 */
export function migrate(_from, _to) {
  log.info('Migrate data between schema versions');
  backfillMissingTagPrecision();
}
