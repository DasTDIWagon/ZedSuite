const fs=require('fs'),vm=require('vm'),assert=require('assert'),ts=require('typescript');
const root=require('path').resolve(__dirname,'..')+'/';
const moduleCache=new Map();
function mod(path){
 path=path.replace(/\\/g,'/');if(moduleCache.has(path))return moduleCache.get(path);
 const m={exports:{}};moduleCache.set(path,m.exports);
 const localRequire=spec=>spec.startsWith('.')?mod(require('path').posix.normalize(require('path').posix.join(require('path').posix.dirname(path),spec))+'.ts'):require(spec);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(root+path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:m.exports,module:m,require:localRequire});return m.exports;
}
const cal=mod('src/lib/map-sensor-calibration.ts');
const {stageSensorCalibration:stage}=mod('src/lib/calibration-stage.ts');
const layout=mod('src/lib/map-cell-layout.ts'),endian=mod('src/lib/ecu-endianness.ts');
let total=0;function check(name,f){f();console.log('PASS',name);total++;}
const descriptors=Buffer.from('00 0f 27 33 80 0f 15 14 20 0f 21 ff 60 0f 31 c8 30 0f 12 ff 42 0f 12 ff 40 0f 1f c7 95 0f 06 4c 65 0f 05 09 02 0f 05 09 01 0f 05 09 01 0f 27 33 86 0f 1b 16 52 0f 1b 16 50 0f 15 14 21 0f 12 ff 63 0f 31 c8 32 0f 31 c8'.replaceAll(' ',''),'hex');
const scalars=Buffer.from('c80000001400000064000000d4030000ec040000090000005000000064000000','hex');
const curve=Buffer.from('9cdc02005200dd03c800280a','hex');
const signature=Buffer.from('67ffffffffffff56342e31','hex');
function fixture(count=3){
 const data=Buffer.alloc(0x80000,0xc3),locations=[];
 for(const start of [0x4c000,0x5c000,0x6c000].slice(0,count)){
  signature.copy(data,start+0x4001);
  const d=start+0x2302,f=start+0x3454,c=start+0x44b0;
  descriptors.copy(data,d);scalars.copy(data,f);curve.copy(data,c);
  locations.push({start,d,f,c});
 }
 return {data,locations};
}
const stock=cal.MAP_SENSOR_PRESETS.find(p=>p.id==='stock-gn'),four=cal.SUPPLIED_MAP_SENSOR_REFERENCE;
check('Relocated sensor/diagnostic/scalar patterns detected in three signed banks',()=>{const {data,locations}=fixture(),ms=cal.detectMapSensorCalibration(data,'EDC15VM');assert.equal(ms.length,3);ms.forEach((m,i)=>{assert.equal(m.curve.address,locations[i].c+8);assert.equal(m.diagnostics.addresses[0],locations[i].d+18);assert.equal(m.diagnostics.scalarAddress,locations[i].f+12);});});
check('RAM addresses are masked while record types remain required',()=>{const {data,locations:[l]}=fixture(1);for(let i=0;i<18;i++)data.writeUInt16LE(0x1100+i*2,l.d+i*4);assert(cal.detectMapSensorCalibration(data,'EDC15P')[0].diagnostics);data[l.d+2]=0x28;assert(!cal.detectMapSensorCalibration(data,'EDC15P')[0].diagnostics);});
check('Bare 18 FF occurrences and unrelated scalar words do not match',()=>{const data=Buffer.alloc(0x4000);for(const p of [100,200,300])data.set([18,255],p);data.writeUInt16LE(980,1000);const ms=cal.detectMapSensorCalibration(data,'EDC15VM');assert(ms.every(m=>!m.diagnostics&&!m.curve));});
check('Unknown ECU families are rejected',()=>assert.equal(cal.detectMapSensorCalibration(fixture().data,'EDC17').length,0));
check('Missing middle-bank signature does not create an editable middle bank',()=>{const {data}=fixture();data.fill(0xc3,0x5c000,0x6c000);assert.equal(cal.detectMapSensorCalibration(data,'EDC15VM').length,2);});
check('Duplicate sensor patterns are rejected as ambiguous',()=>{const {data,locations:[l]}=fixture(1);curve.copy(data,l.start+0x5000);const ms=cal.detectMapSensorCalibration(data,'EDC15VM');assert(!ms[0].curve);assert.throws(()=>cal.planMapSensorCalibration(data,ms,[ms[0].bank.id],four,{sensor:true,diagnostics:false}));});
check('Duplicate diagnostic groups and inconsistent factors are rejected',()=>{for(const duplicate of [false,true]){const {data,locations:[l]}=fixture(1);if(duplicate)descriptors.copy(data,l.start+0x1800);else data.writeUInt16LE(637,l.f+12);assert(!cal.detectMapSensorCalibration(data,'EDC15VM')[0].diagnostics);}});
check('Diagnostic calculations reproduce stock, 3-bar and supplied 4-bar factors',()=>{assert.deepEqual(JSON.parse(JSON.stringify(cal.diagnosticCalibration(2601))),{message:18,multiplier:255,scalar:980,ceiling:2601});const three=cal.diagnosticCalibration(3060),four=cal.diagnosticCalibration(4000);assert.equal(three.multiplier,120);assert.equal(three.scalar,833);assert.equal(four.multiplier,157);assert.equal(four.scalar,637);assert.equal(four.ceiling,4003.5);});
check('Selecting one bank preserves all other banks and unrelated bytes',()=>{const {data}=fixture(),ms=cal.detectMapSensorCalibration(data,'EDC15VM');const plan=cal.planMapSensorCalibration(data,ms,[ms[0].bank.id],four,{sensor:true,diagnostics:true});const out=cal.applyMapSensorPlan(Array.from(data),plan),allowed=new Set(plan.patches.flatMap(p=>p.after.map((_,i)=>p.address+i)));for(let i=0;i<data.length;i++)if(!allowed.has(i))assert.equal(out[i],data[i]);assert.equal(cal.detectMapSensorCalibration(out,'EDC15VM')[1].diagnostics.scalar,980);});
check('All-bank 4-bar reference and stock restoration round-trip exactly',()=>{const {data}=fixture(),ms=cal.detectMapSensorCalibration(data,'EDC15VM'),ids=ms.map(m=>m.bank.id);const out=cal.applyMapSensorPlan(Array.from(data),cal.planMapSensorCalibration(data,ms,ids,four,{sensor:true,diagnostics:true}));const changed=cal.detectMapSensorCalibration(out,'EDC15VM');changed.forEach(m=>{assert.deepEqual(Array.from(m.curve.pressure),[400,4300]);assert.equal(m.diagnostics.scalar,637);});const restored=cal.applyMapSensorPlan(out,cal.planMapSensorCalibration(out,changed,ids,stock,{sensor:true,diagnostics:true}));assert.deepEqual(Buffer.from(restored),data);});
check('Sensor-only and diagnostics-only sections are independent',()=>{const {data}=fixture(1),ms=cal.detectMapSensorCalibration(data,'EDC15VM'),ids=[ms[0].bank.id];for(const sensor of [true,false]){const plan=cal.planMapSensorCalibration(data,ms,ids,four,{sensor,diagnostics:!sensor});const out=cal.detectMapSensorCalibration(cal.applyMapSensorPlan(Array.from(data),plan),'EDC15VM')[0];assert.equal(out.curve.pressure[0],sensor?400:200);assert.equal(out.diagnostics.scalar,sensor?980:637);}});
check('Manufacturer presets encode their voltage and pressure points',()=>{const {data}=fixture(1),ms=cal.detectMapSensorCalibration(data,'EDC15VM');for(const id of ['bosch-3','bosch-4']){const p=cal.MAP_SENSOR_PRESETS.find(p=>p.id===id),plan=cal.planMapSensorCalibration(data,ms,[ms[0].bank.id],p,{sensor:true,diagnostics:true});const out=cal.detectMapSensorCalibration(cal.applyMapSensorPlan(Array.from(data),plan),'EDC15VM')[0];assert.deepEqual(Array.from(out.curve.input),Array.from(p.voltage,v=>Math.round(v*1023/5)));assert.deepEqual(Array.from(out.curve.pressure),Array.from(p.pressure));}});
check('Custom manufacturer points and invalid ranges are checked',()=>{const {data}=fixture(1),ms=cal.detectMapSensorCalibration(data,'EDC15VM'),ids=[ms[0].bank.id];const custom={id:'custom',label:'Custom',source:'Test',voltage:[0.5,4.5],pressure:[500,4000],ceiling:4000};const out=cal.detectMapSensorCalibration(cal.applyMapSensorPlan(Array.from(data),cal.planMapSensorCalibration(data,ms,ids,custom,{sensor:true,diagnostics:true})),'EDC15VM')[0];assert.deepEqual(Array.from(out.curve.input),[102,921]);for(const bad of [{...custom,voltage:[4.5,0.5]},{...custom,pressure:[500,70000]},{...custom,ceiling:7000}])assert.throws(()=>cal.planMapSensorCalibration(data,ms,ids,bad,{sensor:true,diagnostics:true}));});
check('Stale byte previews and overlapping patches fail atomically',()=>{const {data}=fixture(1),ms=cal.detectMapSensorCalibration(data,'EDC15VM'),plan=cal.planMapSensorCalibration(data,ms,[ms[0].bank.id],four,{sensor:true,diagnostics:true});const changed=Array.from(data);changed[plan.patches[0].address]^=1;const before=[...changed];assert.throws(()=>cal.applyMapSensorPlan(changed,plan));assert.deepEqual(changed,before);assert.throws(()=>cal.applyMapSensorPlan(Array.from(data),{patches:[plan.patches[0],plan.patches[0]]}));});
function exporter(ms,bytes,edits,axisEdits=new Map(),flips=new Map(),bigEndian=false){
 const page=fs.readFileSync(root+'src/app/editor/page.tsx','utf8'),start=page.indexOf('  const applyEditsToFileData = useCallback(('),end=page.indexOf('}, [projectData, mapDisplaySettingsStore]);',start);
 const code=page.slice(start,end)+'}, [projectData, mapDisplaySettingsStore]);\nglobalThis.applyEdits=applyEditsToFileData;';
 const ctx={...layout,...endian,useCallback:f=>f,projectData:{ecu_type:bigEndian?'EDC16U1':'EDC15VM',detectionResults:{maps:ms}},mapDisplaySettingsStore:new Map(),mapAxesFlipRef:{current:flips}};
 vm.createContext(ctx);vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);const out=Buffer.from(bytes);ctx.applyEdits(out,edits,axisEdits);return out;
}

check('Calibration staging supersedes overlapping edits and retains unrelated map work',()=>{
 const {data,locations:[l]}=fixture(1),base=Array.from(data);
 const sensor={address:l.c+8,size:4,name:'MAP linearization',codeblock_id:1,data_type:'UInt16',correction_factor:1,x_axis_address:l.c+4,x_axis_correction:1,dimensions:{TwoDimensional:{rows:1,cols:2}}};
 const other={address:l.start+0x6000,size:8,name:'Other table',codeblock_id:1,data_type:'UInt16',correction_factor:1,dimensions:{TwoDimensional:{rows:2,cols:2}}};
 const maps=[sensor,other],cells=new Map([[sensor.address,{'0-0':333,'0-1':2777}],[other.address,{'0-0':123}]]),axes=new Map([[sensor.address,{x:['90','999']}]]);
 const live=Array.from(exporter(maps,base,cells,axes)),ms=cal.detectMapSensorCalibration(live,'EDC15VM'),plan=cal.planMapSensorCalibration(live,ms,[ms[0].bank.id],four,{sensor:true,diagnostics:true});
 const result=stage({base,live,original:base,plan,maps,cells,axes,binary:new Map(),flips:new Map(),sourcesOf:layout.resolveAxisSources,bigEndian:false});
 assert(!result.cells.has(sensor.address));assert(!result.axes.has(sensor.address));assert.equal(result.cells.get(other.address)['0-0'],123);
 const final=exporter(maps,result.data,result.cells,result.axes),expected=cal.applyMapSensorPlan(live,plan);assert.deepEqual(final,Buffer.from(expected));
 const reload=[...base];for(const [address,edit] of result.binary)reload[address]=edit.newValue;assert.deepEqual(exporter(maps,reload,result.cells,result.axes),final);
 const newerCells=new Map(result.cells);newerCells.set(sensor.address,{'0-0':500});const newer=exporter(maps,result.data,newerCells,result.axes);assert.equal(newer.readUInt16LE(sensor.address),500);
});
check('Tool controls default to one bank, stock no-op, and copying all banks is explicit',()=>{
 const {data}=fixture();let storage=[],cursor=0,applied=null,closed=0;
 const fakeReact={useMemo:f=>f(),useState:initial=>{const i=cursor++;if(!(i in storage))storage[i]=typeof initial==='function'?initial():initial;return [storage[i],v=>storage[i]=typeof v==='function'?v(storage[i]):v];}};
 const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(root+'src/components/map-sensor-modal.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports:m.exports,module:m,document:{body:{}},require:spec=>spec==='react'?fakeReact:spec==='react-dom'?{createPortal:e=>e}:spec==='@/lib/map-sensor-calibration'?cal:require(spec)});
 const props={data:Array.from(data),ecuType:'EDC15VM',onApply:p=>applied=p,onClose:()=>closed++};
 const render=()=>{cursor=0;return m.exports.MapSensorModal(props);};
 const flatten=e=>!e||typeof e!=='object'?[]:[e,...(Array.isArray(e.props?.children)?e.props.children:[e.props?.children]).flatMap(c=>Array.isArray(c)?c.flatMap(flatten):flatten(c))];
 const find=(tree,type,label)=>flatten(tree).find(e=>e.type===type&&e.props['aria-label']===label);
 let tree=render(),inputs=flatten(tree).filter(e=>e.type==='input'&&e.props.type==='checkbox');
 assert.equal(inputs[2].props.checked,false);assert.equal(inputs.filter(e=>e.props.checked).length,3);
 let apply=flatten(tree).find(e=>e.type==='button'&&e.props.children==='Apply calibration');assert(apply.props.disabled);
 const html=require('react-dom/server').renderToStaticMarkup(tree);assert(html.includes('MAP Sensor Calibration'));assert(html.includes('Bosch 0281002177'));assert(html.includes('Bosch 0281006059'));assert(html.includes('Bosch 0281002401'));
 find(tree,'select','MAP sensor preset').props.onChange({target:{value:'bosch-4'}});tree=render();
 apply=flatten(tree).find(e=>e.type==='button'&&e.props.children==='Apply calibration');assert(!apply.props.disabled);apply.props.onClick();assert.equal(applied.patches.length,6);assert.equal(closed,1);
 inputs=flatten(tree).filter(e=>e.type==='input'&&e.props.type==='checkbox');inputs[2].props.onChange({target:{checked:true}});tree=render();
 flatten(tree).find(e=>e.type==='button'&&e.props.children==='Apply calibration').props.onClick();assert.equal(applied.patches.length,18);
 assert(!html.includes('HELLA'));assert(!html.includes('PST 3'));assert(!html.includes('enter manufacturer curve'));
 find(tree,'select','MAP sensor preset').props.onChange({target:{value:'bosch-3'}});tree=render();
 assert.equal(find(tree,'input','Low sensor voltage').props.value,'0.400000');
 assert(!flatten(tree).find(e=>e.type==='button'&&e.props.children==='Apply calibration').props.disabled);
});
check('Only documented VAG Bosch parts are offered, with the exact 3/4-bar curves',()=>{
 assert.deepEqual(Array.from(cal.MAP_SENSOR_PRESETS,p=>p.part),['0281002177','0281002401','0281006059']);
 assert.deepEqual(Array.from(cal.MAP_SENSOR_PRESETS.find(p=>p.part==='0281002401').voltage),[0.4,4.65]);
 const four=cal.MAP_SENSOR_PRESETS.find(p=>p.part==='0281006059');assert.deepEqual(Array.from(four.voltage),[0.5,4.5]);assert.deepEqual(Array.from(four.pressure),[500,4000]);
 const {data}=fixture(1),ms=cal.detectMapSensorCalibration(data,'EDC15VM');
 const out=cal.detectMapSensorCalibration(cal.applyMapSensorPlan(Array.from(data),cal.planMapSensorCalibration(data,ms,[ms[0].bank.id],four,{sensor:true,diagnostics:true})),'EDC15VM')[0];
 assert.deepEqual(Array.from(out.curve.input),[102,921]);assert.deepEqual(Array.from(out.curve.pressure),[500,4000]);assert.equal(out.diagnostics.scalar,637);
});
check('Only fully documented equivalent curves and ratings share a brand option',()=>{
 const base=cal.MAP_SENSOR_PRESETS.find(p=>p.id==='bosch-4');
 const verifiedRatings={pressureReference:'absolute',supplyRange:[4.75,5.25],outputType:'ratiometric voltage',pinout:'1 GND;2 NTC;3 5V;4 pressure',pressureRange:[500,4000],outputRange:[0.5,4.5],operatingTemperature:[-40,130],overpressure:6000,temperatureCurve:'test-identical-curve',mounting:'test-identical-housing'};
 const bosch={...base,verifiedRatings},hella={...base,id:'test-hella',manufacturer:'HELLA',part:'test-part',label:'Test HELLA',verifiedRatings:{...verifiedRatings}};
 const grouped=cal.groupSensorPresets([bosch,hella]);assert.equal(grouped.length,1);assert.equal(grouped[0].members.length,2);assert(grouped[0].label.includes('Bosch')&&grouped[0].label.includes('HELLA'));
 for(const ratings of [{...verifiedRatings,pinout:'different'},{...verifiedRatings,temperatureCurve:'different'},{...verifiedRatings,mounting:'different'},{...verifiedRatings,overpressure:5000},{...verifiedRatings,supplyRange:undefined}])assert.equal(cal.groupSensorPresets([bosch,{...hella,verifiedRatings:ratings}]).length,2);
 assert.equal(cal.groupSensorPresets([bosch,{...hella,voltage:[0.4,4.65]}]).length,2);
 assert.equal(cal.groupSensorPresets([{...bosch,verifiedRatings:undefined},{...hella,verifiedRatings:undefined}]).length,2);
 assert.equal(cal.groupSensorPresets(cal.MAP_SENSOR_PRESETS).length,3);
});
check('BD compact banks use their own validated scalar context and relocate correctly',()=>{
 const data=Buffer.alloc(0x80000,0xc3),places=[];
 for(const start of [0x58000,0x64000,0x70000]){
  signature.copy(data,start+1);const d=start+0x6950,f=start+0x6cc2,c=start+0x8a72;
  descriptors.copy(data,d);const bd=Buffer.from(scalars);bd.fill(0,20);bd.copy(data,f);curve.copy(data,c);places.push({d,f,c});
 }
 const ms=cal.detectMapSensorCalibration(data,'EDC15VM');assert.equal(ms.length,3);
 ms.forEach((m,i)=>{assert.equal(m.curve.address,places[i].c+8);assert.equal(m.diagnostics.scalarAddress,places[i].f+12);assert.equal(m.diagnostics.scalar,980);});
 const out=cal.applyMapSensorPlan(Array.from(data),cal.planMapSensorCalibration(data,ms,ms.map(m=>m.bank.id),cal.MAP_SENSOR_PRESETS.find(p=>p.id==='bosch-4'),{sensor:true,diagnostics:true}));
 cal.detectMapSensorCalibration(out,'EDC15VM').forEach(m=>assert.equal(m.diagnostics.scalar,637));
 data[places[0].f+24]=1;assert(!cal.detectMapSensorCalibration(data,'EDC15VM')[0].diagnostics);
});
check('GK, HA and ANU curve headers retain edited curves and reject duplicate records',()=>{
 for(const id of [0xdc9e,0xeb22,0xe9bc,0xeba2,0xeba4]){
  const {data,locations:[l]}=fixture(1);data.writeUInt16LE(id,l.c);
  const ms=cal.detectMapSensorCalibration(data,'EDC15P');assert(ms[0].curve);
  const out=cal.applyMapSensorPlan(Array.from(data),cal.planMapSensorCalibration(data,ms,[ms[0].bank.id],cal.MAP_SENSOR_PRESETS[2],{sensor:true,diagnostics:true}));
  assert.deepEqual(Array.from(cal.detectMapSensorCalibration(out,'EDC15P')[0].curve.pressure),[500,4000]);
  data.copy(data,l.c+0x40,l.c,l.c+12);assert(!cal.detectMapSensorCalibration(data,'EDC15P')[0].curve);
 }
});
check('Relocated AB and LP diagnostic contexts survive presets and reject damaged context',()=>{
 const anu=Buffer.from('000f2746800f080a5a0f21ff600f31c4300f12ff420f12ff400f1fc9950f064c650f0509020f080a5d0f0509010f2746860f080ae00e2746890f10ff941f12ff630f31c8320f1767','hex');
 for(const lp of [false,true]){
  const {data,locations:[l]}=fixture(1);const d=Buffer.from(anu);if(lp)d.set([0x17,0x66],12*4+2);d.copy(data,l.d);
  const words=lp?[200,20,100,980,1260,0,0,100,0,0,0,276,2700]:[200,20,100,980,977,0,0,0,276,2700];
  const s=Buffer.alloc(words.length*4);words.forEach((v,i)=>s.writeUInt32LE(v,i*4));s.copy(data,l.f);
  const ms=cal.detectMapSensorCalibration(data,'EDC15P');assert.equal(ms[0].diagnostics.scalarAddress,l.f+12);
  for(const preset of cal.MAP_SENSOR_PRESETS){const out=cal.applyMapSensorPlan(Array.from(data),cal.planMapSensorCalibration(data,ms,[ms[0].bank.id],preset,{sensor:true,diagnostics:true}));assert(cal.detectMapSensorCalibration(out,'EDC15P')[0].diagnostics);}
  data[l.f+words.length*4-2]=1;assert(!cal.detectMapSensorCalibration(data,'EDC15P')[0].diagnostics);
 }
});
const checksum=mod('src/lib/ecu/bosch/checksums/edc15p-checksum.ts');
check('Unsupported checksums stay unsupported rather than falsely reporting OK',()=>{
 assert.equal(checksum.verifyEDC15PChecksum(Array(0x80000).fill(0)).result,'TYPE_ERROR');
 assert.equal(checksum.verifyEDC15PChecksum([0,0]).result,'TYPE_ERROR');
});
check('Legacy single-bank checksum selection survives edits and never writes padding',()=>{
 const data=Buffer.alloc(0x80000,0xc3);signature.copy(data,0x70001);
 for(const p of [0x13ffc,0x70b7c,0x7bffc])data.writeUInt32LE(0,p);
 const fixed=checksum.correctEDC15PChecksum(Array.from(data));assert.equal(fixed.info.variant,'tdi41');
 const valid=checksum.verifyEDC15PChecksum(fixed.correctedData);assert.equal(valid.result,'OK');assert.equal(valid.found,3);assert.equal(valid.matched,3);
 fixed.correctedData[0x78000]=42;const next=checksum.correctEDC15PChecksum(fixed.correctedData);assert.equal(next.info.variant,'tdi41');
 const allowed=new Set([0x13ffc,0x70b7c,0x7bffc].flatMap(p=>[p,p+1,p+2,p+3]));
 next.correctedData.forEach((v,i)=>{if(v!==fixed.correctedData[i])assert(allowed.has(i));});
 assert.equal(checksum.verifyEDC15PChecksum(next.correctedData).result,'OK');
});
console.log(`${total} MAP sensor checks passed.`);
