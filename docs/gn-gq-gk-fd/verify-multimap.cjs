'use strict';
// Usage: node verify-multimap.cjs <ZedSuite source root> <fixtures.json>
// fixtures.json is an object mapping GN, FD, GQ, GK to local file paths.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const source=path.resolve(process.argv[2] || '.');
const fixtures=JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const ts=require(path.join(source,'node_modules/typescript'));
function compile(file, requireFn=require) {
  const text=fs.readFileSync(path.join(source,file),'utf8');
  const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};new Function('require','exports','module',js)(requireFn,module.exports,module);return module.exports;
}
const engine=compile('src/lib/ecu/bosch/checksums/edc15p-checksum.ts');
const api=compile('src/lib/ecu/gn4308-multimap.ts',name=>name==='@/lib/ecu/bosch/checksums/edc15p-checksum'?engine:require(name));
const checksumWords=new Set([0xfffc,0x13ffc,0x4fffc,0x50b7c,0x5bffc,0x5fffc,0x60b7c,0x6bffc,0x6fffc,0x70b7c,0x7bffc]);
const report={scope:'Offline source-level validation, no ECU/vehicle execution',cases:[]};
(async()=>{
  for(const label of ['GN','FD','GQ','GK']) {
    assert.ok(fixtures[label], 'Missing fixture '+label);
    const input=fs.readFileSync(fixtures[label]);const snapshot=Buffer.from(input);
    for(const method of ['cruise','brake','brakeCruise'])for(const cloneAll of [false,true]) {
      const output=await api.applyGN4308Multimap(input,method,cloneAll,'manual',1);
      assert.ok(input.equals(snapshot),'Input mutated');
      const info=engine.correctEDC15PChecksum([...output]).info;
      assert.equal(info.result,'OK');assert.equal(info.matched,11);assert.equal(info.fixed,0);
      for(let i=0x4c000;i<0x5c000;i++) if(!checksumWords.has(i&~3))assert.equal(output[i],input[i]);
      if(!cloneAll)for(let i=0x6c000;i<0x7c000;i++)if(!checksumWords.has(i&~3))assert.equal(output[i],input[i]);
      for(const bank of cloneAll?[0x5c000,0x6c000]:[0x5c000])for(let off=0;off<0x10000;off++) {
        if(checksumWords.has((bank+off)&~3)||off===0x5bf0||off===0x5bf1)continue;
        assert.equal(output[bank+off],input[0x4c000+off]);
      }
      assert.equal(output[0x71bf0],input[0x71bf0]);assert.equal(output[0x71bf1],input[0x71bf1]);
      for(let i=0;i<output.length;i++)if(output[i]!==input[i]) {
        assert.ok((i>=0x5c000&&i<0x6c000)||(cloneAll&&i>=0x6c000&&i<0x7c000)||
          (i>=0x14764&&i<0x14768)||(i>=0x1a000&&i<0x1a08e)||(i>=0x4bffc&&i<0x4c000)||checksumWords.has(i&~3),'Unexpected mutation '+i.toString(16));
      }
      if(cloneAll)assert.deepEqual(await api.applyGN4308Multimap(output,method,true,'manual',1),output);
      else await assert.rejects(api.applyGN4308Multimap(output,method,false,'manual',1));
      report.cases.push({profile:label,selector:method,initializeAllBanks:cloneAll,checksums:info,result:'PASS'});
    }
    for(const address of [0x14000,0x14764,0x1a000,0x50001,0x70001,0x51bf0,0x71bf0]) {
      const bad=Buffer.from(input);bad[address]^=1;await assert.rejects(api.applyGN4308Multimap(bad,'cruise',false,'manual',1));
    }
    await assert.rejects(api.applyGN4308Multimap(input.subarray(0,100),'cruise',false,'manual',1));
    await assert.rejects(api.applyGN4308Multimap(input,'unknown',false,'manual',1));
  }
  report.configurationCases=[];
  report.configurationRejections=0;
  const mapDump=JSON.parse(fs.readFileSync(path.join(__dirname,'Map_Dump.json'),'utf8'));
  const labels={GN:'GN4308 OEM',FD:'FD4102 supplied',GQ:'GQ4307 stock',GK:'GK KD34 stock'};
  for(const label of ['GN','FD','GQ','GK']) {
    const input=fs.readFileSync(fixtures[label]);
    const banks=api.getMultimapSourceBanks(input);
    assert.deepEqual(banks.map(bank=>bank.bank),label==='FD'?[1,2,3]:[1,3]);
    assert.equal(banks[0].marker,'SG');assert.equal(banks[banks.length-1].marker,'AG');
    const maps=mapDump.find(entry=>entry.fixture===labels[label]);
    assert.ok(maps,'Missing map annotations for '+label);
    for(const bank of banks)for(const [configuration,methods] of [['manual',['cruise','brake','brakeCruise']],['automatic',['brakeCruise']]])for(const method of methods) {
      const tuned=Buffer.from(input);
      const map=maps.selected_maps.find(map=>map.address>=bank.start&&map.address<bank.end&&map.name==='Start IQ');
      assert.ok(map,'No annotated Start IQ in source '+label+' CB'+bank.bank);
      tuned[map.address]^=1; // Deliberate cell edit, not a metadata/identifier change.
      const snapshot=Buffer.from(tuned);
      const output=await api.applyGN4308Multimap(tuned,method,true,configuration,bank.bank);
      assert.deepEqual(tuned,snapshot,'Conversion mutated input');
      const replay=Buffer.from(input);
      for(const [address,change]of api.buildMultimapVersionChanges(input,output))replay[address]=change.newValue;
      assert.deepEqual(replay,Buffer.from(output),'Saved version delta does not reproduce generated file');
      const info=engine.correctEDC15PChecksum([...output]).info;
      assert.equal(info.result,'OK');assert.equal(info.matched,11);assert.equal(info.fixed,0);
      for(const target of [0x4c000,0x5c000,0x6c000])for(let offset=0;offset<0x10000;offset++) {
        if(checksumWords.has((target+offset)&~3)||offset===0x5bf0||offset===0x5bf1)continue;
        assert.equal(output[target+offset],tuned[bank.start+offset],'Selected tune not preserved');
      }
      assert.equal(output[0x51bf0],input[0x51bf0]);assert.equal(output[0x61bf0],3);assert.equal(output[0x71bf0],input[0x71bf0]);
      assert.equal(output[map.address],tuned[map.address]);
      for(const again of [1,2,3])assert.deepEqual(await api.applyGN4308Multimap(output,method,true,configuration,again),output);
      report.configurationCases.push({profile:label,configuration,selector:method,sourceBank:bank.bank,sourceMarker:bank.marker,tunedCellOffset:'0x'+map.address.toString(16),tunePreservation:'PASS',allSourceReinitializations:'PASS',checksums:info,result:'PASS'});
    }
    for(const args of [
      [input,'brakeCruise',true,'4x4',1],
      [input,'cruise',true,'automatic',1],
      [input,'brakeCruise',false,'automatic',3],
      [input,'cruise',false,'manual',3],
      [input,'cruise',true,'unknown',1],
      [input,'cruise',true,'manual',0],
      [input,'cruise',true,'manual',4],
      [input,'cruise',true,undefined,1],
      [input,'cruise',true,'manual',undefined]
    ]) { await assert.rejects(api.applyGN4308Multimap(...args));report.configurationRejections++; }
    const malformed=Buffer.from(input);malformed.fill(0,0x738d4,0x73938);
    await assert.rejects(api.applyGN4308Multimap(malformed,'brakeCruise',true,'automatic',3));report.configurationRejections++;
    if(label!=='FD') {await assert.rejects(api.applyGN4308Multimap(input,'cruise',true,'manual',2));report.configurationRejections++;}
  }
  report.savedWorkingCases=[];
  for(const label of ['GN','FD','GQ','GK']) {
    const rawBase=fs.readFileSync(fixtures[label]);
    const maps=mapDump.find(entry=>entry.fixture===labels[label]);
    const cell=maps.selected_maps.find(map=>map.address>=0x4c000&&map.address<0x5c000&&map.name==='Start IQ').address;
    const saved=Buffer.from(rawBase);saved[cell]^=1;
    const working=Buffer.from(saved);working[cell]^=2;
    working[cell+0x20000]^=8; // An unsaved target-bank edit must not override the selected source.
    for(const includeUnsavedEdits of [false,true]) {
      const chosen=includeUnsavedEdits?working:saved;
      const output=await api.applyGN4308Multimap(chosen,'cruise',true,'manual',1);
      for(const offset of [0,0x10000,0x20000])assert.equal(output[cell+offset],chosen[cell]);
      assert.notEqual(output[cell],rawBase[cell],'Saved tune replaced with stock data');
      const replay=Buffer.from(rawBase);
      for(const [address,change]of api.buildMultimapVersionChanges(rawBase,output))replay[address]=change.newValue;
      assert.deepEqual(replay,Buffer.from(output));
      // Imported versions can differ from the original project: returning a byte
      // to the original value still needs a saved change relative to their base.
      const importedBase=Buffer.from(rawBase);importedBase[cell]=output[cell]^4;
      const importedReplay=Buffer.from(importedBase);
      for(const [address,change]of api.buildMultimapVersionChanges(importedBase,output))importedReplay[address]=change.newValue;
      assert.deepEqual(importedReplay,Buffer.from(output));
      report.savedWorkingCases.push({profile:label,includeUnsavedEdits,savedTuneRetained:'PASS',targetEditDoesNotOverrideSource:'PASS',versionDeltaReplay:'PASS',importedVersionReplay:'PASS',result:'PASS'});
    }
  }
  report.result='PASS';report.conversionCases=report.cases.length;report.rejectionCases=36;
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
