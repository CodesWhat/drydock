function pad(value: number, length = 2): string {
  return `${value}`.padStart(length, '0');
}

function formatDate(date: Date): string {
  return `[${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}]`;
}

export function formatLogTimestamp(timestamp: number | string | undefined | null): string {
  if (typeof timestamp === 'number') {
    if (!Number.isFinite(timestamp)) {
      return '-';
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return formatDate(date);
  }

  if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim();
    if (trimmed.length === 0) {
      return '-';
    }

    const parsedTimestamp = Date.parse(trimmed);
    if (Number.isNaN(parsedTimestamp)) {
      return trimmed;
    }
    return formatDate(new Date(parsedTimestamp));
  }

  return '-';
}
