const fs=require('fs'),vm=require('vm'),assert=require('assert'),ts=require('typescript');
const root=require('path').resolve(__dirname,'..')+'/';
const moduleCache=new Map();
function mod(path){
 path=path.replace(/\\/g,'/');if(moduleCache.has(path))return moduleCache.get(path);
 const m={exports:{}};moduleCache.set(path,m.exports);
 const localRequire=spec=>spec.startsWith('.')?mod(require('path').posix.normalize(require('path').posix.join(require('path').posix.dirname(path),spec))+'.ts'):require(spec);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(root+path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:m.exports,module:m,require:localRequire});return m.exports;
}
const {findBankCounterparts:match}=mod('src/lib/map-bank-matching.ts');
const {updateAxisEdits:axes}=mod('src/lib/map-axis-edits.ts');
const {updateMapCellEdits:cells,rebaseMapCellEdits:rebase}=mod('src/lib/map-bank-edits.ts');
const layout=mod('src/lib/map-cell-layout.ts'),endian=mod('src/lib/ecu-endianness.ts');
let count=0;function check(name,f){f();console.log('PASS',name);count++;}
function table(address,bank,name='Test table',rows=2,cols=2){return {address,codeblock_id:bank,name,size:rows*cols*2,data_type:'UInt16',dimensions:{TwoDimensional:{rows,cols}},correction_factor:1};}
const a=table(0x100,1),b=table(0x200,2),c=table(0x300,3),maps=[a,b,c],data=Buffer.alloc(0x1000);
const defaults={maps,sourceAddress:a.address,data,previous:new Map(),enabled:true,bigEndian:false,flips:new Map(),correctionOf:m=>({correction:m.correction_factor??1,offset:m.offset??0})};
check('Name/layout/bank matching excludes unrelated and incompatible tables',()=>{const bad=[table(0x400,4,'Other table'),table(0x500,5,'Test table',1,4),{...table(0x600,6),external_source:'XDF'}];assert.deepEqual(Array.from(match([...maps,...bad],a),m=>m.address),[b.address,c.address]);});
check('Duplicate table names pair by ordinal, mismatched duplicate counts are excluded',()=>{const d=table(0x110,1),e=table(0x210,2),f=table(0x310,3),g=table(0x320,3);const ms=[a,d,b,e,c,f,g];assert.deepEqual(Array.from(match(ms,d),m=>m.address),[e.address]);});
check('Values OFF keeps edits in source bank only',()=>{const n=cells({...defaults,enabled:false,changedCells:{'0-0':5}});assert.equal(n.size,1);});
check('Values ON copies changed cells across three banks',()=>{const n=cells({...defaults,changedCells:{'0-0':5}});for(const m of maps)assert.equal(n.get(m.address)['0-0'],5);});
check('Only later edits copy, existing source edits are not copied retroactively',()=>{const previous=new Map([[a.address,{'0-0':5}],[b.address,{'0-1':7}]]);const n=cells({...defaults,previous,changedCells:{'0-0':5,'1-1':9}});assert.equal(n.get(b.address)['1-1'],9);assert.equal(n.get(b.address)['0-1'],7);assert.equal(n.get(b.address)['0-0'],undefined);assert.strictEqual(cells({...defaults,previous,changedCells:{'0-0':5}}),previous);});
check('Resetting source cells copies restored values and clears equal target edits',()=>{const previous=new Map(maps.map(m=>[m.address,{'0-0':5}]));const n=cells({...defaults,previous,changedCells:{}});assert.equal(n.size,0);});
check('Curve cells copy using one-dimensional layout',()=>{const aa={...a,size:6,dimensions:{OneDimensional:{length:3}}},bb={...b,size:6,dimensions:{OneDimensional:{length:3}}};const n=cells({...defaults,maps:[aa,bb],changedCells:{'0-2':77}});assert.equal(n.get(bb.address)['0-2'],77);});
function exporter(ms,bytes,edits,axisEdits=new Map(),flips=new Map(),bigEndian=false){
 const page=fs.readFileSync(root+'src/app/editor/page.tsx','utf8'),start=page.indexOf('  const applyEditsToFileData = useCallback(('),end=page.indexOf('}, [projectData, mapDisplaySettingsStore]);',start);
 const code=page.slice(start,end)+'}, [projectData, mapDisplaySettingsStore]);\nglobalThis.applyEdits=applyEditsToFileData;';
 const ctx={...layout,...endian,useCallback:f=>f,projectData:{ecu_type:bigEndian?'EDC16U1':'EDC15VM',detectionResults:{maps:ms}},mapDisplaySettingsStore:new Map(),mapAxesFlipRef:{current:flips}};
 vm.createContext(ctx);vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);const out=Buffer.from(bytes);ctx.applyEdits(out,edits,axisEdits);return out;
}
check('Signed values, different scales and opposite display flips export to corresponding file cells',()=>{
 const aa={...a,data_type:'Int16',correction_factor:0.01},bb={...b,data_type:'Int16',correction_factor:0.02},bytes=Buffer.alloc(data.length);
 [-100,-200,-300,-400].forEach((v,i)=>bytes.writeInt16LE(v,a.address+i*2));[-100,-100,-100,-100].forEach((v,i)=>bytes.writeInt16LE(v,b.address+i*2));
 const flips=new Map([[a.address,{rowsReversed:true,colsReversed:false}],[b.address,{rowsReversed:false,colsReversed:true}]]);
 const n=cells({...defaults,maps:[aa,bb],data:bytes,flips,changedCells:{'0-1':-0.5}});assert.equal(n.get(b.address)['1-0'],-0.5);
 const out=exporter([aa,bb],bytes,n,new Map(),flips);assert.equal(out.readInt16LE(a.address+6),-50);assert.equal(out.readInt16LE(b.address+6),-25);
 for(let i=0;i<bytes.length;i++)if(![a.address+6,a.address+7,b.address+6,b.address+7].includes(i))assert.equal(out[i],bytes[i]);
 const reset=cells({...defaults,maps:[aa,bb],data:bytes,flips,previous:n,changedCells:{}});assert.equal(reset.get(b.address)['1-0'],-4);
});
check('Opening a copied-to map with different flips preserves exported cell positions',()=>{const before={rowsReversed:true,colsReversed:false},after={rowsReversed:false,colsReversed:true};const original=new Map([[b.address,{'0-1':123}]]);const oldBytes=exporter(maps,data,original,new Map(),new Map([[b.address,before]]));const rebased=new Map([[b.address,rebase(b,original.get(b.address),before,after)]]);const newBytes=exporter(maps,data,rebased,new Map(),new Map([[b.address,after]]));assert.deepEqual(oldBytes,newBytes);});
check('Big-endian tables retain correct scaling and byte order',()=>{const aa={...a,correction_factor:0.1},bb={...b,correction_factor:0.5};const n=cells({...defaults,maps:[aa,bb],bigEndian:true,changedCells:{'1-0':125}});const out=exporter([aa,bb],data,n,new Map(),new Map(),true);assert.equal(out.readUInt16BE(a.address+4),1250);assert.equal(out.readUInt16BE(b.address+4),250);});
check('Scalar and 8-bit values can be copied',()=>{const aa={...a,size:1,data_type:'UInt8',dimensions:{TwoDimensional:{rows:1,cols:1}}},bb={...b,size:1,data_type:'UInt8',dimensions:{TwoDimensional:{rows:1,cols:1}}};const n=cells({...defaults,maps:[aa,bb],changedCells:{'0-0':128}});const out=exporter([aa,bb],data,n);assert.equal(out[a.address],128);assert.equal(out[b.address],128);});
check('Generic N75 axes use displayed-axis dimensions and independent X/Y switches',()=>{
 const aa={...table(0x100,1,'N75 duty cycle',16,13),x_axis_address:0x800,y_axis_address:0x900,x_axis_correction:1,y_axis_correction:0.01};const bb={...aa,address:0x300,codeblock_id:2,x_axis_address:0xa00,y_axis_address:0xb00};const ms=[aa,bb],bytes=Buffer.alloc(0x1000);
 for(const m of ms){const lo=layout.resolveMapCellLayout(m),src=layout.resolveAxisSources(m);for(const ax of ['x','y'])for(let i=0;i<(ax==='x'?lo.cols:lo.rows);i++)bytes.writeUInt16LE(100+i*100,src[ax].address+i*2);}
 const lo=layout.resolveMapCellLayout(aa),src=layout.resolveAxisSources(aa),labels=ax=>Array.from({length:ax==='x'?lo.cols:lo.rows},(_,i)=>String(bytes.readUInt16LE(src[ax].address+i*2)*src[ax].correction));
 const x=labels('x'),y=labels('y');x[x.length-1]='75';y[y.length-1]='60';
 for(const selected of ['x','y']){const n=axes({maps:ms,sourceAddress:aa.address,axes:{x,y},previous:new Map(),data:bytes,sourcesOf:layout.resolveAxisSources,copyOtherBanks:{x:selected==='x',y:selected==='y'}});assert(n.get(bb.address)[selected]);assert.equal(n.get(bb.address)[selected==='x'?'y':'x'],undefined);const out=exporter(ms,bytes,new Map(),n);const targetSource=layout.resolveAxisSources(bb)[selected],v=selected==='x'?75:60;assert.equal(out.readUInt16LE(targetSource.address+((selected==='x'?x:y).length-1)*2),Math.round(v/targetSource.correction));}
});
console.log(`${count} general bank-copy checks passed.`);
