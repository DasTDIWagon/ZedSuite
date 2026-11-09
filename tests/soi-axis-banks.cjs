const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('typescript');
const root=require('path').resolve(__dirname,'..')+'/';
const moduleCache=new Map();
function mod(path){
 path=path.replace(/\\/g,'/');if(moduleCache.has(path))return moduleCache.get(path);
 const m={exports:{}};moduleCache.set(path,m.exports);
 const localRequire=spec=>spec.startsWith('.')?mod(require('path').posix.normalize(require('path').posix.join(require('path').posix.dirname(path),spec))+'.ts'):require(spec);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(root+path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:m.exports,module:m,require:localRequire});return m.exports;
}
const {updateAxisEdits:update}=mod('src/lib/map-axis-edits.ts');
const layout=mod('src/lib/map-cell-layout.ts'),endian=mod('src/lib/ecu-endianness.ts');
function fixture(three=false){
 const data=Buffer.alloc(0x80000),maps=[];
 const temps=[-20,-10,0,4,10,20,50,70,81,86];
 const rpm=[0,819,987,1239,1491,1743,1995,2247,2499,2730,2982,3234,3738,3990,4494,5355];
 for(const [bank,base] of (three?[[1,0x58000],[2,0x68000],[3,0x78000]]:[[1,0x58000],[2,0x78000]])){
  const iq=base===0x78000?[0,300,600,1200,1600,1800,2000,2200,2400,2600,2800,3200,3600,4000]:[200,320,600,960,1200,1600,1800,2000,2200,2400,2600,2800,3200,3600];
  iq.forEach((v,i)=>data.writeUInt16LE(v,base+0x166+i*2));
  rpm.forEach((v,i)=>data.writeUInt16LE(v,base+0x142+i*2));
  temps.forEach((temp,i)=>maps.push({name:`Start of injection (SOI) ${temp}°C`,address:base+0xa82+i*448,
   size:448,data_type:'Int16',codeblock_id:bank,dimensions:{TwoDimensional:{rows:16,cols:14}},
   x_axis_address:base+0x166,y_axis_address:base+0x142,x_axis_correction:0.01,y_axis_correction:1}));
 }
 return {data,maps};
}
const {maps,data}=fixture(),source=0x58e02,target=0x78e02;
const labels=(address,axis='x')=>{const m=maps.find(m=>m.address===address),s=layout.resolveAxisSources(m)[axis];return Array.from({length:axis==='x'?14:16},(_,i)=>String(data.readUInt16LE(s.address+i*2)*s.correction+s.offset));};
const opts={maps,data,sourceAddress:source,sourcesOf:layout.resolveAxisSources};
const apply=(previous,axes,enabled=false)=>update({...opts,previous,axes,copyOtherBanks:enabled});
let checks=0;function check(name,f){f();console.log('PASS',name);checks++;}
const x=labels(source);x[13]='75';
let off,on;
check('OFF edits all ten aliases in source bank, no other bank',()=>{off=apply(new Map(),{x});assert.equal(off.size,10);assert.equal(off.get(source).x[13],'75');assert(!off.has(target));});
check('ON copies only changed points; preserves target-bank breakpoints',()=>{on=apply(new Map(),{x},true);assert.equal(on.size,20);assert.equal(on.get(target).x[13],'75');assert.equal(on.get(target).x[0],'0');assert.equal(on.get(source).x[0],'2');});
check('Enabling switch does not retroactively copy earlier edits',()=>{const next=apply(off,{x},true);assert.strictEqual(next,off);});
check('Later edit copies new point only, not earlier bank-only edit',()=>{const xx=[...x];xx[0]='1';const next=apply(off,{x:xx},true);assert.equal(next.get(target).x[0],'1');assert.equal(next.get(target).x[13],'40');});
check('Disabling switch preserves copied changes but stops future copying',()=>{const xx=[...x];xx[13]='80';const next=apply(on,{x:xx},false);assert.equal(next.get(source).x[13],'80');assert.equal(next.get(target).x[13],'75');});
check('Repeated callbacks do not recopy or create a state loop',()=>{assert.strictEqual(apply(on,{x},true),on);const targetAxes=on.get(target);const next=update({...opts,sourceAddress:target,previous:on,axes:targetAxes,copyOtherBanks:true});assert.strictEqual(next,on);});
check('Reset copies restored value only; keeps unrelated target points',()=>{const next=apply(on,{x:[]},true);assert(!next.has(source));assert.equal(next.get(target).x[13],'36');assert.equal(next.get(target).x[0],'0');});
check('RPM edits copy independently and leave IQ edits intact',()=>{const y=labels(source,'y');y[15]='5500';const next=apply(on,{y},true);assert.equal(next.get(target).y[15],'5500');assert.equal(next.get(target).x[13],'75');});
check('Different dimensions and imported counterparts are excluded',()=>{for(const bad of [{external_source:'XDF'},{dimensions:{TwoDimensional:{rows:1,cols:14}}}]){const changed=maps.map(m=>m.codeblock_id===2?{...m,...bad}:m);const next=update({...opts,maps:changed,previous:new Map(),axes:{x},copyOtherBanks:true});assert(!next.has(target));}});
check('Three-bank fixture updates all three physical IQ axes',()=>{const r=fixture(true),b=r.data;const next=update({...opts,maps:r.maps,data:b,previous:new Map(),axes:{x},copyOtherBanks:true});for(const a of [0x58e02,0x68e02,0x78e02])assert.equal(next.get(a).x[13],'75');assert.equal(next.size,30);});
check('Frontend-normalized SOI names also support cross-bank copying',()=>{const stripped=maps.map(m=>({...m,name:m.name.replace(' (SOI)','')}));const next=update({...opts,maps:stripped,previous:new Map(),axes:{x},copyOtherBanks:true});assert.equal(next.get(target).x[13],'75');assert.equal(next.size,20);});
const page=fs.readFileSync(root+'src/app/editor/page.tsx','utf8'),start=page.indexOf('  const applyEditsToFileData = useCallback(('),end=page.indexOf('}, [projectData, mapDisplaySettingsStore]);',start);
const code=page.slice(start,end)+'}, [projectData, mapDisplaySettingsStore]);\nglobalThis.applyEdits=applyEditsToFileData;';
for(const [name,edits,expectedOffsets] of [['OFF',off,[0x58180,0x58181]],['ON',on,[0x58180,0x58181,0x78180,0x78181]]]){
 check(`Actual exporter ${name}: only expected bank bytes change`,()=>{const ctx={...layout,...endian,useCallback:f=>f,projectData:{ecu_type:'EDC15VM',detectionResults:{maps}},mapDisplaySettingsStore:new Map(),mapAxesFlipRef:{current:new Map()}};vm.createContext(ctx);vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);const out=Buffer.from(data);ctx.applyEdits(out,new Map(),edits);const diff=[];for(let i=0;i<out.length;i++)if(out[i]!==data[i])diff.push(i);assert.deepEqual(diff,expectedOffsets);assert.equal(out.readUInt16LE(0x58180),7500);assert.equal(out.readUInt16LE(0x78180),name==='ON'?7500:4000);});
}
console.log(`${checks} bank-toggle checks passed.`);
