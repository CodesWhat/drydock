import type { Container } from '../../../model/container.js';
import {
  getReleaseNotesForTag,
  resolveSourceRepoForContainer,
  toContainerReleaseNotes,
} from '../../../release-notes/index.js';
import { getErrorMessage } from './docker-helpers.js';

interface ReleaseNotesEnrichmentLogger {
  debug: (message: string) => void;
}

export async function enrichContainerWithReleaseNotes(
  containerWithResult: Container,
  logContainer: ReleaseNotesEnrichmentLogger,
  imageLabels?: Record<string, string>,
) {
  try {
    const sourceRepo = await resolveSourceRepoForContainer(containerWithResult, imageLabels);
    if (sourceRepo) {
      containerWithResult.sourceRepo = sourceRepo;
    }

    const currentTag = containerWithResult.image?.tag?.value;
    const newTag = containerWithResult.result?.tag;

    const currentNotes = await getReleaseNotesForTag(containerWithResult, currentTag, imageLabels);
    if (currentNotes) {
      containerWithResult.currentReleaseNotes = toContainerReleaseNotes(currentNotes);
    }

    if (!containerWithResult.result || !containerWithResult.updateAvailable) {
      return;
    }

    if (typeof newTag === 'string' && newTag.trim() !== '' && newTag === currentTag) {
      if (currentNotes) {
        containerWithResult.result.releaseNotes = toContainerReleaseNotes(currentNotes);
      }
      return;
    }

    const newNotes = await getReleaseNotesForTag(containerWithResult, newTag, imageLabels);
    if (newNotes) {
      containerWithResult.result.releaseNotes = toContainerReleaseNotes(newNotes);
    }
  } catch (error: unknown) {
    logContainer.debug(`Unable to fetch release notes (${getErrorMessage(error)})`);
  }
}
