import { resolveMapCellLayout, type MapAxisSourceInput, type MapAxisSources } from './map-cell-layout';
import { findBankCounterparts } from './map-bank-matching';

export type AxisLabels = { x?: string[]; y?: string[] };
type Axis = 'x' | 'y';
export interface BankAxisMap extends MapAxisSourceInput {
  address: number;
  codeblock_id?: number;
}

const numberOf = (label: string): number => Number(label.trim().replace(',', '.'));
/** Keep physical aliases in sync; optionally copy changed points across banks. */
export function updateAxisEdits<M extends BankAxisMap>({
  maps, sourceAddress, axes, previous, data, sourcesOf, copyOtherBanks, bigEndian = false,
}: {
  maps: M[];
  sourceAddress: number;
  axes: AxisLabels;
  previous: Map<number, AxisLabels>;
  data: ArrayLike<number>;
  sourcesOf: (map: M) => Pick<MapAxisSources, 'x' | 'y'>;
  copyOtherBanks: boolean | { x: boolean; y: boolean };
  bigEndian?: boolean;
}): Map<number, AxisLabels> {
  const next = new Map(previous);
  const source = maps.find(m => m.address === sourceAddress);
  const put = (address: number, patch: AxisLabels) => {
    const old = next.get(address) ?? {};
    const merged = { ...old };
    for (const axis of ['x', 'y'] as const) {
      if (patch[axis] !== undefined) {
        if (patch[axis]!.length) merged[axis] = patch[axis];
        else delete merged[axis];
      }
    }
    if (!merged.x && !merged.y) next.delete(address);
    else next.set(address, merged);
  };
  const applyShared = (map: M, patch: AxisLabels) => {
    put(map.address, patch);
    if (map.external_source) return;
    const from = sourcesOf(map);
    for (const other of maps) {
      if (other.address === map.address || other.external_source) continue;
      const to = sourcesOf(other);
      for (const axis of ['x', 'y'] as const) {
        const labels = patch[axis];
        if (labels === undefined || !from[axis].address) continue;
        for (const targetAxis of ['x', 'y'] as const) {
          if (to[targetAxis].address !== from[axis].address) continue;
          const converted = labels.map(label => {
            const value = numberOf(label);
            if (!Number.isFinite(value)) return label;
            const raw = Math.round((value - from[axis].offset) / (from[axis].correction || 1));
            return String(raw * to[targetAxis].correction + to[targetAxis].offset);
          });
          put(other.address, { [targetAxis]: converted });
        }
      }
    }
  };
  if (!source) put(sourceAddress, axes);
  else applyShared(source, axes);

  // Axis labels are in file order; use the same displayed-axis dimensions as export.
  const readAxis = (map: M, axis: Axis): string[] | null => {
    const layout = resolveMapCellLayout(map);
    const length = axis === 'x' ? layout.cols : layout.rows;
    const src = sourcesOf(map)[axis];
    if (!src.address || src.address + length * 2 > data.length) return null;
    return Array.from({ length }, (_, i) => {
      const pos = src.address + i * 2;
      const raw = bigEndian ? ((data[pos] << 8) | data[pos + 1]) : (data[pos] | (data[pos + 1] << 8));
      return String(raw * src.correction + src.offset);
    });
  };
  const copyAxes = typeof copyOtherBanks === 'boolean' ? { x: copyOtherBanks, y: copyOtherBanks } : copyOtherBanks;
  if ((copyAxes.x || copyAxes.y) && source && !source.external_source && source.codeblock_id != null) {
    const sourceAxes = sourcesOf(source);
    for (const axis of ['x', 'y'] as const) {
      if (!copyAxes[axis] || axes[axis] === undefined || !sourceAxes[axis].address) continue;
      const original = readAxis(source, axis);
      const before = previous.get(source.address)?.[axis] ?? original;
      const after = axes[axis]!.length ? axes[axis]! : original;
      if (!before || !after || before.length !== after.length) continue;
      const changed = after.flatMap((label, i) =>
        Number.isFinite(numberOf(label)) && numberOf(label) !== numberOf(before[i]) ? [i] : []);
      if (!changed.length) continue; // Ignore initial/restored-label notifications.
      const visited = new Set<number>();
      for (const target of findBankCounterparts(maps, source)) {
        const addr = sourcesOf(target)[axis].address;
        if (!addr || addr === sourceAxes[axis].address || visited.has(addr)) continue;
        const labels = previous.get(target.address)?.[axis] ?? readAxis(target, axis);
        if (!labels || labels.length !== after.length) continue;
        visited.add(addr);
        const copied = [...labels];
        for (const i of changed) copied[i] = after[i];
        applyShared(target, { [axis]: copied });
      }
    }
  }
  const equal = next.size === previous.size && [...next].every(([address, labels]) =>
    JSON.stringify(labels.x) === JSON.stringify(previous.get(address)?.x) &&
    JSON.stringify(labels.y) === JSON.stringify(previous.get(address)?.y));
  return equal ? previous : next;
}
