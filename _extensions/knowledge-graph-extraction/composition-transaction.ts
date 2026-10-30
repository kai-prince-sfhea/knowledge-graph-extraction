// A bounded rollback boundary for explicitly observed composition outputs.
// This is per-file recovery on an ordinary failure, not crash/site atomicity.
import {atomicJson,confined,digest,projectPath,PUBLIC,STATE} from './core.ts';
import {outputRoot} from './context.ts';
import {privatePath} from './private-path.ts';
import {dirname,isAbsolute,join,relative} from 'stdlib/path';

export const COMPOSITION_TRANSACTION_LIMITS=Object.freeze({files:100000,fileBytes:32*1024*1024,totalBytes:256*1024*1024});
type Capture={path:string;existed:boolean;hash?:string;backup?:string};
const privatePointers=new Set([`${STATE}/producers/committed.json`,`${STATE}/public/committed.json`,`${STATE}/extraction/committed.json`]);
const aliases=new Set([`${PUBLIC}/registry.json`,`${PUBLIC}/report.html`,`${PUBLIC}/manifest.json`]);
const fail=():never=>{throw new Error('knowledge-graph-extraction: composition transaction target is unsafe or exceeds its bounded inventory');};

/** Follow no links, including links within the same project/output tree. */
async function safeTarget(root:string,output:string,value:string):Promise<string>{
  const path=projectPath(value);
  if(privatePointers.has(path))return await privatePath(root,path);
  const parts=path.split('/');
  if(parts.some(part=>['.quarto','.git','_extensions'].includes(part.toLowerCase())))fail();
  const absolute=await confined(root,path),inside=relative(output,absolute).replaceAll('\\','/');
  if(!inside||inside==='..'||inside.startsWith('../')||isAbsolute(inside))fail();
  const first=inside.split('/')[0].toLowerCase();
  if(!(inside==='search.json'||aliases.has(inside)||/\.html?$/i.test(inside))
    ||['site_libs','local-ai-assets'].includes(first)||first===PUBLIC&&!aliases.has(inside))fail();
  let ancestor=root;
  for(const [index,part]of parts.entries()){
    ancestor=join(ancestor,part);
    try{const entry=await Deno.lstat(ancestor);if(entry.isSymlink||index<parts.length-1&&!entry.isDirectory||index===parts.length-1&&!entry.isFile)fail();}
    catch(error){if(error instanceof Deno.errors.NotFound)break;throw error;}
  }
  return absolute;
}

async function receipt(root:string,id:string,phase:string,captured:number,restored:number,rollback:string):Promise<void>{
  try{await atomicJson(await privatePath(root,`${STATE}/composition-transactions/failures/${id}.json`),
    {version:1,operation:'public-composition',status:'failed',phase,captured,restored,rollback});}catch{/* Preserve the authoritative failure. */}
}

/** Capture bytes/absence before a coordinator mutates known rendered outputs
 * and pointers. The callback must not delete uncaptured generation directories.
 * Concurrent renders and process/crash recovery are outside this boundary. */
export async function withCompositionTransaction<T>(root:string,outputDir:string,paths:string[],operation:()=>Promise<T>):Promise<T>{
  const canonicalRoot=await Deno.realPath(root),output=await outputRoot(canonicalRoot,outputDir),id=crypto.randomUUID();
  const captured:Capture[]=[],stage=`${STATE}/composition-transactions/staging/${id}`;
  let phase='preflight';
  try{
    if(!Array.isArray(paths)||paths.length>COMPOSITION_TRANSACTION_LIMITS.files)fail();
    const originals:{path:string;bytes:Uint8Array|null}[]=[];let total=0;
    for(const path of [...new Set(paths)].sort()){
      const target=await safeTarget(canonicalRoot,output,path);
      let bytes:Uint8Array|null=null;
      try{
        if((await Deno.stat(target)).size>COMPOSITION_TRANSACTION_LIMITS.fileBytes)fail();
        bytes=await Deno.readFile(target);total+=bytes.byteLength;
        if(bytes.byteLength>COMPOSITION_TRANSACTION_LIMITS.fileBytes||total>COMPOSITION_TRANSACTION_LIMITS.totalBytes)fail();
      }catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
      originals.push({path:projectPath(path),bytes});
    }
    // Validate every target and budget before storing any private original.
    for(const [index,original]of originals.entries()){
      if(original.bytes===null){captured.push({path:original.path,existed:false});continue;}
      const backup=await privatePath(canonicalRoot,`${stage}/${index}.original.bin`);
      await Deno.mkdir(dirname(backup),{recursive:true});await Deno.writeFile(backup,original.bytes,{createNew:true});
      captured.push({path:original.path,existed:true,hash:await digest(original.bytes),backup});
    }
    // Another process must not change the inventory while it was being saved.
    for(const original of captured){
      const target=await safeTarget(canonicalRoot,output,original.path);
      try{const bytes=await Deno.readFile(target);if(!original.existed||await digest(bytes)!==original.hash)fail();}
      catch(error){if(!(error instanceof Deno.errors.NotFound)||original.existed)throw error;}
    }
    phase='operation';
    const result=await operation();
    // Successful cleanup touches only our own private flat staging files.
    for(const original of captured)if(original.backup){try{await Deno.remove(await privatePath(canonicalRoot,relative(canonicalRoot,original.backup).replaceAll('\\','/')));}catch{/* Harmless private retained backup. */}}
    try{await Deno.remove(await privatePath(canonicalRoot,stage));}catch{/* Empty/retained staging is private. */}
    return result;
  }catch{
    let restored=0,rollback=phase==='operation'?'complete':'unnecessary';
    if(phase==='operation'){
      // Each original stays intact privately until its replacement succeeds.
      for(const [index,original]of [...captured].reverse().entries()){
        try{
          const target=await safeTarget(canonicalRoot,output,original.path);
          if(!original.existed){
            try{await Deno.remove(target);}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
          }else{
            const backup=await privatePath(canonicalRoot,relative(canonicalRoot,original.backup!).replaceAll('\\','/'));
            const bytes=await Deno.readFile(backup);if(await digest(bytes)!==original.hash)fail();
            let matches=false;
            try{matches=await digest(await Deno.readFile(target))===original.hash;}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
            if(!matches){
              const pending=await privatePath(canonicalRoot,`${stage}/${index}.restore-${crypto.randomUUID()}.bin`);
              await Deno.writeFile(pending,bytes,{createNew:true});await Deno.mkdir(dirname(target),{recursive:true});await Deno.rename(pending,target);
            }
          }
          restored++;
        }catch{rollback='incomplete';}
      }
    }
    await receipt(canonicalRoot,id,phase,captured.length,restored,rollback);
    throw new Error(`knowledge-graph-extraction: composition ${phase} failed; output/pointer rollback ${rollback}; inspect private composition-transactions failure receipts`);
  }
}
