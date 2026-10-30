// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Immutable topic delivery, shared by browsers, Node and Deno. No persistence.
import {search,query,traverse,prerequisites,shortestPath,hierarchyClosure,evidenceLookup,scopedCounts,filterByTime,pageIndex,shortestPagePath} from './query.js';

export const DELIVERY_LIMITS=Object.freeze({manifestBytes:8*1024*1024,indexBytes:16*1024*1024,
  partBytes:1024*1024,parts:4096,records:100000,totalBytes:128*1024*1024});
const HASH=/^[a-f0-9]{64}$/, ID=/^[a-z][a-z0-9-]{0,63}$/;
const kinds=['objects','relations','occurrences'];
const fail=message=>{throw new Error('knowledge-graph-extraction: delivery: '+message);};
const mapping=(v,name)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(name+' must be a mapping');return v;};
const keys=(v,names,name)=>{mapping(v,name);if(Object.keys(v).some(k=>!names.includes(k)))fail(name+' contains unsupported fields');};
const integer=(v,min,max,name)=>{if(!Number.isInteger(v)||v<min||v>max)fail(name+' is outside its integer budget');return v;};
const text=(v,name,max=8192)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f]/u.test(v))fail(name+' requires bounded text');return v;};
const hash=(v,name)=>{if(typeof v!=='string'||!HASH.test(v))fail(name+' requires a SHA-256 identity');return v;};
const graphId=v=>{if(typeof v!=='string'||!ID.test(v)||['constructor','prototype'].includes(v))fail('invalid graph identity');return v;};
export function canonicalDelivery(v){
  if(Array.isArray(v)){
    const entries=[];for(let i=0;i<v.length;i++){if(!Object.hasOwn(v,i))fail('data arrays must not have missing entries');entries.push(canonicalDelivery(v[i]));}
    return '['+entries.join(',')+']';
  }
  if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonicalDelivery(v[k])).join(',')+'}';
  if(v===undefined||typeof v==='number'&&!Number.isFinite(v))fail('data must be finite JSON values');
  return JSON.stringify(v);
}
export async function deliveryDigest(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function artifact(value,name,max){keys(value,['url','sha256','bytes'],name);text(value.url,name+' URL',4096);hash(value.sha256,name+' hash');integer(value.bytes,1,max,name+' bytes');return value;}
function localURL(value,base){
  if(typeof value!=='string'||!value||value!==value.trim()||/[\\%?#\s]/u.test(value)||value.startsWith('/')||value.includes(':')||value.split('/').some(p=>!p||p==='.'||p==='..'))fail('artifact URLs must be ordinary generation-relative paths');
  const url=new URL(value,base);if(url.origin!==base.origin||!url.pathname.startsWith(new URL('.',base).pathname))fail('artifact URL escaped its generation');return url;
}
function validateManifest(value,expectedSnapshot,expectedGraphId,manifestBytes){
  keys(value,['deliveryVersion','snapshotId','graphId','status','graph','counts','index','parts'],'manifest');
  if(value.deliveryVersion!==1)fail('unsupported manifest version');hash(value.snapshotId,'snapshot');graphId(value.graphId);
  if(expectedSnapshot!==undefined&&value.snapshotId!==expectedSnapshot)fail('snapshot does not match the requested generation');
  if(expectedGraphId!==undefined&&value.graphId!==expectedGraphId)fail('graph identity does not match the requested graph');
  if(!['complete','incomplete'].includes(value.status))fail('unsupported graph coverage');
  mapping(value.graph,'graph header');if(value.graph.snapshotId!==value.snapshotId||value.graph.status!==value.status||kinds.some(k=>Object.hasOwn(value.graph,k)))fail('invalid graph header');
  if((value.graph.graph?.id??'website')!==value.graphId)fail('graph header has a different graph identity');
  keys(value.counts,kinds,'record counts');for(const kind of kinds)integer(value.counts[kind],0,DELIVERY_LIMITS.records,'record count');
  if(kinds.reduce((n,k)=>n+value.counts[k],0)>DELIVERY_LIMITS.records)fail('total record count exceeds its budget');
  artifact(value.index,'index',DELIVERY_LIMITS.indexBytes);if(value.index.url!=='delivery-index.json')fail('unsupported index mapping');
  if(!Array.isArray(value.parts)||value.parts.length>DELIVERY_LIMITS.parts)fail('parts exceed their count budget');
  const urls=new Set();let bytes=manifestBytes+value.index.bytes;
  for(const part of value.parts){keys(part,['url','sha256','bytes','topic','scope','records'],'part');
    artifact({url:part.url,sha256:part.sha256,bytes:part.bytes},'part',DELIVERY_LIMITS.partBytes);
    hash(part.topic,'topic');text(part.scope,'topic scope');integer(part.records,1,DELIVERY_LIMITS.records,'part record count');
    if(part.url!==`topics/${part.sha256}.json`||urls.has(part.url))fail('invalid or duplicate topic mapping');urls.add(part.url);bytes+=part.bytes;
  }
  if(bytes>DELIVERY_LIMITS.totalBytes||value.parts.reduce((n,p)=>n+p.records,0)!==kinds.reduce((n,k)=>n+value.counts[k],0))fail('manifest totals exceed bounds or disagree');
  return value;
}
function validateIndex(value,manifest){
  keys(value,['deliveryVersion','snapshotId','graphId','status','objects','scopeDependencies'],'index');
  if(value.deliveryVersion!==1||value.snapshotId!==manifest.snapshotId||value.graphId!==manifest.graphId||value.status!==manifest.status||!Array.isArray(value.objects)||value.objects.length!==manifest.counts.objects)fail('index identity or coverage mismatch');
  const ids=new Set(),parts=new Set(manifest.parts.map(p=>p.url));
  for(const row of value.objects){keys(row,['id','type','scope','labels','aliases','properties','destinations','part'],'index object');
    text(row.id,'object identity');text(row.type,'object type');text(row.scope,'object scope');mapping(row.labels,'labels');
    if(!Object.keys(row.labels).length||Object.values(row.labels).some(v=>typeof v!=='string')||!Array.isArray(row.destinations)||row.destinations.some(v=>typeof v!=='string')||ids.has(row.id)||!parts.has(row.part))fail('index has invalid records or destinations');ids.add(row.id);
  }
  if(value.scopeDependencies!==undefined){mapping(value.scopeDependencies,'scope dependencies');
    const scopes=new Set(manifest.parts.map(part=>part.scope));
    if(Object.keys(value.scopeDependencies).length!==scopes.size)fail('scope dependency inventory disagrees');
    for(const [scope,dependencies]of Object.entries(value.scopeDependencies)){
      if(!scopes.has(scope)||!Array.isArray(dependencies)||!dependencies.includes(scope)||new Set(dependencies).size!==dependencies.length||dependencies.some(v=>!scopes.has(v)))fail('invalid scope dependencies');
    }
  }
  return value;
}
function discoveryRow(object,destinations,part){
  return {id:object.id,type:object.type,scope:object.scope,labels:object.labels,
    ...(object.aliases?{aliases:object.aliases}:{}),...(object.properties?.aliases?{properties:{aliases:object.properties.aliases}}:{}),destinations,part};
}
async function fetchJSON(url,max,{fetchImpl,signal,expected,onBytes}={}){
  if(signal?.aborted)throw signal.reason??new Error('cancelled');
  const response=await fetchImpl(url.href,{credentials:'same-origin',redirect:'error',signal});if(!response.ok||response.redirected||response.url&&new URL(response.url).origin!==url.origin)fail('artifact request failed or left the origin');
  const reader=response.body?.getReader();if(!reader)fail('artifact requires a readable response');
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max||expected&&size>expected.bytes)fail('artifact exceeds its byte budget');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  if(expected&&(size!==expected.bytes||await deliveryDigest(bytes)!==expected.sha256))fail('artifact size or SHA-256 mismatch');
  onBytes?.(size);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('artifact is not valid UTF-8 JSON');}
}
/** Complete index discovery is independent of detail availability. Exact graph
 * queries assemble all declared parts before using the unchanged query kernel. */
export async function openDelivery(value,{baseURL=globalThis.location?.href,expectedSnapshot,expectedGraphId,expectedManifest,fetchImpl=globalThis.fetch?.bind(globalThis),signal}={}){
  const url=new URL(value,baseURL);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)fail('use an ordinary HTTP(S) manifest URL');
  if(baseURL&&url.origin!==new URL(baseURL).origin)fail('manifest must stay on the website origin');
  if(expectedSnapshot!==undefined)hash(expectedSnapshot,'expected snapshot');if(expectedGraphId!==undefined)graphId(expectedGraphId);
  if(typeof fetchImpl!=='function')fail('fetch is unavailable');
  let manifestBytes=0;
  const manifest=validateManifest(await fetchJSON(url,DELIVERY_LIMITS.manifestBytes,{fetchImpl,signal,expected:expectedManifest,onBytes:size=>{manifestBytes=size;}}),expectedSnapshot,expectedGraphId,manifestBytes);
  const index=validateIndex(await fetchJSON(localURL(manifest.index.url,url),DELIVERY_LIMITS.indexBytes,{fetchImpl,signal,expected:manifest.index}),manifest);
  const parts=new Map(),pending=new Map(),closedScopes=new Set(),byId=new Map(index.objects.map(o=>[o.id,o])),objectPositions=new Map(index.objects.map((o,i)=>[o.id,i]));let failure=null;
  const discovery={...manifest.graph,objects:index.objects,relations:[],occurrences:[]};
  const coverage=()=>({deliveryVersion:1,snapshotId:manifest.snapshotId,graphId:manifest.graphId,graphStatus:manifest.status,
    indexComplete:true,loadedParts:parts.size,requiredParts:manifest.parts.length,status:!failure&&parts.size===manifest.parts.length?'loaded':'incomplete',...(failure?{reason:failure}:{})});
  async function getPart(part,requestSignal){
    if(requestSignal?.aborted)throw requestSignal.reason??new Error('cancelled');
    if(parts.has(part.url))return parts.get(part.url);
    // Do not share an abortable request across independent callers. Committed
    // immutable parts are reused; each caller owns its own cancellation.
    if(!requestSignal&&pending.has(part.url))return pending.get(part.url);
    const task=(async()=>{
      const raw=await fetchJSON(localURL(part.url,url),DELIVERY_LIMITS.partBytes,{fetchImpl,signal:requestSignal,expected:part});
      keys(raw,['deliveryVersion','snapshotId','graphId','status','topic','scope','records'],'topic part');
      if(raw.deliveryVersion!==1||raw.snapshotId!==manifest.snapshotId||raw.graphId!==manifest.graphId||raw.status!==manifest.status||raw.topic!==part.topic||raw.scope!==part.scope||!Array.isArray(raw.records)||raw.records.length!==part.records)fail('topic identity/coverage mismatch');
      const positions=new Set();
      for(const row of raw.records){keys(row,['kind','position','value'],'topic record');if(!kinds.includes(row.kind))fail('unsupported record kind');integer(row.position,0,manifest.counts[row.kind]-1,'record position');mapping(row.value,'record');
        const position=row.kind+':'+row.position;if(positions.has(position))fail('repeated record position');positions.add(position);
        const scope=row.kind==='occurrences'?byId.get(row.value.target)?.scope:row.value.scope;
        if(scope!==raw.scope)fail('record is outside its declared topic');
        if(row.kind==='objects'){
          const expected=byId.get(row.value.id);
          if(!expected||expected.part!==part.url||objectPositions.get(row.value.id)!==row.position
            ||canonicalDelivery(discoveryRow(row.value,expected.destinations,part.url))!==canonicalDelivery(expected))fail('discovery index disagrees with its object detail');
        }
      }
      if(requestSignal?.aborted)throw requestSignal.reason??new Error('cancelled');parts.set(part.url,raw);return raw;
    })();
    if(!requestSignal)pending.set(part.url,task);
    try{return await task;}finally{if(pending.get(part.url)===task)pending.delete(part.url);}
  }
  async function loadAll({signal:requestSignal}={}){
    try{
      for(const part of manifest.parts)await getPart(part,requestSignal);
      if(requestSignal?.aborted)throw requestSignal.reason??new Error('cancelled');
      const graph={...JSON.parse(JSON.stringify(manifest.graph)),...Object.fromEntries(kinds.map(k=>[k,new Array(manifest.counts[k])]))},seen=new Set(),objectParts=new Map();
      for(const part of manifest.parts)for(const row of parts.get(part.url).records){const key=row.kind+':'+row.position;if(seen.has(key))fail('repeated record position');seen.add(key);graph[row.kind][row.position]=JSON.parse(JSON.stringify(row.value));if(row.kind==='objects')objectParts.set(row.value.id,part.url);}
      if(kinds.some(k=>graph[k].some(v=>!v)||Object.keys(graph[k]).length!==manifest.counts[k]))fail('record inventory is incomplete');
      const byObject=new Map(graph.objects.map(o=>[o.id,o])),destinations=new Map();
      for(const occurrence of graph.occurrences){const list=destinations.get(occurrence.target)??[];list.push(occurrence.destination);destinations.set(occurrence.target,list);}
      for(const [position,row]of index.objects.entries()){const object=byObject.get(row.id);if(!object||graph.objects[position]?.id!==row.id)fail('index and graph object inventory disagree');
        const expected=discoveryRow(object,destinations.get(object.id)??[],objectParts.get(row.id));
        if(canonicalDelivery(expected)!==canonicalDelivery(row))fail('discovery index disagrees with its full records');
      }
      query(graph,'lookup',graph.objects[0]?.id??'urn:kg:empty');failure=null;return {status:manifest.status,graph,coverage:coverage()};
    }catch(error){failure=requestSignal?.aborted?'cancelled-or-unavailable':'required-topic-unavailable-or-invalid';return {status:'incomplete',graph:null,reason:failure,coverage:coverage()};}
  }
  async function loadScopes(requested,{signal:requestSignal}={}){
    if(!Array.isArray(requested)||!requested.length||requested.length>64||requested.some(v=>typeof v!=='string'))fail('select 1 to 64 topic scopes');
    // Older delivery-v1 indexes have no closure inventory. Full loading is the
    // only safe fallback; arrival order must never waive an unseen dependency.
    if(!index.scopeDependencies)return loadAll({signal:requestSignal});
    const closure=new Set(),queue=[...requested];
    for(let i=0;i<queue.length;i++){const scope=queue[i];if(closure.has(scope))continue;
      if(!Object.hasOwn(index.scopeDependencies,scope))return {status:'incomplete',graph:null,reason:'requested-topic-unavailable',coverage:coverage()};
      closure.add(scope);for(const dependency of index.scopeDependencies[scope])if(!closure.has(dependency))queue.push(dependency);
    }
    try{
      for(const part of manifest.parts)if(closure.has(part.scope))await getPart(part,requestSignal);
      if(parts.size===manifest.parts.length)return loadAll({signal:requestSignal});
      if(requestSignal?.aborted)throw requestSignal.reason??new Error('cancelled');
      for(const scope of closure)closedScopes.add(scope);
      const graph={...JSON.parse(JSON.stringify(manifest.graph)),status:'incomplete',objects:[],relations:[],occurrences:[]};
      const rows=Object.fromEntries(kinds.map(kind=>[kind,[]]));
      for(const part of manifest.parts){const loaded=closedScopes.has(part.scope)&&parts.get(part.url);if(loaded)for(const row of loaded.records)rows[row.kind].push(row);}
      for(const kind of kinds)graph[kind]=rows[kind].sort((a,b)=>a.position-b.position).map(row=>JSON.parse(JSON.stringify(row.value)));
      const ids=new Set(graph.objects.map(object=>object.id));
      if(graph.relations.some(edge=>!ids.has(edge.from)||!ids.has(edge.to))||graph.occurrences.some(row=>!ids.has(row.target)))fail('selective scope closure has unavailable endpoints');
      query(graph,'lookup',graph.objects[0]?.id??'urn:kg:empty');failure=null;
      return {status:'incomplete',graph,reason:'other-topics-not-loaded',coverage:{...coverage(),requestedScopes:[...requested],dependencyClosure:[...closure].sort()}};
    }catch{failure='required-topic-unavailable-or-invalid';return {status:'incomplete',graph:null,reason:failure,coverage:coverage()};}
  }
  const searchIndex=(options={})=>JSON.parse(JSON.stringify({...search(discovery,options),delivery:{...coverage(),detailCoverage:parts.size===manifest.parts.length?'all':'partial',operationScope:'complete-discovery-index'}}));
  return Object.freeze({
    search:searchIndex,
    async object(id,{signal:requestSignal}={}){const row=byId.get(id);if(!row)return {status:manifest.status==='complete'?'complete':'unknown',answer:null,reason:manifest.status==='complete'?'no-match-in-declared-scope':'incomplete-source-coverage',coverage:coverage()};
      try{const part=manifest.parts.find(p=>p.url===row.part),raw=await getPart(part,requestSignal),entry=raw.records.find(r=>r.kind==='objects'&&r.value.id===id);if(!entry)fail('index points to an unavailable object');return {status:manifest.status,answer:JSON.parse(JSON.stringify(entry.value)),destinations:[...row.destinations],coverage:coverage()};}
      catch{failure='required-topic-unavailable-or-invalid';return {status:'incomplete',answer:null,reason:failure,coverage:coverage()};}},
    loadAll,loadScopes,
    emptyGraph(){return {...JSON.parse(JSON.stringify(manifest.graph)),status:'incomplete',objects:[],relations:[],occurrences:[]};},
    discovery(){return JSON.parse(JSON.stringify(index));},
    async execute(operation,options={}){const named={traverse,prerequisites,shortestPath,hierarchyClosure,evidenceLookup,scopedCounts,filterByTime,pageIndex,shortestPagePath};if(!['search','lookup','neighbours','definitions',...Object.keys(named)].includes(operation))fail('unsupported named operation');if(operation==='search')return searchIndex(options);const loaded=await loadAll({signal:options.signal});if(!loaded.graph)return {...loaded,answer:null,exhaustive:false};
      const {signal:_signal,...args}=options;let result;
      if(['lookup','neighbours','definitions'].includes(operation))result=query(loaded.graph,operation,args.id,args.scope);
      else if(Object.hasOwn(named,operation))result=named[operation](loaded.graph,args);else fail('unsupported named operation');
      return {...result,delivery:loaded.coverage};},
    status:coverage
  });
}
