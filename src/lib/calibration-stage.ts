import { resolveMapCellLayout, type MapAxisSources } from './map-cell-layout';
import type { BankMap } from './map-bank-matching';
import type { AxisLabels } from './map-axis-edits';
import { applyMapSensorPlan, type SensorPlan } from './map-sensor-calibration';

type BinaryEdit = { oldValue: number; newValue: number };
type Flip = { rowsReversed: boolean; colsReversed: boolean };

/** Stage calibration writes without letting earlier map/axis overrides erase them. */
export function stageSensorCalibration<M extends BankMap>({
  base, live, original, plan, maps, cells, axes, binary, flips, sourcesOf, bigEndian,
}: {
  base: number[]; live: number[]; original: number[]; plan: SensorPlan; maps: M[];
  cells: Map<number, Record<string, number>>; axes: Map<number, AxisLabels>;
  binary: Map<number, BinaryEdit>; flips: Map<number, Flip>;
  sourcesOf: (map: M) => Pick<MapAxisSources, 'x' | 'y'>; bigEndian: boolean;
}) {
  applyMapSensorPlan(live, plan);
  const explicit = new Map<number, number>();
  for (const range of plan.patches) range.after.forEach((b, i) => explicit.set(range.address + i, b));
  const changes = [...explicit].filter(([address, value]) => value !== live[address])
    .map(([address, newValue]) => ({ address, oldValue: live[address], newValue }));
  if (!changes.length) return null;
  const touched = new Set(explicit.keys());
  const writes = new Map(explicit);
  const nextCells = new Map(cells);
  const nextAxes = new Map(axes);
  const preserve = (start: number, length: number) => {
    if (start < 0 || start + length > live.length) throw new Error('An overlapping map definition extends outside the file.');
    for (let i = start; i < start + length; i++) if (!writes.has(i)) writes.set(i, live[i]);
  };
  const overlaps = (start: number, length: number) => Array.from({ length }, (_, i) => start + i).some(i => touched.has(i));
  for (const map of maps) {
    const edits = cells.get(map.address);
    if (edits) {
      const layout = resolveMapCellLayout(map);
      const size = Math.max(1, Math.floor(map.size / Math.max(1, layout.apiRows * layout.apiCols)));
      const flip = flips.get(map.address);
      const kept = { ...edits };
      for (const key of Object.keys(edits)) {
        const [r, c] = key.split(/[-,]/).map(Number);
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= layout.rows || c >= layout.cols) continue;
        const row = flip?.rowsReversed ? layout.rows - 1 - r : r;
        const col = flip?.colsReversed ? layout.cols - 1 - c : c;
        const pos = map.address + layout.cellIndex(row, col) * size;
        if (overlaps(pos, size)) { preserve(pos, size); delete kept[key]; }
      }
      if (Object.keys(kept).length) nextCells.set(map.address, kept);
      else nextCells.delete(map.address);
    }
    const labels = axes.get(map.address);
    if (labels) {
      const src = sourcesOf(map);
      for (const axis of ['x', 'y'] as const) {
        if (!src[axis].address) continue;
        labels[axis]?.forEach((_, i) => {
          const pos = src[axis].address + i * 2;
          if (overlaps(pos, 2)) preserve(pos, 2);
        });
      }
    }
  }
  const data = [...base];
  const nextBinary = new Map(binary);
  for (const [address, newValue] of writes) {
    data[address] = newValue;
    const oldValue = original[address] ?? base[address];
    if (newValue === oldValue) nextBinary.delete(address);
    else nextBinary.set(address, { oldValue, newValue });
  }
  for (const map of maps) {
    const labels = axes.get(map.address);
    if (!labels) continue;
    const src = sourcesOf(map);
    const next = { ...labels };
    for (const axis of ['x', 'y'] as const) {
      const values = labels[axis];
      if (!values || !src[axis].address) continue;
      const adjusted = values.map((label, i) => {
        const pos = src[axis].address + i * 2;
        if (!overlaps(pos, 2)) return label;
        const raw = bigEndian ? ((data[pos] << 8) | data[pos + 1]) : (data[pos] | (data[pos + 1] << 8));
        return String(raw * src[axis].correction + src[axis].offset);
      });
      const differs = adjusted.some((label, i) => {
        const pos = src[axis].address + i * 2;
        const raw = bigEndian ? ((data[pos] << 8) | data[pos + 1]) : (data[pos] | (data[pos + 1] << 8));
        return Math.round((Number(label.replace(',', '.')) - src[axis].offset) / (src[axis].correction || 1)) !== raw;
      });
      if (differs) next[axis] = adjusted;
      else delete next[axis];
    }
    if (next.x || next.y) nextAxes.set(map.address, next);
    else nextAxes.delete(map.address);
  }
  return { data, cells: nextCells, axes: nextAxes, binary: nextBinary, changes };
}
