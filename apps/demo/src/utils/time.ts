export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysToMs(days: number): number {
  return days * MS_PER_DAY;
}
