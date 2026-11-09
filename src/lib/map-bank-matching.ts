import type { MapAxisSourceInput } from './map-cell-layout';

export interface BankMap extends MapAxisSourceInput {
  address: number;
  codeblock_id?: number;
}

const nameOf = (map: BankMap): string => (map.name ?? '')
  .replace(/\s*\(SOI\)/i, '')
  .replace(/\s*\[codeblock\s+\d+\]/gi, '').trim().toLowerCase();

/** Match the same named table and layout, preserving duplicate-table order. */
export function findBankCounterparts<M extends BankMap>(maps: M[], source: M): M[] {
  if (source.external_source || source.codeblock_id == null || !nameOf(source)) return [];
  const shape = (map: M): string => JSON.stringify([
    map.dimensions?.TwoDimensional?.rows ?? 1,
    map.dimensions?.TwoDimensional?.cols ?? map.dimensions?.OneDimensional?.length ?? 1,
    map.size, map.data_type ?? '',
  ]);
  const groups = new Map<number, M[]>();
  for (const map of maps) {
    if (map.external_source || map.codeblock_id == null || nameOf(map) !== nameOf(source) ||
        shape(map) !== shape(source)) continue;
    const group = groups.get(map.codeblock_id) ?? [];
    group.push(map);
    groups.set(map.codeblock_id, group);
  }
  for (const group of groups.values()) group.sort((a, b) => a.address - b.address);
  const own = groups.get(source.codeblock_id) ?? [];
  const index = own.findIndex(map => map.address === source.address);
  if (index < 0) return [];
  return [...groups].flatMap(([bank, group]) =>
    bank !== source.codeblock_id && group.length === own.length ? [group[index]] : []);
}
