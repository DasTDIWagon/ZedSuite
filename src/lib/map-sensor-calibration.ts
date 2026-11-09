export const sensorHex = (value: number) => '0x' + value.toString(16).toUpperCase().padStart(6, '0');
export interface SensorBank { id: string; label: string; start: number; end: number }
export interface SensorCurve { address: number; axisAddress: number; input: [number, number]; pressure: [number, number]; encoding: 'adc10' | 'millivolts' }
export interface SensorDiagnostics { addresses: number[]; scalarAddress: number; message: number; multiplier: number; scalar: number }
export interface SensorMatch { bank: SensorBank; curve?: SensorCurve; diagnostics?: SensorDiagnostics; notes: string[] }
export interface SensorPreset {
  id: string; label: string; source: string; part?: string; fitment?: string; curveBasis?: string;
  voltage?: [number, number]; pressure: [number, number]; nativeInput?: [number, number]; ceiling: number;
  manufacturer?: string;
  verifiedRatings?: Record<string, string | number | number[]>;
}
export interface SensorPatch { address: number; before: number[]; after: number[]; label: string }
export interface SensorPlan { patches: SensorPatch[]; diagnostic?: { message: number; multiplier: number; scalar: number; ceiling: number } }

// Documented VAG T-MAP choices. Matching nominal pressure alone is insufficient.
export const MAP_SENSOR_PRESETS: SensorPreset[] = [
  { id: 'stock-gn', label: 'Bosch 0281002177 — stock 2.5 bar class', part: '0281002177', manufacturer: 'Bosch',
    source: 'Supplied OEM GN4308 calibration, associated with Bosch 0281002177 by the user. Exact ECU counts are preserved.',
    curveBasis: 'OEM calibration: ADC 82 / 989 → 200 / 2600 mbar. Displayed volts are derived at 5 V / 1023, not a manufacturer test specification.',
    fitment: 'Original sensor reference for the supplied VAG file. Confirm the original connector, mounting and seal.',
    nativeInput: [82, 989], pressure: [200, 2600], ceiling: 2601 },
  { id: 'bosch-3', label: 'Bosch 0281002401 — 3 bar VAG T-MAP', part: '0281002401', manufacturer: 'Bosch',
    source: 'MKS Autobusiness sensor catalogue and linked pressure/voltage curve: https://www.mksautobusiness.fi/page_sensors_pressure.html ; https://www.mksautobusiness.fi/custom/0281002437_curve.jpg',
    curveBasis: 'Supplier-published part-specific curve: 0.4 V / 200 mbar and 4.65 V / 3000 mbar.',
    fitment: '5 V, four-pin VAG T-MAP. Pin 1 ground; 2 temperature; 3 supply; 4 pressure. Probe, mounting and seal may need an adapter; verify housing.',
    voltage: [0.4, 4.65], pressure: [200, 3000], ceiling: 3060 },
  { id: 'bosch-4', label: 'Bosch 0281006059 — 4 bar VAG T-MAP', part: '0281006059', manufacturer: 'Bosch',
    source: 'Part-specific DS-S3-TF technical sheet for 0281006059 / 0281006060, mirrored at https://forum.arduino.cc/uploads/short-url/abxXpZLi8jauwBr5zoSedSJ6kCw.pdf',
    curveBasis: 'Technical-sheet curve: 0.5 V / 500 mbar and 4.5 V / 4000 mbar. This replaces the older approximate WinOLS reference in the preset list.',
    fitment: '5 V, four-pin VAG T-MAP. Pin 1 ground; 2 temperature; 3 supply; 4 pressure. Verify probe size and mounting; an adapter/grommet may be required.',
    voltage: [0.5, 4.5], pressure: [500, 4000], ceiling: 4000 },
];

// Kept for comparison tests, not offered as a documented sensor-curve preset.
export const SUPPLIED_MAP_SENSOR_REFERENCE: SensorPreset = {
  id: 'supplied-modified', label: 'Legacy supplied WinOLS reference', part: '0281006059', manufacturer: 'Bosch',
  source: 'User-confirmed supplied WinOLS file; approximate stored calibration retained for regression comparison only.',
  nativeInput: [82, 989], pressure: [400, 4300], ceiling: 4000,
};

const REQUIRED_RATINGS = ['pressureReference', 'supplyRange', 'outputType', 'pinout', 'pressureRange',
  'outputRange', 'operatingTemperature', 'overpressure', 'temperatureCurve', 'mounting'];

/** Unknown ratings keep products separate, even when their nominal curves match. */
export function groupSensorPresets(presets: SensorPreset[]) {
  const groups: { preset: SensorPreset; label: string; members: SensorPreset[] }[] = [];
  const keys = new Map<string, number>();
  for (const preset of presets) {
    const ratings = preset.verifiedRatings;
    const known = (value: string | number | number[] | undefined): boolean =>
      typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number' ? Number.isFinite(value)
        : Array.isArray(value) && value.length > 0 && value.every(Number.isFinite);
    const complete = preset.manufacturer && preset.part && ratings &&
      REQUIRED_RATINGS.every(key => known(ratings[key])) && Object.values(ratings).every(known);
    const key = complete ? JSON.stringify({
      voltage: preset.voltage ?? null, pressure: preset.pressure, nativeInput: preset.nativeInput ?? null,
      ceiling: preset.ceiling, ratings: Object.keys(ratings).sort().map(key => [key, ratings[key]]),
    }) : null;
    const existing = key === null ? undefined : keys.get(key);
    if (existing === undefined) {
      if (key !== null) keys.set(key, groups.length);
      groups.push({ preset, label: preset.label, members: [preset] });
    } else {
      const group = groups[existing];
      group.members.push(preset);
      group.label = group.members.map(member => `${member.manufacturer ?? 'Bosch'} ${member.part ?? member.label}`).join(' / ')
        + ` — ${(preset.pressure[1] / 1000).toFixed(1)} bar, matching specifications`;
    }
  }
  return groups;
}

const SIGNATURE = [0x67, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x56, 0x34, 0x2e, 0x31];
const word = (data: ArrayLike<number>, pos: number) => data[pos] | (data[pos + 1] << 8);
const bytes16 = (value: number) => [value & 255, value >> 8];
const DIAGNOSTIC_LAYOUT: Array<[number, number] | null> = [
  [0x27, 0x33], [0x15, 0x14], [0x21, 0xff], [0x31, 0xc8], null, null,
  [0x1f, 0xc7], [0x06, 0x4c], [0x05, 0x09], [0x05, 0x09], [0x05, 0x09],
  [0x27, 0x33], [0x1b, 0x16], [0x1b, 0x16], [0x15, 0x14], null, [0x31, 0xc8], [0x31, 0xc8],
];
// ANU AB1071 / LP1596 use the same pressure-record positions, with different
// surrounding measurement types. Keep each observed layout explicit.
const ANU_DIAGNOSTIC_LAYOUT: Array<[number, number] | null> = [
  [0x27, 0x46], [0x08, 0x0a], [0x21, 0xff], [0x31, 0xc4], null, null,
  [0x1f, 0xc9], [0x06, 0x4c], [0x05, 0x09], [0x08, 0x0a], [0x05, 0x09],
  [0x27, 0x46], [0x08, 0x0a], [0x27, 0x46], [0x10, 0xff], null, [0x31, 0xc8], [0x17, 0x67],
];
const LP_DIAGNOSTIC_LAYOUT = ANU_DIAGNOSTIC_LAYOUT.map((pair, i) => i === 12 ? [0x17, 0x66] as [number, number] : pair);
const DIAGNOSTIC_LAYOUTS = [DIAGNOSTIC_LAYOUT, ANU_DIAGNOSTIC_LAYOUT, LP_DIAGNOSTIC_LAYOUT];
const SCALAR_LAYOUT: Array<number | null> = [200, 0, 0, 0, 20, 0, 0, 0, 100, 0, 0, 0, null, null, 0, 0, 236, 4, 0, 0, 9, 0, 0, 0, 80, 0, 0, 0, 100, 0, 0, 0];
// BD2507 uses the same pressure factor prefix but zero-valued following fields.
// Verified in the supplied BD file, not inferred from a bare 980 occurrence.
const BD_SCALAR_LAYOUT: Array<number | null> = [200, 0, 0, 0, 20, 0, 0, 0, 100, 0, 0, 0, null, null, 0, 0, 236, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const scalarWords = (values: Array<number | null>): Array<number | null> =>
  values.flatMap(value => value === null ? [null, null, 0, 0] : [...bytes16(value), 0, 0]);
const SCALAR_LAYOUTS = [SCALAR_LAYOUT, BD_SCALAR_LAYOUT,
  scalarWords([200, 20, 100, null, 977, 0, 0, 0, 276, 2700]),
  scalarWords([200, 20, 100, null, 1260, 0, 0, 100, 0, 0, 0, 276, 2700]),
];
const CURVE_HEADERS = [0xdc9c, 0xdc9e, 0xdcd4, 0xdd28, 0xeb22, 0xe9bc, 0xeba2, 0xeba4];

export function sensorBanks(data: ArrayLike<number>): SensorBank[] {
  const signed = (pos: number) => SIGNATURE.every((b, i) => data[pos + i] === b);
  const compact = signed(0x58001) || signed(0x64001);
  const starts = compact ? [0x58000, 0x64000, 0x70000] : [0x4c000, 0x5c000, 0x6c000];
  const length = compact ? 0xc000 : 0x10000;
  const banks = starts.flatMap(start => start + length <= data.length && signed(start + (compact ? 1 : 0x4001))
    ? [{ id: start.toString(16), label: `Bank ${sensorHex(start)}`, start, end: start + length }] : []);
  return banks.length ? banks : [{ id: 'file', label: 'File-wide unique pattern', start: 0, end: data.length }];
}

/** Fixed surrounding record types, masked addresses/values; no bare 18 FF search. */
export function detectMapSensorCalibration(data: ArrayLike<number>, ecuType: string): SensorMatch[] {
  if (!/EDC15/i.test(ecuType)) return [];
  return sensorBanks(data).map(bank => {
    const curves: SensorCurve[] = [];
    const groups: { addresses: number[]; message: number; multiplier: number; start: number }[] = [];
    const scalars: number[] = [];
    for (let pos = bank.start; pos + 12 <= bank.end; pos += 2) {
      const id = word(data, pos);
      if (CURVE_HEADERS.includes(id) && word(data, pos + 2) === 2) {
        const lo = word(data, pos + 4), hi = word(data, pos + 6);
        const p1 = word(data, pos + 8), p2 = word(data, pos + 10);
        const adc = lo >= 0 && lo < 500 && hi > 500 && hi <= 1023;
        const mv = lo >= 0 && lo < 1500 && hi > 2000 && hi <= 5000;
        if ((adc || mv) && p1 < 1500 && p2 >= 1500 && p2 <= 10000 && p2 > p1)
          curves.push({ address: pos + 8, axisAddress: pos + 4, input: [lo, hi], pressure: [p1, p2], encoding: adc ? 'adc10' : 'millivolts' });
      }
      if (pos + DIAGNOSTIC_LAYOUT.length * 4 <= bank.end && data[pos + 2] === 0x27) {
        const matches = DIAGNOSTIC_LAYOUTS.some(layout => layout.every((pair, i) => {
          const at = pos + i * 4;
          const ram = word(data, at);
          return ram > 0 && ram !== 0xffff && ram !== 0xc3c3 && (!pair || (data[at + 2] === pair[0] && data[at + 3] === pair[1]));
        }));
        if (matches) {
          const addresses = [4, 5, 15].map(i => pos + i * 4 + 2);
          const message = data[addresses[0]], multiplier = data[addresses[0] + 1];
          if ([8, 18].includes(message) && multiplier > 0 && addresses.every(at => data[at] === message && data[at + 1] === multiplier))
            groups.push({ addresses, message, multiplier, start: pos });
        }
      }
      if (data[pos] === 200 && SCALAR_LAYOUTS.some(pattern => pos + pattern.length <= bank.end &&
          pattern.every((b, i) => b === null || data[pos + i] === b))) scalars.push(pos + 12);
    }
    const notes: string[] = [];
    const curve = curves.length === 1 ? curves[0] : undefined;
    if (curves.length !== 1) notes.push(curves.length ? 'Ambiguous sensor curves; no automatic write.' : 'Sensor curve pattern not recognized.');
    let diagnostics: SensorDiagnostics | undefined;
    if (groups.length === 1 && scalars.length === 1) {
      const g = groups[0], address = scalars[0], scalar = word(data, address);
      const expected = Math.round(10000 / ((g.message === 18 ? 0.04 : 0.1) * g.multiplier));
      if (address > g.start && address - g.start < 0x8000 && Math.abs(scalar - expected) <= 1)
        diagnostics = { addresses: g.addresses, scalarAddress: address, scalar, message: g.message, multiplier: g.multiplier };
    }
    if (!diagnostics) notes.push('Diagnostic record/scalar pattern is absent, ambiguous, or inconsistent.');
    return { bank, curve, diagnostics, notes };
  });
}

export function diagnosticCalibration(requestedCeiling: number) {
  if (!Number.isFinite(requestedCeiling) || requestedCeiling < 1000 || requestedCeiling > 6502.5) throw new Error('Diagnostic ceiling must be 1000 to 6502.5 mbar absolute.');
  const message = requestedCeiling <= 2601 + 1e-7 ? 18 : 8;
  const multiplier = message === 18 ? 255 : Math.ceil(requestedCeiling / 25.5 - 1e-10);
  const step = (message === 18 ? 0.04 : 0.1) * multiplier;
  return { message, multiplier, scalar: Math.round(10000 / step), ceiling: message === 18 ? multiplier * 255 * 4 / 100 : multiplier * 255 / 10 };
}

export function planMapSensorCalibration(data: ArrayLike<number>, matches: SensorMatch[], selected: string[], preset: SensorPreset,
  options: { sensor: boolean; diagnostics: boolean; supply?: number; adcMax?: number }): SensorPlan {
  if (!selected.length || (!options.sensor && !options.diagnostics)) throw new Error('Select a bank and at least one calibration section.');
  const supply = options.supply ?? 5, adcMax = options.adcMax ?? 1023;
  if (options.sensor && (!Number.isFinite(supply) || supply <= 0 || supply > 24 || !Number.isInteger(adcMax) || adcMax < 255 || adcMax > 65535)) throw new Error('Invalid sensor supply or ADC full-scale value.');
  const [p1, p2] = preset.pressure;
  if (options.sensor && (![p1, p2].every(p => Number.isFinite(p) && p >= 0) || p1 >= 1500 || p2 < 1500 || p2 > 10000 || p2 <= p1)) throw new Error('Supported pressure curves need a low point below 1500 mbar and a rising high point of 1500 to 10000 mbar absolute.');
  if (options.sensor && preset.voltage && (!preset.voltage.every(v => Number.isFinite(v) && v >= 0 && v <= supply) || preset.voltage[1] <= preset.voltage[0])) throw new Error('Voltage points must rise and stay within the sensor supply.');
  const diagnostic = options.diagnostics ? diagnosticCalibration(preset.ceiling) : undefined;
  if (diagnostic && options.sensor && preset.voltage && diagnostic.ceiling < p2) throw new Error('Diagnostic ceiling is lower than the sensor pressure range.');
  const patches: SensorPatch[] = [];
  const add = (address: number, after: number[], label: string) => {
    if (!Number.isSafeInteger(address) || address < 0 || address + after.length > data.length) throw new Error('Calibration extends outside the file.');
    patches.push({ address, before: Array.from({ length: after.length }, (_, i) => data[address + i]), after, label });
  };
  for (const id of [...new Set(selected)]) {
    const match = matches.find(m => m.bank.id === id);
    if (!match) throw new Error('A selected bank is no longer available. Rescan the file.');
    if (options.sensor) {
      if (!match.curve) throw new Error(`${match.bank.label}: no unique sensor curve pattern.`);
      let input: [number, number];
      if (preset.nativeInput) {
        if (match.curve.encoding !== 'adc10') throw new Error('This exact file-reference preset requires the ADC-count layout.');
        input = preset.nativeInput;
      } else if (preset.voltage) input = preset.voltage.map(v => Math.round(v * (match.curve!.encoding === 'millivolts' ? 1000 : adcMax / supply))) as [number, number];
      else throw new Error('Provide two voltage calibration points.');
      if (input[0] < 0 || input[1] <= input[0] || input[1] > (match.curve.encoding === 'adc10' ? adcMax : 65535)) throw new Error('Calibration points collapse or exceed the input range.');
      if (match.curve.encoding === 'adc10' ? input[0] >= 500 || input[1] <= 500 || input[1] > 1023 : input[0] >= 1500 || input[1] <= 2000 || input[1] > 5000) throw new Error('These input points do not fit the supported input-axis pattern.');
      add(match.curve.axisAddress, input.flatMap(bytes16), `${match.bank.label}: sensor input points`);
      add(match.curve.address, [Math.round(p1), Math.round(p2)].flatMap(bytes16), `${match.bank.label}: pressure points (mbar absolute)`);
    }
    if (diagnostic) {
      if (!match.diagnostics) throw new Error(`${match.bank.label}: diagnostic pattern not verified.`);
      for (const address of match.diagnostics.addresses) add(address, [diagnostic.message, diagnostic.multiplier], `${match.bank.label}: diagnostic format/multiplier`);
      add(match.diagnostics.scalarAddress, bytes16(diagnostic.scalar), `${match.bank.label}: diagnostic conversion factor`);
    }
  }
  const sorted = [...patches].sort((a, b) => a.address - b.address);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].address < sorted[i - 1].address + sorted[i - 1].after.length) throw new Error('Detected calibration ranges overlap.');
  return { patches: sorted, diagnostic };
}

export function applyMapSensorPlan(data: number[], plan: SensorPlan): number[] {
  if (!plan.patches.length) throw new Error('No calibration changes selected.');
  const result = [...data];
  let end = -1;
  for (const patch of [...plan.patches].sort((a, b) => a.address - b.address)) {
    if (!Number.isSafeInteger(patch.address) || patch.address < end || patch.before.length !== patch.after.length || !patch.after.length || patch.address < 0 || patch.address + patch.after.length > data.length ||
        [...patch.before, ...patch.after].some(b => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error('Invalid calibration patch.');
    end = patch.address + patch.after.length;
    if (patch.before.some((b, i) => data[patch.address + i] !== b)) throw new Error('The binary changed since preview. Close and reopen the tool to rescan.');
    patch.after.forEach((b, i) => { result[patch.address + i] = b; });
  }
  return result;
}
