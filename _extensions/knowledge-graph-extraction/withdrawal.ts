// A withdrawal is a fail-closed publication state, never a rollback to old facts.
import {atomicJson,canonical,confined,digest,projectPath,PUBLIC,STATE} from './core.ts';
import {outputPath,outputRoot} from './context.ts';
import {privatePath} from './private-path.ts';
import {withoutPageSearch,producerEnvelope,graphDefinition} from './composition.ts';
import {dirname,isAbsolute,join,relative} from 'stdlib/path';

const marker=`${STATE}/public/withdrawal-pending.json`;
const markerValue={version:1,reason:'producer-withdrawal'};
const failure='knowledge-graph-extraction: producer withdrawal could not be completed safely; publishing and cached recovery remain blocked';
const refuse=():never=>{throw new Error(failure);};
const HASH=/^[a-f0-9]{64}$/;
const MAX_ENTRIES=100000,MAX_SEARCH_BYTES=32*1024*1024;
const MAX_POINTER_BYTES=32*1024*1024,MAX_DEPENDENCY_BYTES=8*1024*1024,MAX_DEPENDENCY_TOTAL=256*1024*1024;
const notice='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Generated view requires a fresh render</title></head><body><main><h1>Generated view requires a fresh render</h1><p>Its source data or rendering context changed. Previous generated content is unavailable until this page is rendered again. The author source has been preserved.</p></main></body></html>\n';

/** A malformed/linked pending marker is a refusal, not permission to recover. */
export async function producerWithdrawalPending(root:string):Promise<boolean>{
  try{
    const path=await privatePath(root,marker);let info;
    try{info=await Deno.lstat(path);}catch(error){if(error instanceof Deno.errors.NotFound)return false;throw error;}
    if(!info.isFile||info.isSymlink||info.size>4096)refuse();
    const bytes=await Deno.readFile(path);if(bytes.byteLength>4096)refuse();
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!value||typeof value!=='object'||Array.isArray(value)||canonical(value)!==canonical(markerValue))refuse();
    return true;
  }catch{refuse();}
}
/** Only a successful finalization may call this; it never removes graph history. */
export async function clearProducerWithdrawal(root:string):Promise<void>{
  try{if(await producerWithdrawalPending(root))await Deno.remove(await privatePath(root,marker));}catch{refuse();}
}

const mapping=(value:any)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function inputPath(value:unknown):string{
  const path=projectPath(value);
  // These receipts describe public author inputs, not private state, tokens,
  // hidden configuration stores or executable installed extension payloads.
  if(path.split('/').some(part=>part.startsWith('.')||['_extensions','node_modules'].includes(part.toLowerCase())))refuse();
  return path;
}
function staleRecord(value:any):Record<string,any>{
  if(!mapping(value)||Object.keys(value).some(key=>!['graph','source','output','producer'].includes(key))
    ||typeof value.producer!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.producer))refuse();
  const output=projectPath(value.output);
  if(!/\.html?$/i.test(output)||output.split('/').some(part=>part.startsWith('.')||part.toLowerCase()==='_extensions'))refuse();
  return {graph:graphDefinition(value.graph),source:inputPath(value.source),output,producer:value.producer};
}

/** Read only the integrity-checked producer receipt and its exact recorded
 * ordinary inputs, before a changed catalogue might fail semantic parsing.
 * Never parse a catalogue here or follow a replacement link into private data. */
export async function changedProducerInputs(root:string):Promise<Record<string,any>|null>{
  try{
    root=await Deno.realPath(root);
    const pointer=await privatePath(root,`${STATE}/producers/committed.json`);let info;
    try{info=await Deno.lstat(pointer);}catch(error){if(error instanceof Deno.errors.NotFound)return null;throw error;}
    if(!info.isFile||info.isSymlink||info.size>MAX_POINTER_BYTES)refuse();
    const bytes=await Deno.readFile(pointer);if(bytes.byteLength>MAX_POINTER_BYTES)refuse();
    const previous=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!mapping(previous)||Object.keys(previous).some(key=>!['producerCacheVersion','entries','staleEntries','hash'].includes(key)))refuse();
    const {hash,...content}=previous;
    if(previous.producerCacheVersion!==1||typeof hash!=='string'||!HASH.test(hash)||await digest(canonical(content))!==hash
      ||!mapping(previous.entries)||Object.keys(previous.entries).length>MAX_ENTRIES||!Array.isArray(previous.staleEntries??[])||(previous.staleEntries??[]).length>MAX_ENTRIES)refuse();
    const stale=(previous.staleEntries??[]).map(staleRecord),observed=new Map<string,boolean>();let totalRead=0;
    for(const [key,raw]of Object.entries(previous.entries) as [string,any][]){
      if(!mapping(raw)||Object.keys(raw).some(name=>!['envelope','output','occurrences','dependencies','contextDigest','sourceKey','htmlHash'].includes(name)))refuse();
      const envelope=producerEnvelope(raw.envelope);
      if(key!==`${envelope.source}\n${envelope.producer}`||!Array.isArray(raw.dependencies)||raw.dependencies.length>10000)refuse();
      inputPath(envelope.source);
      const expected=new Set(envelope.dependencies.map(inputPath)),seen=new Set<string>();let changed=false;
      for(const dependency of raw.dependencies){
        if(!mapping(dependency)||Object.keys(dependency).some(name=>!['path','hash'].includes(name))||typeof dependency.hash!=='string'||!HASH.test(dependency.hash))refuse();
        const path=inputPath(dependency.path);if(!expected.has(path)||seen.has(path))refuse();seen.add(path);
        const identity=`${path}\n${dependency.hash}`;
        if(!observed.has(identity)){
          let matches=false;
          try{
            if(await ordinaryPath(root,path,'file')){
              const absolute=await confined(root,path),details=await Deno.stat(absolute);
              if(details.size<=MAX_DEPENDENCY_BYTES&&totalRead+details.size<=MAX_DEPENDENCY_TOTAL){
                const current=await Deno.readFile(absolute);totalRead+=current.byteLength;
                matches=current.byteLength<=MAX_DEPENDENCY_BYTES&&totalRead<=MAX_DEPENDENCY_TOTAL&&await digest(current)===dependency.hash;
              }
            }
          }catch{/* Missing/unreadable/linked input is stale; its target is never trusted. */}
          observed.set(identity,matches);
        }
        if(!observed.get(identity))changed=true;
      }
      if(seen.size!==expected.size)refuse();
      const candidate=staleRecord({graph:envelope.graph,source:envelope.source,output:raw.output,producer:envelope.producer});
      if(changed)stale.push(candidate);
    }
    if(!stale.length)return null;
    const entries=[...new Map(stale.map((entry:any)=>[`${entry.source}\n${entry.output}\n${entry.producer}`,entry])).values()];
    return {changed:true,entries:{},parts:[],staleEntries:entries,stale:[...new Map(entries.map(entry=>[entry.graph.id,entry.graph])).values()]};
  }catch{refuse();}
}

/** Check every existing ancestor without following even same-project links.
 * Return false for a missing target; callers decide whether absence is allowed. */
async function ordinaryPath(root:string,path:string,kind:'file'|'directory'):Promise<boolean>{
  const parts=projectPath(path).split('/');let current=root;
  for(const [index,part]of parts.entries()){
    current=join(current,part);let entry;
    try{entry=await Deno.lstat(current);}catch(error){if(error instanceof Deno.errors.NotFound)return false;throw error;}
    if(entry.isSymlink||index<parts.length-1&&!entry.isDirectory
      ||index===parts.length-1&&!(kind==='file'?entry.isFile:entry.isDirectory))refuse();
  }
  await confined(root,path);return true;
}
async function quarantine(root:string,path:string):Promise<void>{
  if(!await ordinaryPath(root,path,'file'))return;
  const target=await confined(root,path);
  // An old generated page need not be loaded to withdraw it. Only compare the
  // tiny fixed notice when its exact byte size already matches.
  if((await Deno.stat(target)).size===new TextEncoder().encode(notice).byteLength&&await Deno.readTextFile(target)===notice)return;
  const pending=await confined(root,`${path}.kg-withdrawal-${crypto.randomUUID()}.pending`);
  try{await Deno.writeTextFile(pending,notice,{createNew:true});await Deno.rename(pending,target);}
  finally{try{await Deno.remove(pending);}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}}
}

/** Persist the recovery block FIRST. Withdraw known generated pages, their
 * native search rows and managed graph publications, preserving private history
 * and all noncanonical/unmanaged public files. A failure keeps the block set. */
export async function enforceProducerWithdrawal(root:string,outputDir:string,producer:Record<string,any>):Promise<void>{
  try{
    root=await Deno.realPath(root);
    if(!await producerWithdrawalPending(root))await atomicJson(await privatePath(root,marker),markerValue);
    const output=await outputRoot(root,outputDir);
    const records=producer?.staleEntries;
    if(!Array.isArray(records)||records.length>MAX_ENTRIES)refuse();
    const pages=new Set<string>(),targets=new Set<string>();
    for(const record of records){
      if(!record||typeof record!=='object'||typeof record.output!=='string')refuse();
      const path=projectPath(record.output),parts=path.split('/');
      if(parts.some(part=>['.quarto','.git','_extensions'].includes(part.toLowerCase()))||! /\.html?$/i.test(path))refuse();
      const inside=relative(output,join(root,path)).replaceAll('\\','/');
      if(inside==='..'||inside.startsWith('../')||isAbsolute(inside))continue;
      if(!inside||[PUBLIC,'site_libs','local-ai-assets'].includes(inside.split('/')[0].toLowerCase()))refuse();
      pages.add(inside);if(await ordinaryPath(root,path,'file'))targets.add(path);
    }
    const search=outputPath(outputDir,'search.json'),hasSearch=await ordinaryPath(root,search,'file');
    let originalSearch:unknown[]|null=null,filteredSearch:unknown[]|null=null;
    if(hasSearch){
      const path=await confined(root,search);if((await Deno.stat(path)).size>MAX_SEARCH_BYTES)refuse();
      const bytes=await Deno.readFile(path);if(bytes.byteLength>MAX_SEARCH_BYTES)refuse();
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(!Array.isArray(value)||value.length>MAX_ENTRIES)refuse();originalSearch=value;filteredSearch=withoutPageSearch(value,[...pages]);
    }
    const aliases=['manifest.json','registry.json','report.html','report.html.pending'].map(name=>outputPath(outputDir,`${PUBLIC}/${name}`));
    const existingAliases:string[]=[];
    for(const path of aliases)if(await ordinaryPath(root,path,'file'))existingAliases.push(path);
    const generationsPath=outputPath(outputDir,`${PUBLIC}/generations`),generationTargets:string[]=[];
    if(await ordinaryPath(root,generationsPath,'directory')){
      const managed=await Deno.realPath(await confined(root,generationsPath));let entries=0;
      async function inspectTree(directory:string):Promise<void>{
        for await(const entry of Deno.readDir(directory)){
          if(++entries>MAX_ENTRIES||entry.isSymlink||!entry.isFile&&!entry.isDirectory)refuse();
          const child=join(directory,entry.name),inside=relative(managed,await Deno.realPath(child));
          if(!inside||inside==='..'||inside.startsWith('..'+(Deno.build.os==='windows'?'\\':'/'))||isAbsolute(inside))refuse();
          if(entry.isDirectory)await inspectTree(child);
        }
      }
      for await(const entry of Deno.readDir(managed)){
        // Foreign files/directories are not ours to delete or traverse.
        if(!HASH.test(entry.name))continue;
        if(entry.isSymlink)refuse();if(!entry.isDirectory)continue;
        const target=join(managed,entry.name),actual=await Deno.realPath(target);
        if(dirname(actual)!==managed||!HASH.test(relative(managed,actual)))refuse();
        await inspectTree(actual);generationTargets.push(actual);
      }
    }
    // Safety preflight has completed. No later error may revive these outputs.
    for(const path of targets)await quarantine(root,path);
    if(originalSearch&&filteredSearch&&canonical(originalSearch)!==canonical(filteredSearch))await atomicJson(await confined(root,search),filteredSearch);
    for(const path of existingAliases){if(await ordinaryPath(root,path,'file'))await Deno.remove(await confined(root,path));}
    for(const target of generationTargets){
      // Recheck the exact canonical managed target immediately before removal.
      const logical=relative(root,target).replaceAll('\\','/');
      if(!await ordinaryPath(root,logical,'directory'))continue;
      const managed=await Deno.realPath(await confined(root,generationsPath)),actual=await Deno.realPath(target);
      if(dirname(actual)!==managed||!HASH.test(relative(managed,actual)))refuse();
      await Deno.remove(actual,{recursive:true});
    }
  }catch{refuse();}
}
