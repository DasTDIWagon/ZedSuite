const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=require('path').resolve(__dirname,'..')+'/';
const ts=require(root+'node_modules/typescript');
const moduleCache=new Map();
function mod(path){
 path=path.replace(/\\/g,'/');if(moduleCache.has(path))return moduleCache.get(path);
 const m={exports:{}};moduleCache.set(path,m.exports);
 const localRequire=spec=>spec.startsWith('.')?mod(require('path').posix.normalize(require('path').posix.join(require('path').posix.dirname(path),spec))+'.ts'):require(spec);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(root+path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:m.exports,module:m,require:localRequire});return m.exports;
}
const cal=mod('src/lib/map-sensor-calibration.ts');
const checksum=mod('src/lib/ecu/bosch/checksums/edc15p-checksum.ts');
const path=require('path');
const manifest=process.argv[2];if(!manifest)throw new Error('Usage: node tests/map-sensor-corpus.cjs <manifest.json> <corpus-directory> [results.json]');
const rows=JSON.parse(fs.readFileSync(manifest,'utf8'));
const corpus=process.argv[3];if(!corpus)throw new Error('Supply the extracted 25-reference corpus directory.');
const crypto=require('crypto');let cases=0;const results=[];
function equal(a,b){assert.deepEqual(Buffer.from(a),Buffer.from(b));}
for(const row of rows){
 const input=fs.readFileSync(path.join(corpus,row.filename)),data=Array.from(input);assert.equal(crypto.createHash('sha256').update(input).digest('hex'),row.sha256);
 const matches=cal.detectMapSensorCalibration(data,'EDC15VM');assert.equal(matches.length,row.inspected_curves.length);assert(matches.every(m=>m.curve&&m.diagnostics));
 equal(matches.map(m=>m.curve.address).sort((a,b)=>a-b).flatMap(p=>[p&255,p>>8&255,p>>16]),row.inspected_curves.map(m=>m.pressure_offset).sort((a,b)=>a-b).flatMap(p=>[p&255,p>>8&255,p>>16]));
 const originalStatus=checksum.verifyEDC15PChecksum(data);assert.equal(originalStatus.result,'OK');assert.equal(originalStatus.matched,originalStatus.found);equal(checksum.correctEDC15PChecksum(data).correctedData,data);
 const ids=matches.map(m=>m.bank.id),stock=cal.MAP_SENSOR_PRESETS[0];
 const ends=originalStatus.variant==='tdi41_2002'?[0xfffc,0x13ffc,0x4fffc,0x50b7c,0x5bffc,0x5fffc,0x60b7c,0x6bffc,0x6fffc,0x70b7c,0x7bffc]:originalStatus.variant==='tdi41v2'?[0x13ffc,0x57ffc,0x58b7c,0x63ffc,0x6fffc,0x70b7c,0x7bffc]:[0x13ffc,0x4bffc,0x4fffc,0x50b7c,0x5bffc,0x5fffc,0x60b7c,0x6bffc,0x6fffc,0x70b7c,0x7bffc];
 const checksumAllowed=new Set(ends.filter(p=>input.readUInt32LE(p)!==0xc3c3c3c3).flatMap(p=>[p,p+1,p+2,p+3]));const presetResults=[];
 function run(preset,selected,options){
  const plan=cal.planMapSensorCalibration(data,matches,selected,preset,options),out=cal.applyMapSensorPlan(data,plan),allowed=new Set(plan.patches.flatMap(p=>p.after.map((_,i)=>p.address+i)));
  let changed=0;for(let i=0;i<data.length;i++)if(data[i]!==out[i]){assert(allowed.has(i));changed++;}
  const found=cal.detectMapSensorCalibration(out,'EDC15VM');assert.equal(found.length,matches.length);
  const expected=preset.nativeInput??preset.voltage.map(v=>Math.round(v*1023/5)),diag=cal.diagnosticCalibration(preset.ceiling);
  for(let i=0;i<found.length;i++){
   const m=found[i];assert(m.curve&&m.diagnostics);const chosen=selected.includes(m.bank.id);
   assert.deepEqual(Array.from(m.curve.input),Array.from(chosen&&options.sensor?expected:matches[i].curve.input));assert.deepEqual(Array.from(m.curve.pressure),Array.from(chosen&&options.sensor?preset.pressure:matches[i].curve.pressure));
   for(const k of ['message','multiplier','scalar'])assert.equal(m.diagnostics[k],chosen&&options.diagnostics?diag[k]:matches[i].diagnostics[k]);
  }
  const corrected=checksum.correctEDC15PChecksum(out),verified=checksum.verifyEDC15PChecksum(corrected.correctedData);assert.equal(verified.result,'OK');assert.equal(verified.found,verified.matched);assert.equal(verified.variant,originalStatus.variant);
  let checksumBytes=0;for(let i=0;i<out.length;i++)if(out[i]!==corrected.correctedData[i]){assert(checksumAllowed.has(i),row.ecu+' unexpected checksum byte '+i.toString(16));checksumBytes++;}
  const finalMatches=cal.detectMapSensorCalibration(corrected.correctedData,'EDC15VM');assert(finalMatches.every(m=>m.curve&&m.diagnostics));
  const restored=cal.applyMapSensorPlan(out,cal.planMapSensorCalibration(out,found,selected,stock,options));equal(restored,data);
  const restoredCorrected=cal.applyMapSensorPlan(corrected.correctedData,cal.planMapSensorCalibration(corrected.correctedData,finalMatches,selected,stock,options));equal(checksum.correctEDC15PChecksum(restoredCorrected).correctedData,data);
  cases++;return {preset:preset.part,calibration_bytes:changed,checksum_bytes:checksumBytes,verified};
 }
 for(const preset of cal.MAP_SENSOR_PRESETS)presetResults.push(run(preset,ids,{sensor:true,diagnostics:true}));
 for(const m of matches)run(cal.MAP_SENSOR_PRESETS[2],[m.bank.id],{sensor:true,diagnostics:true});
 for(const sensor of [false,true])run(cal.MAP_SENSOR_PRESETS[2],ids,{sensor,diagnostics:!sensor});
 results.push({ecu:row.ecu,software:row.software,sha256:row.sha256,banks:matches.length,original_checksum:originalStatus,presets:presetResults,matches});
 console.log(`PASS ${row.ecu} ${row.software}: ${matches.length} bank(s), 3 presets, single-bank isolation, independent sections, exact stock restore; ${originalStatus.matched}/${originalStatus.found} checksums (${originalStatus.variant})`);
}
if(process.argv[4])fs.writeFileSync(process.argv[4],JSON.stringify({cases,files:results},null,2));console.log(`${cases} real-file cases passed across 25 inputs; original files unchanged.`);
