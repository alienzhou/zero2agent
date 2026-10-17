import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Usage: node verify-evidence.mjs <extracted-directory>');
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
if(manifest.version!==1||!Array.isArray(manifest.files))throw new Error('Unsupported manifest');
const seen=new Set();
for(const item of manifest.files){
  if(typeof item.path!=='string'||path.isAbsolute(item.path)||item.path.split('/').some(p=>!p||p==='..'||p==='.')||seen.has(item.path))throw new Error('Unsafe or duplicate manifest path');
  seen.add(item.path);
  const target=path.join(root,item.path);
  const real=await fs.realpath(target);
  if(!real.startsWith(root+path.sep))throw new Error('Manifest file escapes extracted directory');
  const bytes=await fs.readFile(target);
  if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error(`Evidence mismatch: ${item.path}`);
}
console.log(`Verified ${seen.size} evidence/source files.`);
