import { resolveMapCellLayout } from './map-cell-layout';
import { findBankCounterparts, type BankMap } from './map-bank-matching';

export interface BankCopyOptions { x: boolean; y: boolean; values: boolean }
type Flip = { rowsReversed: boolean; colsReversed: boolean };
type CellMap = BankMap & { is_little_endian?: boolean };

export function rebaseMapCellEdits(map: BankMap, edits: Record<string, number>, before: Flip, after: Flip): Record<string, number> {
  const layout = resolveMapCellLayout(map);
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(edits)) {
    const [r, c] = key.split(/[-,]/).map(Number);
    const row = before.rowsReversed ? layout.rows - 1 - r : r;
    const col = before.colsReversed ? layout.cols - 1 - c : c;
    const tr = after.rowsReversed ? layout.rows - 1 - row : row;
    const tc = after.colsReversed ? layout.cols - 1 - col : col;
    result[`${tr}-${tc}`] = value;
  }
  return result;
}

/** Copy only new cell edits, converting display coordinates through file order. */
export function updateMapCellEdits<M extends CellMap>({
  maps, sourceAddress, changedCells, previous, data, enabled, bigEndian, flips, correctionOf,
}: {
  maps: M[]; sourceAddress: number; changedCells: Record<string, number>;
  previous: Map<number, Record<string, number>>; data: ArrayLike<number>;
  enabled: boolean; bigEndian: boolean; flips: Map<number, Flip>;
  correctionOf: (map: M) => { correction: number; offset: number };
}): Map<number, Record<string, number>> {
  const old = previous.get(sourceAddress) ?? {};
  if (JSON.stringify(old) === JSON.stringify(changedCells)) return previous;
  const next = new Map(previous);
  if (Object.keys(changedCells).length) next.set(sourceAddress, changedCells);
  else next.delete(sourceAddress);
  const source = maps.find(m => m.address === sourceAddress);
  if (!enabled || !source) return next;
  const layout = resolveMapCellLayout(source);
  const cellSize = Math.floor(source.size / (layout.apiRows * layout.apiCols));
  if (cellSize !== 1 && cellSize !== 2) return next;
  const sourceFlip = flips.get(source.address);
  const read = (map: M, row: number, col: number): number | null => {
    const lo = resolveMapCellLayout(map);
    const size = Math.floor(map.size / (lo.apiRows * lo.apiCols));
    const pos = map.address + lo.cellIndex(row, col) * size;
    if (size !== cellSize || pos < 0 || pos + size > data.length) return null;
    const be = bigEndian && !map.is_little_endian;
    let raw = size === 1 ? data[pos] : be ? (data[pos] << 8) | data[pos + 1] : data[pos] | (data[pos + 1] << 8);
    if (map.data_type === 'Int16' && raw >= 32768) raw -= 65536;
    if (map.data_type === 'Int8' && raw >= 128) raw -= 256;
    const { correction, offset } = correctionOf(map);
    return raw * correction + offset;
  };
  for (const target of findBankCounterparts(maps, source)) {
    const targetLayout = resolveMapCellLayout(target);
    if (targetLayout.rows !== layout.rows || targetLayout.cols !== layout.cols) continue;
    const targetFlip = flips.get(target.address);
    const edits = { ...(previous.get(target.address) ?? {}) };
    for (const key of new Set([...Object.keys(old), ...Object.keys(changedCells)])) {
      if (old[key] === changedCells[key]) continue;
      const parts = key.split(/[-,]/).map(Number);
      if (parts.length !== 2 || parts.some(v => !Number.isInteger(v))) continue;
      const [r, c] = parts;
      if (r < 0 || c < 0 || r >= layout.rows || c >= layout.cols) continue;
      const row = sourceFlip?.rowsReversed ? layout.rows - 1 - r : r;
      const col = sourceFlip?.colsReversed ? layout.cols - 1 - c : c;
      const value = changedCells[key] ?? read(source, row, col);
      const original = read(target, row, col);
      if (value == null || original == null || !Number.isFinite(value)) continue;
      const tr = targetFlip?.rowsReversed ? layout.rows - 1 - row : row;
      const tc = targetFlip?.colsReversed ? layout.cols - 1 - col : col;
      const targetKey = `${tr}-${tc}`;
      delete edits[`${tr},${tc}`];
      if (Math.abs(value - original) < 1e-9) delete edits[targetKey];
      else edits[targetKey] = value;
    }
    if (Object.keys(edits).length) next.set(target.address, edits);
    else next.delete(target.address);
  }
  return next;
}
