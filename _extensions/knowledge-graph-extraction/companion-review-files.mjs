// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Bounded filesystem observations only; never imports project code.
import {lstat,realpath,readdir,readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,join,posix} from 'node:path';
import {createHash} from 'node:crypto';
import process from 'node:process';

export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const sha=v=>createHash('sha256').update(v).digest('hex');
export class Refusal extends Error { constructor(code){super(code);this.code=code;} }
const refuse=code=>{throw new Refusal(code);};
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const inside=(base,target)=>{const p=relative(base,target);return p===''||!isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+sep);};
const reserved=/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
function partsOK(path,{runtime=false}={}){
  const parts=path.split('/');
  if(parts.some((p,i)=>!p||p==='.'||p==='..'||p.startsWith('.')||/[\u0000-\u0020\u007f\\:%?#<>"'|]/u.test(p)||/[. ]$/u.test(p)||reserved.test(p)||['node_modules','.git','.quarto'].includes(p.toLowerCase())||p.toLowerCase()==='_extensions'&&!(runtime&&i===0)))refuse('unsafe-local-path');
  return path;
}
/** Native input-directory paths may contain ../ but may not leave the root.
 * A leading slash is accepted only by explicitly root-relative contracts. */
export function localPath(value,base='.',{rootRelative=false,runtime=false}={}){
  if(typeof value!=='string'||!value||value.length>4096||value!==value.normalize('NFC')||/[\u0000-\u0020\u007f\\:%?#<>"'|]/u.test(value)||value.startsWith('//')||value.endsWith('/')||value.includes('//'))refuse('unsafe-local-path');
  if(value.startsWith('/')&&!rootRelative)refuse('absolute-local-path');
  if(base!=='.')partsOK(base,{runtime});
  const path=posix.normalize(value.startsWith('/')?value.slice(1):posix.join(base,value));
  return partsOK(path,{runtime});
}

export async function boundedFS(root,{fileBytes=2*1024*1024,totalBytes=72*1024*1024,files=2048,memoize=false}={}){
  root=resolve(root);const rootInfo=await lstat(root);
  if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()||!same(await realpath(root),root))refuse('unsafe-root');
  let observedBytes=0,observedFiles=0;const readCache=new Map(),treeCache=new Map();
  async function inspect(path,{runtime=false,missing=false,directory=false}={}){
    partsOK(path,{runtime});let cursor=root;
    for(const [i,part]of path.split('/').entries()){
      cursor=join(cursor,part);let stat;
      try{stat=await lstat(cursor);}catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}
      if(stat.isSymbolicLink())refuse('linked-path');
      if(i<path.split('/').length-1?!stat.isDirectory():directory?!stat.isDirectory():!stat.isFile())refuse('unexpected-file-kind');
      const physical=await realpath(cursor);if(!inside(root,physical)||!same(physical,cursor))refuse('aliased-path');
    }
    return {absolute:cursor,stat:await lstat(cursor)};
  }
  async function read(path,{maxBytes=fileBytes,runtime=false,missing=false}={}){
    partsOK(path,{runtime});
    // This collector has no model-byte authority. LA resources use inspect()
    // only; unsupported binary selections retain fresh-AST fallback.
    if (/\.(?:litertlm|tflite|onnx|gguf|safetensors|bin|pt|pth)$/iu.test(path)) refuse('model-byte-read-refused');
    if(memoize&&readCache.has(path)){const row=readCache.get(path);if(!row&&!missing)refuse('previously-absent-input');if(row&&row.size>maxBytes)refuse('file-byte-budget');return row;}
    const before=await inspect(path,{runtime,missing});if(!before){if(memoize)readCache.set(path,null);return null;}
    if(before.stat.size>maxBytes)refuse('file-byte-budget');
    if(++observedFiles>files||observedBytes+before.stat.size>totalBytes)refuse('observation-budget');
    const bytes=await readFile(before.absolute),after=await inspect(path,{runtime});
    if(bytes.length!==before.stat.size||after.stat.size!==before.stat.size||after.stat.ino!==before.stat.ino||after.stat.dev!==before.stat.dev||after.stat.mtimeMs!==before.stat.mtimeMs||after.stat.ctimeMs!==before.stat.ctimeMs)refuse('file-changed-during-observation');
    observedBytes+=bytes.length;const row={path,bytes,hash:sha(bytes),size:bytes.length};if(memoize)readCache.set(path,row);return row;
  }
  async function tree(path,{maxFiles=512,maxBytes=64*1024*1024,maxFileBytes=16*1024*1024,maxDepth=16,maxNodes=8192,runtime=false}={}){
    const cacheKey=canonical({path,maxFiles,maxBytes,maxFileBytes,maxDepth,maxNodes,runtime});if(memoize&&treeCache.has(cacheKey))return treeCache.get(cacheKey);
    await inspect(path,{runtime,directory:true});let total=0,nodes=0;const rows=[];
    async function walk(dir,depth){
      if(depth>maxDepth)refuse('tree-depth-budget');
      const before=await inspect(dir,{runtime,directory:true});const entries=await readdir(before.absolute,{withFileTypes:true});
      if(entries.length>4096)refuse('directory-budget');
      const keys=new Set();for(const entry of entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
        if(++nodes>maxNodes)refuse('tree-node-budget');
        const key=entry.name.toLowerCase();if(keys.has(key))refuse('case-colliding-paths');keys.add(key);
        const child=dir+'/'+entry.name;partsOK(child,{runtime});if(entry.isSymbolicLink())refuse('linked-path');
        if(entry.isDirectory())await walk(child,depth+1);else{
          if(rows.length>=maxFiles)refuse('tree-file-budget');const row=await read(child,{runtime,maxBytes:maxFileBytes});
          total+=row.size;if(total>maxBytes)refuse('tree-byte-budget');rows.push(row);
        }
      }
      const after=await readdir(before.absolute);if(canonical(after.sort())!==canonical(entries.map(e=>e.name).sort()))refuse('tree-membership-changed');
    }
    await walk(path,0);rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);const result={path,rows,bytes:total,hash:sha(canonical(rows.map(row=>({path:row.path.slice(path.length+1),hash:row.hash}))))};if(memoize)treeCache.set(cacheKey,result);return result;
  }
  return {root,inspect,read,tree,stats:()=>({files:observedFiles,bytes:observedBytes})};
}

/** Exact historical KG canonical payload shape: sorted {path,hash} rows. */
export async function snapshotPackage(root,directory){
  const fs=await boundedFS(root,{fileBytes:8*1024*1024,totalBytes:8*1024*1024,files:256});
  const tree=await fs.tree(directory,{runtime:true,maxFiles:256,maxBytes:8*1024*1024,maxFileBytes:8*1024*1024});
  const manifest=tree.rows.find(row=>row.path===directory+'/_extension.yml');if(!manifest)refuse('missing-package-manifest');
  const version=new TextDecoder('utf-8',{fatal:true}).decode(manifest.bytes).match(/^version:\s*([^\r\n]+)$/mu)?.[1];
  if(!version||version!==version.trim())refuse('unsupported-manifest-version');
  return {directory,version,hash:tree.hash,files:tree.rows.map(({path,hash,size})=>({path:path.slice(directory.length+1),hash,bytes:size})),bytes:tree.bytes};
}
