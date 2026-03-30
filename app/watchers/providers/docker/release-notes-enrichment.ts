import type { Container } from '../../../model/container.js';
import {
  getFullReleaseNotesForContainer,
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
) {
  try {
    const sourceRepo = await resolveSourceRepoForContainer(containerWithResult);
    if (sourceRepo) {
      containerWithResult.sourceRepo = sourceRepo;
    }

    if (!containerWithResult.result || !containerWithResult.updateAvailable) {
      return;
    }

    const fullReleaseNotes = await getFullReleaseNotesForContainer(containerWithResult);
    if (!fullReleaseNotes) {
      return;
    }

    containerWithResult.result.releaseNotes = toContainerReleaseNotes(fullReleaseNotes);
  } catch (error: unknown) {
    logContainer.debug(`Unable to fetch release notes (${getErrorMessage(error)})`);
  }
}
