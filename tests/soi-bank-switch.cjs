const fs=require('fs'),vm=require('vm'),assert=require('assert'),ts=require('typescript'),React=require('react'),SSR=require('react-dom/server');
const root=require('path').resolve(__dirname,'..')+'/';
const s=fs.readFileSync(root+'src/components/map-viewer.tsx','utf8'),start=s.indexOf('  const renderBankCopySwitches = () => {'),end=s.indexOf('  // Use controlled viewMode',start);
const layout={apiRows:16,apiCols:14};
const code=ts.transpileModule(s.slice(start,end)+'\nglobalThis.renderSwitches=renderBankCopySwitches;', {compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020}}).outputText;
let latest=null;const c={React,themeProp:'light',displayTransposed:false,bankCopyOptions:{x:false,y:false,values:false},otherBankCount:2,onBankCopyOptionsChange:v=>latest=v,mapData:{name:'Start of injection 0°C',codeblock_id:1,size:448},resolveAxisSources:()=>({x:{address:100},y:{address:200}}),resolveMapCellLayout:()=>layout};
vm.createContext(c);vm.runInContext(code,c);
function buttons(){return c.renderSwitches().props.children[1];}
let html=SSR.renderToStaticMarkup(c.renderSwitches());assert.equal((html.match(/aria-checked="false"/g)||[]).length,3);assert(html.includes('X-axis')&&html.includes('Y-axis')&&html.includes('Table values'));
for(const [i,key] of ['x','y','values'].entries()){buttons()[i].props.onClick();assert.equal(latest[key],true);assert.equal(Object.values(latest).filter(Boolean).length,1);}
c.displayTransposed=true;buttons()[0].props.onClick();assert.equal(latest.y,true);assert.equal(latest.x,false);
c.mapData.name='N75 duty cycle';assert(c.renderSwitches());c.otherBankCount=0;assert(buttons().every(b=>b.props.disabled));c.otherBankCount=2;c.mapData.external_source='XDF';assert.strictEqual(c.renderSwitches(),null);
console.log('PASS three independent switches, all OFF by default, axis transposition, general table visibility, and unavailable counterparts');
