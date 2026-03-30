function toFinite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function formatCoordinate(value: number): string {
  return Number.parseFloat(value.toFixed(2)).toString();
}

export function buildSparklinePoints(values: number[], width: number, height: number): string {
  if (values.length === 0) {
    return '';
  }

  const finiteValues = values.map(toFinite);
  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);
  const valueRange = maxValue - minValue;

  if (valueRange === 0) {
    const middleY = formatCoordinate(height / 2);
    if (values.length === 1) {
      return `0,${middleY}`;
    }
    const denominator = values.length - 1;
    const points: string[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const x = (index / denominator) * width;
      points.push(`${formatCoordinate(x)},${middleY}`);
    }
    return points.join(' ');
  }

  const points: string[] = [];
  const denominator = values.length - 1;

  for (let index = 0; index < finiteValues.length; index += 1) {
    const x = (index / denominator) * width;
    const y = height - ((finiteValues[index] - minValue) / valueRange) * height;
    points.push(`${formatCoordinate(x)},${formatCoordinate(y)}`);
  }

  return points.join(' ');
}
