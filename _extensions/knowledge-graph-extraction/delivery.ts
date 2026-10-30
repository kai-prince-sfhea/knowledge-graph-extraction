// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Pure public-projection publisher. Call only after ordinary graph validation.
import {canonicalDelivery,deliveryDigest,DELIVERY_LIMITS} from './delivery.js';
import {query} from './query.js';
type Value=Record<string,any>;
export type DeliveryOptions={mode:'topics';maxShardBytes:number;maxRecordsPerShard:number};
const fail=(s:string):never=>{throw new Error('knowledge-graph-extraction: delivery: '+s);};
const size=(s:string)=>new TextEncoder().encode(s).byteLength;
export function parseDeliveryOptions(value:unknown):DeliveryOptions|null{
  if(value===undefined||value===false)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))fail('use false or a topics mapping');
  const v=value as Value;if(Object.keys(v).some(k=>!['mode','max-shard-bytes','max-records-per-shard'].includes(k)))fail('configuration contains an unsupported field');
  if(v.mode!==undefined&&v.mode!=='topics')fail('mode must be topics');
  const maxShardBytes=v['max-shard-bytes']??262144,maxRecordsPerShard=v['max-records-per-shard']??128;
  if(!Number.isInteger(maxShardBytes)||maxShardBytes<16384||maxShardBytes>DELIVERY_LIMITS.partBytes)fail('max-shard-bytes requires 16384..1048576');
  if(!Number.isInteger(maxRecordsPerShard)||maxRecordsPerShard<1||maxRecordsPerShard>2000)fail('max-records-per-shard requires 1..2000');
  return {mode:'topics',maxShardBytes,maxRecordsPerShard};
}
export async function buildDelivery(graph:Value,options:DeliveryOptions){
  if(!options||options.mode!=='topics')fail('explicit topics options required');
  if(!/^[a-f0-9]{64}$/.test(graph.snapshotId??''))fail('graph snapshot identity is required');
  const graphId=graph.graph?.id??'website';if(!/^[a-z][a-z0-9-]{0,63}$/.test(graphId)||['constructor','prototype'].includes(graphId))fail('invalid graph identity');
  query(graph,'lookup',graph.objects?.[0]?.id??'urn:kg:empty');
  const kinds=['objects','relations','occurrences'],counts=Object.fromEntries(kinds.map(k=>[k,graph[k].length]));
  if(Object.values(counts).reduce((n,v)=>n+Number(v),0)>DELIVERY_LIMITS.records)fail('graph record budget exceeded');
  const header:Value={};for(const [k,v]of Object.entries(graph))if(!kinds.includes(k))header[k]=v;
  const byId=new Map<string,Value>(graph.objects.map((o:Value)=>[o.id,o])),groups=new Map<string,Value[]>();
  for(const kind of kinds)graph[kind].forEach((value:Value,position:number)=>{
    const scope=kind==='occurrences'?byId.get(value.target)?.scope:value.scope;
    if(typeof scope!=='string'||!scope.trim()||scope.length>8192||/[\u0000-\u001f]/u.test(scope))fail('record topic scope is unavailable');
    const rows=groups.get(scope)??[];rows.push({kind,position,value});groups.set(scope,rows);
  });
  const files:Record<string,string>={},parts:Value[]=[],objectParts=new Map<string,string>();let totalBytes=0;
  for(const [scope,rows]of [...groups].sort(([a],[b])=>a<b?-1:a>b?1:0)){
    const topic=await deliveryDigest(canonicalDelivery([graphId,scope]));
    const base={deliveryVersion:1,snapshotId:graph.snapshotId,graphId,status:graph.status,topic,scope,records:[]};
    const empty=canonicalDelivery(base),overhead=size(empty);let batch:Value[]=[],encoded:string[]=[],bytes=overhead;
    const flush=async()=>{if(!batch.length)return;const body=empty.replace('"records":[]','"records":['+encoded.join(',')+']')+'\n',sha256=await deliveryDigest(body),url=`topics/${sha256}.json`;
      if(size(body)>options.maxShardBytes)fail('whole record cannot fit the selected shard budget');
      if(Object.hasOwn(files,url))fail('duplicate immutable topic payload');files[url]=body;parts.push({url,sha256,bytes:size(body),topic,scope,records:batch.length});totalBytes+=size(body);
      for(const row of batch)if(row.kind==='objects')objectParts.set(row.value.id,url);batch=[];encoded=[];bytes=overhead;};
    for(const row of rows){const value=canonicalDelivery(row),extra=size(value)+(batch.length?1:0);
      if(batch.length&&(batch.length>=options.maxRecordsPerShard||bytes+extra+1>options.maxShardBytes))await flush();
      if(overhead+size(value)+1>options.maxShardBytes)fail('a whole record exceeds max-shard-bytes; raise the bounded limit or reduce that record');
      bytes+=size(value)+(batch.length?1:0);batch.push(row);encoded.push(value);
    }await flush();
  }
  if(parts.length>DELIVERY_LIMITS.parts)fail('too many topic shards; increase the bounded records-per-shard setting');
  const destinations=new Map<string,string[]>();for(const row of graph.occurrences){const list=destinations.get(row.target)??[];list.push(row.destination);destinations.set(row.target,list);}
  // Complete, public scope dependencies permit conservative selective loading.
  // Every incident relation joins its topic and both endpoint topics. This also
  // closes hard prerequisites, including alternative groups, without guessing
  // that an unloaded edge or cross-topic prerequisite does not exist.
  const scopeDependencies:Record<string,string[]>=Object.create(null);
  const dependencies=new Map<string,Set<string>>([...groups.keys()].map(scope=>[scope,new Set([scope])]));
  for(const edge of graph.relations){const scopes=[edge.scope,byId.get(edge.from)?.scope,byId.get(edge.to)?.scope] as string[];
    for(const scope of scopes)for(const dependency of scopes)dependencies.get(scope)!.add(dependency);}
  for(const [scope,values]of [...dependencies].sort(([a],[b])=>a<b?-1:a>b?1:0))scopeDependencies[scope]=[...values].sort();
  const index={deliveryVersion:1,snapshotId:graph.snapshotId,graphId,status:graph.status,scopeDependencies,objects:graph.objects.map((o:Value)=>({id:o.id,type:o.type,scope:o.scope,labels:o.labels,
    ...(o.aliases?{aliases:o.aliases}:{}),...(o.properties?.aliases?{properties:{aliases:o.properties.aliases}}:{}),destinations:destinations.get(o.id)??[],part:objectParts.get(o.id)}))};
  const indexBody=canonicalDelivery(index)+'\n';if(size(indexBody)>DELIVERY_LIMITS.indexBytes)fail('complete discovery index exceeds its budget');
  files['delivery-index.json']=indexBody;totalBytes+=size(indexBody);if(totalBytes>DELIVERY_LIMITS.totalBytes)fail('complete delivery inventory exceeds its byte budget');
  const manifest={deliveryVersion:1,snapshotId:graph.snapshotId,graphId,status:graph.status,graph:header,counts,
    index:{url:'delivery-index.json',sha256:await deliveryDigest(indexBody),bytes:size(indexBody)},parts};
  const body=canonicalDelivery(manifest)+'\n';if(size(body)>DELIVERY_LIMITS.manifestBytes)fail('delivery manifest exceeds its budget');
  if(totalBytes+size(body)>DELIVERY_LIMITS.totalBytes)fail('complete delivery inventory exceeds its byte budget');files['delivery.json']=body;
  return {files,descriptor:{deliveryVersion:1,manifest:'delivery.json',sha256:await deliveryDigest(body),bytes:size(body)},stats:{topics:groups.size,parts:parts.length,records:Object.values(counts).reduce((n,v)=>n+Number(v),0),indexBytes:size(indexBody),totalBytes:totalBytes+size(body)}};
}
