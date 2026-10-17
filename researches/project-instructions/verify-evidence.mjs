import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

if (!process.argv[2]) throw new Error('Usage: node verify-evidence.mjs <extracted-directory>');
const root = await fs.realpath(process.argv[2]);
const manifestFile = path.join(root, 'manifest.json');
const manifestStat = await fs.lstat(manifestFile);
if (!manifestStat.isFile() || manifestStat.size > 2 * 1024 * 1024) throw new Error('Invalid manifest');
const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 5000)
  throw new Error('Unsupported or oversized manifest');
const seen = new Set();
let total = 0;
for (const item of manifest.files) {
  if (typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.includes('\\') ||
      item.path.split('/').some(p => !p || p === '..' || p === '.') || seen.has(item.path) ||
      !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256))
    throw new Error('Unsafe or duplicate manifest entry');
  seen.add(item.path);
  total += item.bytes;
  if (total > 128 * 1024 * 1024) throw new Error('Evidence exceeds verification size limit');
  const target = path.join(root, item.path);
  const real = await fs.realpath(target);
  const stat = await fs.lstat(target);
  if (!real.startsWith(root + path.sep) || !stat.isFile() || stat.size !== item.bytes)
    throw new Error(`Invalid evidence file: ${item.path}`);
  const bytes = await fs.readFile(target);
  if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256)
    throw new Error(`Evidence mismatch: ${item.path}`);
}
console.log(`Verified ${seen.size} evidence/source files (${total} bytes).`);
