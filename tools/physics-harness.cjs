// Deterministic, non-browser test harness. It executes the unmodified generated
// game in a fake DOM and records the game's visible diagnostics over time.
// Real rendering is checked separately in a real browser.
const fs=require('fs'),vm=require('vm'),path=require('path');
const game=path.resolve(process.argv[2]);
const elements=new Map(),listeners={},frames=[]; let now=0;
const gradient={addColorStop(){}};
const draw=new Proxy({measureText:s=>({width:String(s).length*8}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient}, {get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
class Element{
 constructor(id=''){this.id=id;this.width=1280;this.height=720;this.clientWidth=1280;this.clientHeight=720;this.style={};this.dataset={};this.textContent='';this.innerHTML='';this.listeners={};this.children=[];this.classList={add(){},remove(){},toggle(){},contains(){return false}};}
 getContext(){return draw} getBoundingClientRect(){return {x:0,y:0,left:0,top:0,width:1280,height:720}} addEventListener(k,f){(this.listeners[k]??=[]).push(f)}
 removeEventListener(){} setAttribute(k,v){this[k]=v} getAttribute(k){return this[k]} appendChild(c){this.children.push(c);return c} remove(){} focus(){} setPointerCapture(){} releasePointerCapture(){}
 click(){const e={target:this,preventDefault(){},stopPropagation(){}};this.onclick?.(e);for(const f of this.listeners.click||[])f(e)}
 querySelector(s){return get(s.replace(/^#/,''))} querySelectorAll(){return []}
}
function get(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id)}
const html=fs.readFileSync(path.join(game,'index.html'),'utf8');
for(const m of html.matchAll(/id=["']([^"']+)["']/g))get(m[1]);
const canvas=[...elements.values()].find(x=>/canvas|game/i.test(x.id))||get('canvas');
const document={body:get('body'),documentElement:get('html'),readyState:'complete',getElementById:get,createElement:t=>new Element(t),querySelector:s=>s==='canvas'?canvas:get(s.replace(/^#/,'')),querySelectorAll:()=>[],addEventListener(k,f){(listeners[k]??=[]).push(f)}};
const storage=new Map();
const context={console,Math,JSON,Number,String,Array,Object,Set,Map,Float32Array,Uint8Array,parseFloat,parseInt,isNaN,isFinite,document,innerWidth:1280,innerHeight:720,devicePixelRatio:1,navigator:{userAgent:'node-test',maxTouchPoints:0},location:{search:'',hash:''},performance:{now:()=>now},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},requestAnimationFrame:f=>(frames.push(f),frames.length),cancelAnimationFrame(){},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},addEventListener(k,f){(listeners[k]??=[]).push(f)},removeEventListener(){},Image:class{set src(s){this.onload?.()}},Audio:class{play(){return Promise.resolve()}pause(){}}};
context.window=context;context.self=context;context.globalThis=context;
vm.createContext(context);
try{
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
  const src=m[1].match(/src=["']([^"']+)["']/); const code=src?fs.readFileSync(path.join(game,src[1]),'utf8'):m[2];
  if(code.trim())vm.runInContext(code,context,{timeout:5000});
 }
 for(const f of listeners.DOMContentLoaded||[])f();
 for(const f of listeners.load||[])f();
 context.onload?.();
 function step(n){for(let i=0;i<n;i++){now+=1000/60;const q=frames.splice(0);for(const f of q)f(now)}}
 function key(type,key,code){const e={type,key,code,repeat:false,preventDefault(){},stopPropagation(){}};for(const f of listeners[type]||[])f(e);context['on'+type]?.(e)}
 function state(){return {time:Math.round(now/1000),debug:get('debug').textContent,debugHTML:get('debug').innerHTML,ui:Object.fromEntries([...elements].filter(([k,v])=>v.textContent&&k!=='debug').map(([k,v])=>[k,v.textContent]))}}
 step(5);const samples=[state()];
 if(process.argv[3])get(process.argv[3]).click();
 key('keydown','ArrowRight','ArrowRight'); key('keydown','d','KeyD');
 for(let i=0;i<Number(process.argv[4]||6);i++){step(300);samples.push(state())}
 key('keyup','ArrowRight','ArrowRight');key('keyup','d','KeyD');
 key('keydown','p','KeyP');key('keyup','p','KeyP');step(1);const pauseBefore=state();step(120);const pauseAfter=state();
 key('keydown','r','KeyR');key('keyup','r','KeyR');step(10);samples.push({...state(),afterRestart:true});
 console.log(JSON.stringify({harness:'Node VM, fake DOM; not a rendering test',samples,pauseBefore,pauseAfter,storage:Object.fromEntries(storage)},null,2));
}catch(e){console.error(e.stack);process.exitCode=1}
