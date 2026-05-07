export type TableColumnOverflow = 'truncate' | 'clamp-2' | 'wrap';
export type TableColumnAutoSize = 'content' | 'fixed' | 'fill';

export const ACTIONS_COLUMN_KEY = '__actions__';

const DEFAULT_DATA_SIZE = 160;
const DEFAULT_DATA_MIN_SIZE = 72;
const DEFAULT_DATA_MAX_SIZE = 720;
const DEFAULT_ICON_SIZE = 40;

export interface TableColumnSizingInput {
  key: string;
  width?: string;
  size?: number;
  minSize?: number;
  maxSize?: number;
  flex?: number;
  priority?: number;
  overflow?: TableColumnOverflow;
  autoSize?: TableColumnAutoSize;
  icon?: boolean;
}

export interface NormalizedTableColumnSizing {
  size: number;
  minSize: number;
  maxSize: number;
  flex: number;
  priority: number;
  overflow: TableColumnOverflow;
  autoSize: TableColumnAutoSize;
}

export interface ResponsiveSizingColumn extends TableColumnSizingInput {
  required?: boolean;
}

export function clampColumnSize(value: number, minSize: number, maxSize: number): number {
  return Math.round(Math.min(Math.max(value, minSize), maxSize));
}

export function parsePixelSize(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)px$/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseLegacyFlex(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (trimmed === '99%' || trimmed === '100%') {
    return 1;
  }
  const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)%$/);
  if (!match) return 0;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed / 100 : 0;
}

function finitePositive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeTableColumnSizing(
  column: TableColumnSizingInput,
): NormalizedTableColumnSizing {
  const legacySize = parsePixelSize(column.width);
  const isIcon = column.icon === true;
  const explicitSize = finitePositive(column.size);
  const defaultSize = isIcon ? DEFAULT_ICON_SIZE : DEFAULT_DATA_SIZE;
  const rawMinSize =
    finitePositive(column.minSize) ?? (isIcon ? defaultSize : DEFAULT_DATA_MIN_SIZE);
  const rawMaxSize =
    finitePositive(column.maxSize) ?? (isIcon ? defaultSize : DEFAULT_DATA_MAX_SIZE);
  const minSize = Math.min(rawMinSize, rawMaxSize);
  const maxSize = Math.max(rawMinSize, rawMaxSize);
  const rawSize = explicitSize ?? legacySize ?? defaultSize;
  const flex = finitePositive(column.flex) ?? parseLegacyFlex(column.width);
  const priority =
    typeof column.priority === 'number' && Number.isFinite(column.priority) ? column.priority : 0;
  const autoSize = column.autoSize ?? (flex > 0 ? 'fill' : 'content');

  return {
    size: clampColumnSize(rawSize, minSize, maxSize),
    minSize,
    maxSize,
    flex,
    priority,
    overflow: column.overflow ?? 'truncate',
    autoSize,
  };
}

export function columnMinimumFootprint(column: TableColumnSizingInput): number {
  return normalizeTableColumnSizing(column).minSize;
}

export function responsiveAutoHiddenColumns<T extends ResponsiveSizingColumn>(
  columns: T[],
  availableWidth: number | undefined,
  actionsSize = 0,
): T[] {
  if (!availableWidth || availableWidth <= 0) {
    return [];
  }

  const budget = availableWidth - actionsSize;
  const droppable = columns
    .filter((column) => !column.required && normalizeTableColumnSizing(column).priority > 0)
    .sort(
      (left, right) =>
        normalizeTableColumnSizing(right).priority - normalizeTableColumnSizing(left).priority,
    );
  const dropped: T[] = [];
  let sum = columns.reduce((acc, column) => acc + columnMinimumFootprint(column), 0);

  for (const column of droppable) {
    if (sum <= budget) {
      break;
    }
    dropped.push(column);
    sum -= columnMinimumFootprint(column);
  }

  return dropped;
}
