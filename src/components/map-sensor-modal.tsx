"use client";

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { detectMapSensorCalibration, planMapSensorCalibration, MAP_SENSOR_PRESETS, groupSensorPresets, sensorHex,
  type SensorPlan, type SensorPreset } from '@/lib/map-sensor-calibration';

export function MapSensorModal({ data, ecuType, theme, readOnlyReason, onApply, onClose }: {
  data: number[]; ecuType: string; theme?: string; readOnlyReason?: string;
  onApply: (plan: SensorPlan) => void; onClose: () => void;
}) {
  const matches = useMemo(() => detectMapSensorCalibration(data, ecuType), [data, ecuType]);
  const first = matches.find(m => m.curve && m.diagnostics) ?? matches.find(m => m.curve || m.diagnostics);
  const [selected, setSelected] = useState(new Set(first ? [first.bank.id] : []));
  const [presetId, setPresetId] = useState('custom');
  const [name, setName] = useState('Current / custom sensor');
  const [supply, setSupply] = useState('5');
  const initialV = first?.curve ? first.curve.input.map(v => first.curve!.encoding === 'adc10' ? v * 5 / 1023 : v / 1000) : [0.4, 4.65];
  const [v1, setV1] = useState(initialV[0].toFixed(6));
  const [v2, setV2] = useState(initialV[1].toFixed(6));
  const [p1, setP1] = useState(String(first?.curve?.pressure[0] ?? 200));
  const [p2, setP2] = useState(String(first?.curve?.pressure[1] ?? 2600));
  const initialCeiling = first?.diagnostics ? (first.diagnostics.message === 18 ? 0.04 : 0.1) * first.diagnostics.multiplier * 255 : 2601;
  const [ceiling, setCeiling] = useState(String(Number(initialCeiling.toFixed(3))));
  const [sensor, setSensor] = useState(matches.some(m => m.curve));
  const [diagnostics, setDiagnostics] = useState(matches.some(m => m.diagnostics));
  const [error, setError] = useState('');
  const presetGroups = groupSensorPresets(MAP_SENSOR_PRESETS);
  const preset = MAP_SENSOR_PRESETS.find(p => p.id === presetId);
  const numeric = (value: string) => value.trim() ? Number(value) : Number.NaN;
  const desired: SensorPreset = preset ?? { id: 'custom', label: name || 'Custom sensor', source: 'User-entered manufacturer calibration points',
    voltage: [numeric(v1), numeric(v2)], pressure: [numeric(p1), numeric(p2)], ceiling: numeric(ceiling) };
  const active = { ...desired, ceiling: Number(ceiling) };
  let plan: SensorPlan | undefined;
  let problem = '';
  try { plan = planMapSensorCalibration(data, matches, [...selected], active, { sensor, diagnostics, supply: Number(supply) }); }
  catch (e) { problem = (e as Error).message; }
  const choosePreset = (id: string) => {
    setPresetId(id); setError('');
    const p = MAP_SENSOR_PRESETS.find(p => p.id === id);
    if (!p) return;
    setName(p.part ? `${p.label}` : p.label);
    setP1(String(p.pressure[0])); setP2(String(p.pressure[1])); setCeiling(String(p.ceiling));
    const volts = p.voltage ?? p.nativeInput!.map(v => v * 5 / 1023);
    setV1(volts[0].toFixed(6)); setV2(volts[1].toFixed(6)); setSupply('5');
  };
  const light = theme === 'light';
  const field = `mt-1 w-full rounded border px-2 py-1.5 ${light ? 'bg-white border-gray-300' : 'bg-black/30 border-white/20'}`;
  const bytes = (values: number[]) => values.map(v => v.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const compatible = matches.filter(m => (!sensor || m.curve) && (!diagnostics || m.diagnostics));
  const all = compatible.length > 1 && compatible.every(m => selected.has(m.bank.id));
  const apply = () => { if (plan) try { onApply(plan); onClose(); } catch (e) { setError((e as Error).message); } };
  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4" style={{ zIndex: 100000 }} onMouseDown={e => e.stopPropagation()}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="map-sensor-title"
        className={`w-full max-w-4xl max-h-[92vh] overflow-auto rounded-xl border p-5 shadow-2xl space-y-4 text-sm ${light ? 'bg-gray-50 border-gray-300 text-gray-900' : 'bg-[#151820] border-white/20 text-gray-100'}`}>
        <div className="flex items-center justify-between"><h2 id="map-sensor-title" className="font-semibold text-lg">MAP Sensor Calibration</h2>
          <button type="button" aria-label="Close MAP sensor calibration" onClick={onClose} className="px-2 py-1">✕</button></div>
        <p className="text-xs opacity-75">Finds supported sensor and diagnostic structures by pattern, including relocated layouts. All pressures are absolute mbar. Select the exact sensor model or enter its manufacturer calibration points.</p>
        <p className="text-xs">Found {matches.filter(m => m.curve).length} sensor curves and {matches.filter(m => m.diagnostics).length} diagnostic calibrations across {matches.length} scanned banks.</p>
        <label className="block font-medium">Sensor preset<select aria-label="MAP sensor preset" autoFocus className={field} value={presetId} onChange={e => choosePreset(e.target.value)}>
          <option value="custom">Current calibration / custom manufacturer points</option>
          {presetGroups.map(group => <option key={group.preset.id} value={group.preset.id}>{group.label}</option>)}
        </select></label>
        <p className="text-xs opacity-75 break-words">{preset?.source ?? 'Custom: enter two points from the exact sensor datasheet. Other brands can use this entry when their electrical interface and transfer curve are confirmed.'}</p>
        {preset?.curveBasis && <p className="text-xs">{preset.curveBasis}</p>}
        {preset?.fitment && <p className="text-xs opacity-75">{preset.fitment}</p>}
        {!preset && <label className="block text-xs">Manufacturer / part number<input className={field} aria-label="Custom sensor part number" value={name} onChange={e => setName(e.target.value)} /></label>}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <label>Low voltage (V)<input type="number" step="any" aria-label="Low sensor voltage" className={field} value={v1} disabled={!!preset} onChange={e => setV1(e.target.value)} /></label>
          <label>Low pressure (mbar)<input type="number" step="any" aria-label="Low sensor pressure" className={field} value={p1} disabled={!!preset} onChange={e => setP1(e.target.value)} /></label>
          <label>High voltage (V)<input type="number" step="any" aria-label="High sensor voltage" className={field} value={v2} disabled={!!preset} onChange={e => setV2(e.target.value)} /></label>
          <label>High pressure (mbar)<input type="number" step="any" aria-label="High sensor pressure" className={field} value={p2} disabled={!!preset} onChange={e => setP2(e.target.value)} /></label>
          <label>ADC reference (V)<input type="number" step="any" aria-label="ADC reference voltage" className={field} value={supply} disabled={!!preset} onChange={e => setSupply(e.target.value)} /></label>
        </div>
        {preset?.nativeInput && <p className="text-xs opacity-75">This file-reference preset uses exact stored input points {preset.nativeInput.join(' / ')}; displayed voltages are derived using a 5 V, 10-bit ADC.</p>}
        <div className="flex flex-wrap gap-4 items-center border-t border-current/20 pt-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={sensor} disabled={!matches.some(m => m.curve)} onChange={e => setSensor(e.target.checked)} />Sensor conversion{!matches.some(m => m.curve) && ' (pattern not found)'}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={diagnostics} disabled={!matches.some(m => m.diagnostics)} onChange={e => setDiagnostics(e.target.checked)} />Diagnostic / VCDS scaling{!matches.some(m => m.diagnostics) && ' (pattern not found)'}</label>
          <label className="text-xs">Diagnostic display ceiling (mbar)<input type="number" step="any" aria-label="Diagnostic display ceiling" className={field} value={ceiling} disabled={!diagnostics} onChange={e => setCeiling(e.target.value)} /></label>
        </div>
        {plan?.diagnostic && <p className="text-xs">Diagnostic format {plan.diagnostic.message}, multiplier {plan.diagnostic.multiplier}, internal factor {plan.diagnostic.scalar}; display range up to {plan.diagnostic.ceiling.toFixed(1)} mbar.</p>}
        <div className="space-y-2"><div className="flex flex-wrap gap-4 items-center"><h3 className="font-medium">Detected banks and calibration locations</h3>
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={all} disabled={compatible.length < 2} onChange={e => setSelected(e.target.checked ? new Set(compatible.map(m => m.bank.id)) : new Set())} />Apply to all matched banks (off by default)</label></div>
          {matches.map(match => {
            const available = (!sensor || !!match.curve) && (!diagnostics || !!match.diagnostics) && (sensor || diagnostics);
            return <label key={match.bank.id} className="flex gap-2 items-start rounded border border-current/20 p-2 text-xs">
              <input type="checkbox" checked={selected.has(match.bank.id)} disabled={!available} onChange={e => { const next = new Set(selected); if (e.target.checked) next.add(match.bank.id); else next.delete(match.bank.id); setSelected(next); }} />
              <span><b>{match.bank.label}</b><br />
                {match.curve ? `Sensor ${sensorHex(match.curve.address)}: ${match.curve.input.join(' / ')} ${match.curve.encoding === 'adc10' ? 'ADC counts' : 'mV'} → ${match.curve.pressure.join(' / ')} mbar` : 'Sensor pattern not verified'}<br />
                {match.diagnostics ? `Diagnostics ${match.diagnostics.addresses.map(sensorHex).join(', ')}; factor ${sensorHex(match.diagnostics.scalarAddress)} (${match.diagnostics.scalar})` : 'Diagnostic pattern not verified'}
                {match.notes.map(note => <span className="block opacity-70" key={note}>{note}</span>)}
              </span>
            </label>;
          })}
          {!matches.length && <p className="text-amber-400">This tool currently recognizes supported EDC15 layouts. No supported calibration patterns were found.</p>}
        </div>
        {plan && <details open><summary className="cursor-pointer font-medium">Before / after byte preview ({plan.patches.filter(p => p.before.some((b, i) => b !== p.after[i])).length} changed ranges)</summary>
          <div className="mt-2 max-h-52 overflow-auto space-y-1 font-mono text-xs">{plan.patches.map(p => <div key={p.address} className="p-2 rounded border border-current/10">
            <div>{sensorHex(p.address)} — {p.label}</div><div>{bytes(p.before)} → {bytes(p.after)}</div>
          </div>)}</div></details>}
        {(error || problem || readOnlyReason) && <p role="alert" className="text-amber-400">{error || readOnlyReason || problem}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="rounded border border-current/30 px-4 py-2" onClick={onClose}>Cancel</button>
          <button type="button" className="rounded bg-orange-600 text-white px-4 py-2 disabled:opacity-40" disabled={!plan || !!readOnlyReason || !plan.patches.some(p => p.before.some((b, i) => b !== p.after[i]))} onClick={apply}>Apply calibration</button></div>
      </section>
    </div>, document.body,
  );
}
