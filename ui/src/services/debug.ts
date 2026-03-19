export interface DebugDumpDownload {
  blob: Blob;
  filename: string;
}

const DEFAULT_DEBUG_DUMP_FILENAME = 'drydock-debug-dump.json';

function parseFilenameFromContentDisposition(
  contentDispositionHeader: string | null,
): string | undefined {
  if (!contentDispositionHeader) {
    return undefined;
  }

  const utf8FilenameMatch = contentDispositionHeader.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8FilenameMatch?.[1]) {
    try {
      return decodeURIComponent(utf8FilenameMatch[1].replace(/^"|"$/g, ''));
    } catch {
      return utf8FilenameMatch[1].replace(/^"|"$/g, '');
    }
  }

  const quotedFilenameMatch = contentDispositionHeader.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedFilenameMatch?.[1]) {
    return quotedFilenameMatch[1];
  }

  const plainFilenameMatch = contentDispositionHeader.match(/filename\s*=\s*([^;]+)/i);
  if (plainFilenameMatch?.[1]) {
    return plainFilenameMatch[1].trim().replace(/^"|"$/g, '');
  }

  return undefined;
}

async function getApiErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // Ignore parse errors and fallback to status-based message.
  }

  return `HTTP ${response.status}`;
}

export async function downloadDebugDump(): Promise<DebugDumpDownload> {
  const response = await fetch('/api/v1/debug/dump', {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response));
  }

  const blob = await response.blob();
  const filename =
    parseFilenameFromContentDisposition(response.headers.get('Content-Disposition')) ||
    DEFAULT_DEBUG_DUMP_FILENAME;

  return { blob, filename };
}
