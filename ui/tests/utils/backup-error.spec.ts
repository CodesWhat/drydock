import { backupErrorMessage } from '@/utils/backup-error';
import { ApiError } from '@/utils/error';

describe('backup error messages', () => {
  const fallback = 'Échec du rollback';

  it('combines localized context with HTTP status and unchanged diagnostics', () => {
    expect(backupErrorMessage(new ApiError('Conflict (backup expired)', 409), fallback)).toBe(
      'Échec du rollback: HTTP 409: Conflict (backup expired)',
    );
  });

  it('keeps the status when HTTP/2 has an empty status text', () => {
    expect(backupErrorMessage(new ApiError('', 503), fallback)).toBe('Échec du rollback: HTTP 503');
  });

  it('uses the fallback when no status or diagnostic is available', () => {
    expect(backupErrorMessage(new ApiError('', 0), fallback)).toBe(fallback);
    expect(backupErrorMessage(new ApiError('  ', 0), fallback)).toBe(fallback);
  });

  it.each([new Error('network disconnected'), 'network disconnected'])(
    'preserves non-HTTP diagnostic %s',
    (error) => {
      expect(backupErrorMessage(error, fallback)).toBe('network disconnected');
    },
  );

  it.each([new Error(''), '', undefined, null, {}])('localizes empty error %s', (error) => {
    expect(backupErrorMessage(error, fallback)).toBe(fallback);
  });
});
