// Add an optional graph selector to native local search without replacing its
// default result path. Generated assets are receipt-bound public artifacts.
import {canonical,confined,readJson,digest,projectPath,STATE,atomicJson} from './core.ts';
import {outputPath,outputRoot} from './context.ts';
import {dirname,join,relative,isAbsolute} from 'stdlib/path';
import {withGraphSearch,withoutPageSearch} from './composition.ts';
import {buildSiteSearchAssets} from './site-search.ts';
import {privatePath} from './private-path.ts';
import {htmlIds} from './html.ts';
import {buildReadingRouteAssets} from './reading-route.ts';
type Value=Record<string,any>;
/** Existing public native search entries can name retained HTML even when
 * semantic observation reuse is disabled. This is a bounded destination list,
 * never evidence of a QMD/AST observation, source freshness or graph coverage. */
export async function nativeSearchOutputs(root:string,outputDir:string):Promise<string[]>{
  try{
    root=await Deno.realPath(root);
    const output=await outputRoot(root,outputDir),indexPath=outputPath(outputDir,'search.json');
    let ancestor=root;
    for(const part of indexPath.split('/')){
      ancestor=join(ancestor,part);const info=await Deno.lstat(ancestor);
      if(info.isSymlink) return [];
    }
    const index=await confined(root,indexPath),info=await Deno.lstat(index);
    if(!info.isFile||info.size>32*1024*1024)return [];
    const bytes=await Deno.readFile(index);if(bytes.byteLength>32*1024*1024)return [];
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!Array.isArray(value)||value.length>100000)return [];
    const paths=new Set<string>(),checked=new Set<string>();
    for(const entry of withGraphSearch(value,[])){
      const href=entry?.href;
      if(typeof href!=='string'||!href||href.length>8192||href!==href.trim()||/^[a-z][a-z0-9+.-]*:/i.test(href)||href.startsWith('/')||/[\\\u0000-\u001f]/.test(href))continue;
      try{
        const decoded=decodeURIComponent(href.split(/[?#]/)[0]);
        if(/%(?:25)*(?:2e|2f|5c|3a|00)/i.test(decoded)||/[\\\u0000-\u001f]/.test(decoded))continue;
        const path=projectPath(decoded),parts=path.split('/');
        if(!/\.html?$/i.test(path)||parts.some(part=>['.quarto','.git','_extensions','knowledge-graph','site_libs','local-ai-assets'].includes(part.toLowerCase())))continue;
        const relativePath=outputPath(outputDir,path);
        if(checked.has(relativePath))continue;checked.add(relativePath);
        await nativeHtml(root,output,relativePath);
        paths.add(relativePath);
      }catch{/* Unsupported destinations never gain output or observation authority. */}
    }
    return [...paths].sort();
  }catch{return [];}// Missing/unsupported native search preserves native fallback.
}
/** Native text is a view input even when semantic graph records are unchanged.
 * Bind its original public corpus before choosing an immutable generation. */
export async function siteSearchIdentity(root:string,outputDir:string,producer:Value,enabled:boolean):Promise<string|null>{
  if(!enabled)return null;
  let native;
  try{native=await readJson(await confined(root,outputPath(outputDir,'search.json')));}
  catch(error){if(error instanceof Deno.errors.NotFound)return null;throw error;}
  const output=await outputRoot(root,outputDir);
  const stale=(producer.staleEntries??[]).map((entry:Value)=>relative(output,join(root,entry.output)).replaceAll('\\','/'));
  return await digest(canonical(withGraphSearch(withoutPageSearch(native,stale),[])));
}
export async function siteSearchArtifacts(root:string,outputDir:string,snapshotId:string,composition:Value,producer:Value,enabled:boolean,readAsset:(url:URL)=>Promise<string>=url=>Deno.readTextFile(url)):Promise<Value|null>{
  if(!enabled||!composition.searchEnabled)return null;
  let native;
  try{native=await readJson(await confined(root,outputPath(outputDir,'search.json')));}
  catch(error){if(error instanceof Deno.errors.NotFound)return null;throw error;}
  const output=await outputRoot(root,outputDir);
  const stale=(producer.staleEntries??[]).map((entry:Value)=>relative(output,join(root,entry.output)).replaceAll('\\','/'));
  const entries=withGraphSearch(withoutPageSearch(native,stale),composition.graphValues,composition.sharedMemberships);
  const graphs=composition.registry.graphs.filter((graph:Value)=>graph.search!==false).map((graph:Value)=>({id:graph.id,label:graph.label,status:graph.status}));
  try{
    const result=buildSiteSearchAssets({snapshotId,graphs,entries},{indexUrl:'./site-search-index.json'});
    const files:Record<string,string>={'site-search-index.json':result.indexText};
    for(const asset of result.assets)files[asset.name]=await readAsset(asset.source);
    // Optional asset failure must not leave half an adapter in the inventory.
    Object.assign(composition.files,files);
    return {snapshotId,graphs,entries};
  }catch{
    // Optional UI limits/unsupported native data must preserve ordinary search.
    console.warn('knowledge-graph-extraction: optional graph search filter unavailable for this native index; ordinary website search is retained');
    return null;
  }
}

export const SITE_SEARCH_PLAN_LIMITS=Object.freeze({files:100000,pageBytes:32*1024*1024,totalBytes:256*1024*1024});
type SearchChange={path:string;beforeHash:string;afterHash:string;original:string;next:string};
export type SearchPlan={id:string;root:string;outputDir:string;changes:SearchChange[];files:string[];observations:{path:string;hash:string}[];state:'planned'|'applied'|'failed'};
const refuse=():never=>{throw new Error('knowledge-graph-extraction: native search output inventory is invalid or changed; no HTML committed');};
const managed=/<!-- kg-site-search:start -->[\s\S]*?<!-- kg-site-search:end -->/g;
const readingManaged=/<!-- kg-reading-route:start -->[\s\S]*?<!-- kg-reading-route:end -->/g;

/** The caller supplies native output observations, never a directory to scan.
 * Even an output-dir of '.' cannot opt private/extension/template trees in. */
async function nativeHtml(root:string,output:string,value:string):Promise<string>{
  const path=projectPath(value),parts=path.split('/');
  if(!/\.html?$/i.test(path)||parts.some(part=>['.quarto','.git','_extensions'].includes(part.toLowerCase())))refuse();
  let ancestor=root;
  for(const part of parts){ancestor=join(ancestor,part);if((await Deno.lstat(ancestor)).isSymlink)refuse();}
  const absolute=await confined(root,path),inside=relative(output,absolute).replaceAll('\\','/');
  if(!inside||inside==='..'||inside.startsWith('../')||isAbsolute(inside)
    ||['knowledge-graph','site_libs','local-ai-assets'].includes(inside.split('/')[0].toLowerCase())
    ||!(await Deno.lstat(absolute)).isFile)refuse();
  return absolute;
}
async function failureReceipt(plan:Pick<SearchPlan,'root'|'id'>,phase:string,applied:number,rollback:string):Promise<void>{
  // A diagnostic contains no page bytes, source snippets, model output, paths
  // supplied by an author or raw filesystem errors. It is never a public asset.
  try{await atomicJson(await privatePath(plan.root,`${STATE}/site-search/failures/${plan.id}.json`),
    {version:1,operation:'native-site-search',phase,applied,rollback,status:'failed'});}catch{/* Original refusal remains authoritative. */}
}

/** Preload and stage every transform without changing a visible output byte.
 * UTF-8 BOMs/newlines and everything outside our managed marker are preserved. */
export async function planSiteSearch(root:string,outputDir:string,input:Value|null,paths:string[],reading:Value|null=null):Promise<SearchPlan>{
  const plan:SearchPlan={id:crypto.randomUUID(),root:await Deno.realPath(root),outputDir,changes:[],files:[],observations:[],state:'planned'};
  try{
    if(!Array.isArray(paths)||paths.length>SITE_SEARCH_PLAN_LIMITS.files)refuse();
    const output=await outputRoot(plan.root,outputDir),prepared:{path:string;before:Uint8Array;after:Uint8Array}[]=[];
    let total=0;
    for(const value of [...new Set(paths)].sort()){
      const path=await nativeHtml(plan.root,output,value),info=await Deno.stat(path);
      if(info.size>SITE_SEARCH_PLAN_LIMITS.pageBytes)refuse();
      const before=await Deno.readFile(path);total+=before.byteLength;
      if(before.byteLength>SITE_SEARCH_PLAN_LIMITS.pageBytes||total>SITE_SEARCH_PLAN_LIMITS.totalBytes)refuse();
      const html=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(before),cleaned=html.replace(managed,'').replace(readingManaged,'');
      let changed=cleaned,host=false;
      try{host=htmlIds(cleaned).get('quarto-search')===1;}catch{/* Unsupported HTML keeps ordinary native search. */}
      if(input&&host&&/<\/head\s*>/i.test(cleaned)){
        const generation=join(output,'knowledge-graph','generations',input.snapshotId);
        const prefix=relative(dirname(path),generation).replaceAll('\\','/');
        if(isAbsolute(prefix))refuse();
        const encoded=prefix.split('/').map(encodeURIComponent).join('/')+'/';
        const result=buildSiteSearchAssets(input,{indexUrl:encoded+'site-search-index.json',assetPrefix:encoded});
        changed=cleaned.replace(/<\/head\s*>/i,`<!-- kg-site-search:start -->${result.markup}\n<!-- kg-site-search:end --></head>`);
      }
      plan.files.push(relative(plan.root,path).replaceAll('\\','/'));
      if(reading&&/<\/head\s*>/i.test(changed)){
        const generation=join(output,'knowledge-graph','generations',reading.snapshotId);
        const prefix=relative(dirname(path),generation).replaceAll('\\','/');
        const rootPrefix=relative(dirname(path),output).replaceAll('\\','/');
        if(isAbsolute(prefix)||isAbsolute(rootPrefix))refuse();
        const encode=(value:string)=>value.split('/').map(encodeURIComponent).join('/');
        const config={version:1,snapshotId:reading.snapshotId,siteUrl:rootPrefix?encode(rootPrefix)+'/':'./',graphs:reading.graphs,activities:reading.activities};
        const result=buildReadingRouteAssets(config,{assetPrefix:encode(prefix)+'/'});
        changed=changed.replace(/<\/head\s*>/i,`<!-- kg-reading-route:start -->${result.markup}\n<!-- kg-reading-route:end --></head>`);
      }
      plan.observations.push({path:plan.files.at(-1)!,hash:await digest(before)});
      if(changed!==html)prepared.push({path:plan.files.at(-1)!,before,after:new TextEncoder().encode(changed)});
    }
    // All paths/HTML/config have passed before even private staging begins.
    for(const [index,item]of prepared.entries()){
      const original=await privatePath(plan.root,`${STATE}/site-search/staging/${plan.id}/${index}.original.html`);
      const next=await privatePath(plan.root,`${STATE}/site-search/staging/${plan.id}/${index}.next.html`);
      await Deno.mkdir(dirname(original),{recursive:true});
      await Deno.writeFile(original,item.before,{createNew:true});await Deno.writeFile(next,item.after,{createNew:true});
      plan.changes.push({path:item.path,beforeHash:await digest(item.before),afterHash:await digest(item.after),original,next});
    }
    return plan;
  }catch{plan.state='failed';await failureReceipt(plan,'preflight',0,'unnecessary');refuse();}
}

/** Each replacement is atomic. On an ordinary write/rename failure, previously
 * replaced files are rolled back. This is not whole-site/crash atomicity. */
export async function applySiteSearch(plan:SearchPlan,rename:(from:string,to:string)=>Promise<void>=(from,to)=>Deno.rename(from,to)):Promise<void>{
  if(plan.state!=='planned')refuse();
  const applied:SearchChange[]=[];
  try{
    const output=await outputRoot(plan.root,plan.outputDir);
    // No visible writes until every current/staged byte is checked again.
    for(const observation of plan.observations){
      if(await digest(await Deno.readFile(await nativeHtml(plan.root,output,observation.path)))!==observation.hash)refuse();
    }
    for(const change of plan.changes){
      const path=await nativeHtml(plan.root,output,change.path);
      if(await digest(await Deno.readFile(path))!==change.beforeHash
        ||await digest(await Deno.readFile(await privatePath(plan.root,relative(plan.root,change.original).replaceAll('\\','/'))))!==change.beforeHash
        ||await digest(await Deno.readFile(await privatePath(plan.root,relative(plan.root,change.next).replaceAll('\\','/'))))!==change.afterHash)refuse();
    }
    for(const change of plan.changes){
      const path=await nativeHtml(plan.root,output,change.path);
      if(await digest(await Deno.readFile(path))!==change.beforeHash)refuse();
      await rename(change.next,path);applied.push(change);
    }
    plan.state='applied';
    for(const change of plan.changes){try{await Deno.remove(change.original);}catch{/* Private staging cleanup is not publication. */}}
  }catch{
    let rollback='complete';
    for(const change of applied.reverse()){
      try{
        const path=await nativeHtml(plan.root,await outputRoot(plan.root,plan.outputDir),change.path);
        // Do not overwrite a concurrent author/tool edit during rollback.
        if(await digest(await Deno.readFile(path))!==change.afterHash){rollback='incomplete';continue;}
        await Deno.rename(await privatePath(plan.root,relative(plan.root,change.original).replaceAll('\\','/')),path);
      }catch{rollback='incomplete';}
    }
    plan.state='failed';await failureReceipt(plan,'apply',applied.length,rollback);
    throw new Error(`knowledge-graph-extraction: native search update failed; managed HTML rollback ${rollback}; inspect private site-search failure receipts`);
  }
}

/** Convenience wrapper with the same explicit native inventory requirement. */
export async function finishSiteSearch(root:string,outputDir:string,input:Value|null,paths:string[]):Promise<void>{
  await applySiteSearch(await planSiteSearch(root,outputDir,input,paths));
}
