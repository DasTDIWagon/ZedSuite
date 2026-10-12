"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getModalGlassStyle } from "@/lib/modal-glass";
import type { MultimapSelector, MultimapVehicleConfiguration, MultimapSourceBank, MultimapBankInfo } from "@/lib/ecu/gn4308-multimap";
export function MultimapModal({ theme, busy, sourceBanks, includeUnsavedEdits, onIncludeUnsavedChange, onClose, onApply }: {
  theme: "default" | "light" | "oled"; busy: boolean; sourceBanks: MultimapBankInfo[]; includeUnsavedEdits: boolean; onIncludeUnsavedChange: (include: boolean) => void; onClose: () => void; onApply: (selector: MultimapSelector, initializeAllBanks: boolean, configuration: MultimapVehicleConfiguration, source: MultimapSourceBank) => Promise<void>;
}) {
  const [selector, setSelector] = useState<MultimapSelector>("cruise");
  const [initializeAllBanks, setInitializeAllBanks] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [configuration, setConfiguration] = useState<MultimapVehicleConfiguration | "">("");
  const [sourceBank, setSourceBank] = useState<MultimapSourceBank | "">("");
  const sourceInfo = sourceBanks.find(bank => bank.bank === sourceBank);
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={e => e.stopPropagation()}>
    <section role="dialog" aria-modal="true" aria-labelledby="multimap-title" className="w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4 rounded-lg border p-6 space-y-5" style={{ ...getModalGlassStyle(theme), color: theme === "light" ? "black" : "white" }}>
      <h2 id="multimap-title" className="text-xl font-bold">Multi-Map Beta</h2>
      <p className="text-sm">Currently applicable only to inspected FD4102, GN4308, GQ4307 and GK KD34 firmware profiles with a supported original bank layout, including edited calibration maps. Other ECUs are not supported until further testing is completed. GK uses a separate fingerprint, bank-ID checks and checksum compensation. Its selector runtime behavior remains unverified. Choose your vehicle configuration and the code block containing the tune to keep. Create and select a new version first.</p>
      <div role="alert" className="rounded-md border border-amber-500 bg-amber-500/10 p-3 text-sm space-y-2">
        <p className="font-bold">All multimap support is in the test phase.</p>
        <p>This includes FD, GN, GQ and GK. A working file or successful checksum check does not guarantee that another ECU or vehicle will work. Incorrect firmware can prevent starting, damage the ECU or cause unsafe vehicle operation. Use at your own risk. Keep an original backup and obtain qualified bench testing before flashing.</p>
      </div>
      <label className="block text-sm font-medium">Vehicle configuration (required)
        <select value={configuration} disabled={busy} className="block w-full mt-2 rounded-md border bg-transparent p-2" onChange={event => {
          const value = event.target.value as MultimapVehicleConfiguration | "";
          setConfiguration(value); setAcknowledged(false);
          if (value === "automatic") { setInitializeAllBanks(true); setSelector("brakeCruise"); }
        }}>
          <option value="">Choose your configuration</option>
          <option value="manual">Manual</option>
          <option value="automatic">Automatic</option>
          <option value="4x4" disabled>4×4 — no verified source bank available</option>
        </select>
      </label>
      <label className="flex gap-3 text-sm"><input type="checkbox" checked={includeUnsavedEdits} disabled={busy} onChange={event => { onIncludeUnsavedChange(event.target.checked); setAcknowledged(false); }} />Include unsaved edits</label>
      <p className="text-sm">{includeUnsavedEdits ? "Uses the selected version's current working data, including unsaved cell, axis and binary edits. Edits in other banks can still be overwritten by the chosen source." : "Uses the selected version's last saved data, including its saved tune. Unsaved edits are excluded and discarded from the working version when this conversion is applied. Save them or create a backup version first if you want to keep them."}</p>
      <label className="block text-sm font-medium">Source code block containing the tune to keep (required)
        <select value={sourceBank} disabled={busy} className="block w-full mt-2 rounded-md border bg-transparent p-2" onChange={event => {
          const value = event.target.value ? Number(event.target.value) as MultimapSourceBank : "";
          setSourceBank(value); setAcknowledged(false);
          if (value && value !== 1) setInitializeAllBanks(true);
        }}>
          <option value="">Choose the bank containing your tune</option>
          {([1, 2, 3] as const).map(bank => {
            const info = sourceBanks.find(entry => entry.bank === bank);
            return <option key={bank} value={bank} disabled={!info}>CB{bank}{info ? ` — ${info.marker} marker, ID ${info.bankID}` : " — unavailable"}</option>;
          })}
        </select>
      </label>
      <p className="text-sm">Choose where your actual tune is stored, regardless of factory labels. SG/AG markers do not tell us whether a bank is stock, tuned, or appropriate for your vehicle. Copies use the working or saved version selected above; no stock tables are downloaded or substituted. If you are unsure which bank contains your tune, cancel and compare the maps first.</p>
      {sourceInfo && <p role="status" className="text-sm font-medium">Source: CB{sourceInfo.bank} [0x{sourceInfo.start.toString(16).toUpperCase()}, 0x{sourceInfo.end.toString(16).toUpperCase()}). {initializeAllBanks ? `CB${sourceInfo.bank} is copied to all three selector banks. Calibration in the other two banks is overwritten.` : "CB1 is copied to CB2; CB3 is preserved."}</p>}
      {sourceInfo && configuration && ((configuration === "manual" && sourceInfo.marker === "AG") || (configuration === "automatic" && sourceInfo.marker === "SG")) && <p role="alert" className="text-sm text-amber-500">The source marker differs from the selected vehicle configuration. Your chosen source is still copied exactly; selecting a vehicle type does not convert transmission-specific calibration or communication settings. Verify that your tune already suits this vehicle.</p>}
      <label className="flex gap-3 text-sm"><input type="checkbox" checked={initializeAllBanks} disabled={busy || configuration === "automatic" || (sourceBank !== "" && sourceBank !== 1)} onChange={e => { setInitializeAllBanks(e.target.checked); setAcknowledged(false); }} />Initialize all three banks from the selected source (identical layouts and axes)</label>
      <p className="text-sm opacity-80">{initializeAllBanks ? "Copies the complete selected bank's axes, maps and configuration while retaining selector identifiers. Its table sizes are preserved: copying an SG 9×9 or AG 9×8 Start IQ table does not resize it. Checksum validity does not prove correct ECU operation." : "Manual with CB1 source only: replaces CB2 and preserves the original CB3 layout and calibration."}</p>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="font-medium mb-2">Map selector</legend>
        <label className="flex gap-3"><input type="radio" name="multimap-selector" disabled={configuration === "automatic"} checked={selector === "cruise"} onChange={() => setSelector("cruise")} />Clutch + cruise SET</label>
        <label className="flex gap-3"><input type="radio" name="multimap-selector" disabled={configuration === "automatic"} checked={selector === "brake"} onChange={() => setSelector("brake")} />Clutch + brake</label>
        <label className="flex gap-3"><input type="radio" name="multimap-selector" checked={selector === "brakeCruise"} onChange={() => setSelector("brakeCruise")} />Brake + cruise SET</label>
      </fieldset>
      {selector === "brakeCruise" && <p role="status" className="text-sm text-amber-500">Experimental selector derived from the supplied manual firmware. It does not read the clutch input. Operation on manual and automatic vehicles has not been verified.</p>}
      <p className="text-sm opacity-80">Use only with the engine stopped and ignition on: {selector === "brakeCruise" ? "hold the brake, then press and release cruise SET." : "hold the clutch, then press and release the selected control."} The tachometer temporarily indicates the selected bank. The correspondence between its 1,000/2,000/3,000 rpm indications and the editor's bank numbers requires verification for each profile.</p>
      <p role="alert" className="text-sm text-amber-500">This beta selector has no explicit engine-off guard. Do not operate the selector while cranking or while the engine is running.</p>
      <p className="text-sm opacity-80">All checksums are recalculated and verified. Files with different program code or an unsupported bank layout are refused. Vehicle operation has not been tested by ZedSuite.</p>
      <label className="flex gap-3 text-sm"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} />I confirm that the selected source contains the calibration I want to keep. I understand the other selected banks will be overwritten, all multimap support is experimental, and I use it at my own risk.</label>
      <div className="flex justify-end gap-3"><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !acknowledged || !configuration || !sourceInfo} onClick={() => { if (configuration && sourceBank) void onApply(selector, initializeAllBanks, configuration, sourceBank); }}>{busy ? "Applying…" : "Apply beta multimap"}</Button></div>
    </section>
  </div>;
}
