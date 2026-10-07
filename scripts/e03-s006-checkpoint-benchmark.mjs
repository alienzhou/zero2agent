/** Fixed corpus benchmark. Storage contains only temporary synthetic files. No Git checkout or hidden repo. */
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { CheckpointStore } from '../packages/tui/dist/checkpoint-store.js';
const root = await mkdtemp(path.join(tmpdir(), 'e03-s006-bench-'));
const out = new URL('../researches/file-checkpoints/acceptance/benchmark.json', import.meta.url);
let seed=0x13579bdf;
function corpus(n) { const b=Buffer.alloc(n);for(let i=0;i<n;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;b[i]=seed&255;}return b; }
const original=corpus(4*1024*1024);
const iterations=20;
const hash=b=>createHash('sha256').update(b).digest('hex');
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
async function bytes(dir){let logical=0,allocated=0,files=0;for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){const n=await bytes(p);logical+=n.logical;allocated+=n.allocated;files+=n.files;}else {const s=await stat(p);logical+=s.size;allocated+=Math.max(s.size,s.blocks*512);files++;}}return {logical,allocated,files};}
const report={recordedAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,iterations,corpus:{kind:'fixed-seed high-entropy 4 MiB; each iteration inserts 30 bytes at the front',sha256:hash(original),unrelatedFiles:1000,unrelatedBytes:4096000},scope:'All modes save only the same target file before and after a mutation. Filesystem writes included; timings are warm local runs, not a universal performance claim. Copy and whole-file baselines do not implement locks, full validation, conflict checks or fsync, so these are storage baselines, not equivalent durability or throughput implementations. Naive whole-workspace copies are an arithmetic estimate only. Git pack/delta is not benchmarked.',results:[]};
try {
for(const mode of ['full-file-copy','whole-file-compressed-CAS','content-defined-compressed-CAS']) {
 const cwd=path.join(root,mode,'work'), storage=path.join(root,mode,'store');await mkdir(cwd,{recursive:true});await mkdir(storage,{recursive:true});
 await mkdir(path.join(cwd,'unrelated'));for(let i=0;i<1000;i++)await writeFile(path.join(cwd,'unrelated',String(i)),Buffer.alloc(4096,i%256));
 const file=path.join(cwd,'target.bin');await writeFile(file,original);let current=original;const times=[];
 const store=await CheckpointStore.open(cwd,{directory:storage});
 const seen=new Set();
 async function save(data,index,side) {if(mode==='full-file-copy')await writeFile(path.join(storage,`${index}-${side}`),data);else {const h=hash(data);if(!seen.has(h)){await writeFile(path.join(storage,h),deflateRawSync(data,{level:3}));seen.add(h);}}}
 for(let i=0;i<iterations;i++) {
  const next=Buffer.concat([Buffer.from(`insertion-${String(i).padStart(2,'0')}-01234567890123456`),current]);const t=performance.now();
  if(mode==='content-defined-compressed-CAS')await store.capture({cwd,paths:['target.bin'],toolName:'benchmark',toolCallId:String(i)},async()=>{await writeFile(file,next);return 'written'});
  else {await save(await readFile(file),i,'before');await writeFile(file,next);await save(await readFile(file),i,'after');}
  times.push(performance.now()-t);current=next;
 }
 const usage=await bytes(storage);
 const t=performance.now();
 if(mode==='content-defined-compressed-CAS'){const [r]=await store.list();const plan=await store.preview(r.id);await store.restore(r.id,plan.token);}
 else if(mode==='full-file-copy')await writeFile(file,await readFile(path.join(storage,`${iterations-1}-before`)));
 else {const {inflateRawSync}=await import('node:zlib');const prior=current.subarray(30);await writeFile(file,inflateRawSync(await readFile(path.join(storage,hash(prior)))));}
 const restoreMs=performance.now()-t;
 // Exact expected bytes, not a time-only benchmark.
 const expected=current.subarray(30);if(hash(await readFile(file))!==hash(expected))throw new Error('Restore bytes differ');
 report.results.push({mode,saveTotalMs:times.reduce((a,b)=>a+b,0),saveP50Ms:percentile(times,.5),saveP95Ms:percentile(times,.95),restoreMs,storageBeforeRestore:usage,logicalHistoryBytes:iterations*(2*original.length)+30*iterations*iterations,verifiedRestore:true});
 console.log(mode,JSON.stringify(report.results.at(-1)));
}
report.naiveWholeWorkspaceCopiesEstimateBytes=iterations*2*(original.length+report.corpus.unrelatedBytes);
await mkdir(new URL('./',out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
}finally {await rm(root,{recursive:true,force:true});}
