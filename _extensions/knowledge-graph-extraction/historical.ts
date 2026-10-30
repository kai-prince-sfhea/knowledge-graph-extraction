// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Data-only, private historical inspection. Never use this to publish old facts.
import {canonicalDelivery,deliveryDigest} from './delivery.js';
import {query} from './query.js';
type Value=Record<string,any>;
const HASH=/^[a-f0-9]{64}$/;
const fail=(message:string):never=>{throw new Error('knowledge-graph-extraction: history: '+message);};
export const HISTORY_LIMITS={receiptBytes:8*1024*1024,artifactBytes:32*1024*1024,totalBytes:128*1024*1024,artifacts:16384};
const captureDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value;
export function historicalReceipt(value:unknown):Value{
  if(!value||typeof value!=='object'||Array.isArray(value))fail('receipt must be a mapping');
  const v=value as Value;
  if(Object.keys(v).some(k=>!['cacheVersion','manifest','manifestHash','artifacts','capturedAt'].includes(k))||![0,1].includes(v.cacheVersion)||v.cacheVersion===1&&!captureDate(v.capturedAt)||v.cacheVersion===0&&v.capturedAt!==undefined||!v.manifest||typeof v.manifest!=='object'||!HASH.test(v.manifest.snapshotId??'')||!HASH.test(v.manifest.dependencyDigest??'')||!HASH.test(v.manifestHash??'')||!Array.isArray(v.artifacts)||v.artifacts.length>HISTORY_LIMITS.artifacts)fail('unsupported or damaged receipt');
  const names=new Set<string>(),paths=new Map<string,string>();
  for(const a of v.artifacts){
    if(!a||typeof a!=='object'||Object.keys(a).some(k=>!['path','cacheName','hash'].includes(k))||typeof a.cacheName!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(a.cacheName)||typeof a.path!=='string'||!HASH.test(a.hash??'')||names.has(a.cacheName)||paths.has(a.path)&&paths.get(a.path)!==a.hash)fail('invalid artifact receipt');
    const parts=a.path.split('/');if(a.path!=='report.html'&&(parts[0]!=='generations'||parts[1]!==v.manifest.snapshotId||parts.length<3)||parts.some((p:string)=>!p||p==='.'||p==='..'||/[\\:%?#\s]/u.test(p)))fail('artifact path escaped its historical generation');
    names.add(a.cacheName);paths.set(a.path,a.hash);
  }
  const base=`generations/${v.manifest.snapshotId}/`;
  for(const [field,name]of [['graph','graph.json'],['index','index.json'],['report','report.html']]){
    if(v.manifest[field]!==base+name||!v.artifacts.some((a:Value)=>a.path===base+name))fail('receipt omits a required historical artifact');
  }
  const expected=[{path:v.manifest.graph,cacheName:'graph.json'},{path:v.manifest.index,cacheName:'index.json'},
    {path:v.manifest.report,cacheName:'report.html'},{path:'report.html',cacheName:'report-alias.html'}];
  if(v.manifest.navigation!==undefined){expected.push({path:v.manifest.navigation,cacheName:'navigation.html'});if(!v.manifest.assets||typeof v.manifest.assets!=='object'||Array.isArray(v.manifest.assets))fail('navigation asset mappings are missing');
    for(const [name,path]of Object.entries(v.manifest.assets))expected.push({path:path as string,cacheName:name});}
  if(v.manifest.reportAssets!==undefined){const assets=v.manifest.reportAssets,names=['graph-view.css','graph-theme.js'];if(!assets||typeof assets!=='object'||Array.isArray(assets)||Object.keys(assets).length!==names.length||names.some(name=>assets[name]!==base+name))fail('source report asset mappings are missing or invalid');for(const name of names)expected.push({path:assets[name],cacheName:'report-'+name});}
  for(const [name,path]of Object.entries(v.manifest.exports??{}))expected.push({path:path as string,cacheName:name});
  for(const [name,path]of Object.entries(v.manifest.composition??{}))expected.push({path:path as string,cacheName:'composition-'+name.replaceAll('/','--')});
  const selected=new Set(v.artifacts.map((a:Value)=>a.path+'\n'+a.cacheName));
  if(selected.size!==expected.length||expected.some(a=>!selected.has(a.path+'\n'+a.cacheName)))fail('receipt artifact inventory does not match its complete manifest');
  return {...v,artifacts:[...v.artifacts].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:a.cacheName<b.cacheName?-1:a.cacheName>b.cacheName?1:0)};
}
/** Hash every receipt-bound artifact before exposing any historical data. The
 * receipt is an integrity record, not authentication or publication permission. */
export async function verifiedHistoricalSnapshot(value:unknown,read:(name:string)=>Promise<Uint8Array>){
  const receipt=historicalReceipt(value);
  if(await deliveryDigest(canonicalDelivery(receipt.manifest)+'\n')!==receipt.manifestHash)fail('manifest digest mismatch');
  const graphs:Value[]=[];let total=0;
  for(const artifact of receipt.artifacts){
    const bytes=await read(artifact.cacheName);total+=bytes.byteLength;
    if(bytes.byteLength>HISTORY_LIMITS.artifactBytes||total>HISTORY_LIMITS.totalBytes)fail('historical artifact inventory exceeds its inspection budget');
    if(await deliveryDigest(bytes)!==artifact.hash)fail('historical artifact digest mismatch; no view generated');
    const logical=artifact.path.slice(`generations/${receipt.manifest.snapshotId}/`.length);
    if(logical!=='graph.json'&&!/^graphs\/[a-z][a-z0-9-]{0,63}\/graph\.json$/.test(logical))continue;
    let graph:Value;try{graph=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('historical graph requires valid UTF-8 JSON');}
    if(graph!.snapshotId!==receipt.manifest.snapshotId)fail('graph belongs to a different historical snapshot');
    query(graph!,'lookup',graph!.objects?.[0]?.id??'urn:kg:empty');
    const id=logical==='graph.json'?'website':logical.split('/')[1];
    if(graph!.graph?.id!==undefined&&graph!.graph.id!==id)fail('historical graph identity disagrees with its receipt');
    graphs.push({id,label:graph!.graph?.label??(id==='website'?'Website':id),graph:graph!});
  }
  if(!graphs.some(g=>g.id==='website'))fail('historical website graph is missing');
  graphs.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {historicalVersion:1,snapshotId:receipt.manifest.snapshotId,receiptHash:receipt.manifestHash,receiptVersion:receipt.cacheVersion,dependencyDigest:receipt.manifest.dependencyDigest,
    status:'historical-not-current',capturedAt:receipt.capturedAt??'unrecorded',artifactsVerified:receipt.artifacts.length,totalBytes:total,graphs,
    publicationPermission:'unassessed',sourceFreshness:'unassessed',publicRestoration:false};
}
/** Select only already verified receipts for ONE semantic snapshot. A recorded
 * UTC capture date orders modern receipts. Legacy undated receipts sort last;
 * a hash breaks equal-date ties deterministically, never as a chronology claim. */
export function selectHistoricalSnapshot(snapshots:Value[],receiptHash?:string):Value{
  if(!Array.isArray(snapshots)||!snapshots.length||receiptHash!==undefined&&!HASH.test(receiptHash))fail('a verified historical receipt is required');
  const ids=new Set<string>();
  for(const s of snapshots){if(s.historicalVersion!==1||s.status!=='historical-not-current'||!HASH.test(s.snapshotId??'')||!HASH.test(s.receiptHash??'')||s.capturedAt!=='unrecorded'&&!captureDate(s.capturedAt))fail('a verified historical receipt is required');ids.add(s.snapshotId);}
  if(ids.size!==1)fail('receipt selection requires one semantic snapshot');
  const candidates=snapshots.filter(s=>receiptHash===undefined||s.receiptHash===receiptHash);
  if(!candidates.length)fail('selected receipt is unavailable or did not verify');
  return [...candidates].sort((a,b)=>{
    if(a.capturedAt!==b.capturedAt){if(a.capturedAt==='unrecorded')return 1;if(b.capturedAt==='unrecorded')return -1;return a.capturedAt>b.capturedAt?-1:1;}
    return a.receiptHash<b.receiptHash?-1:a.receiptHash>b.receiptHash?1:0;
  })[0];
}
function escape(value:unknown):string{return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
/** Self-contained file-viewable HTML: no JS, fetches, storage or source links. */
export function historicalHtml(snapshot:Value,selectedGraph?:string):string{
  if(snapshot.historicalVersion!==1||snapshot.status!=='historical-not-current'||!HASH.test(snapshot.snapshotId??'')||!HASH.test(snapshot.receiptHash??'')||!Array.isArray(snapshot.graphs))fail('verified historical data required');
  if(selectedGraph!==undefined&&!/^[a-z][a-z0-9-]{0,63}$/.test(selectedGraph))fail('invalid selected graph identity');
  const graphs=selectedGraph?snapshot.graphs.filter((g:Value)=>g.id===selectedGraph):snapshot.graphs;
  if(!graphs.length)fail('selected graph is unavailable in this historical receipt');
  const body=graphs.map((entry:Value)=>{const graph=entry.graph;
    const objects=graph.objects.map((o:Value)=>`<li><h3>${escape(Object.values(o.labels??{})[0]??o.id)}</h3><p><code>${escape(o.id)}</code> — ${escape(o.type)}, ${escape(o.scope)}</p>${o.summary?`<p>${escape(o.summary)}</p>`:''}<pre>${escape(JSON.stringify(o,null,2))}</pre></li>`).join('');
    const relations=graph.relations.map((e:Value)=>`<li><code>${escape(e.type)}</code>: <code>${escape(e.from)}</code> → <code>${escape(e.to)}</code><pre>${escape(JSON.stringify(e,null,2))}</pre></li>`).join('');
    const sources=graph.occurrences.map((o:Value)=>`<li><code>${escape(o.target)}</code>: <code>${escape(o.destination)}</code></li>`).join('');
    return `<section><h2>${escape(entry.label)} — ${escape(entry.id)}</h2><p>Coverage recorded then: <strong>${escape(graph.status)}</strong>. ${graph.objects.length} objects; ${graph.relations.length} relations.</p><h3>Historical objects</h3><ul>${objects}</ul><h3>Historical relations</h3><ul>${relations}</ul><h3>Recorded destinations (text only)</h3><ul>${sources}</ul></section>`;}).join('');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Historical knowledge graph — not current</title><style>body{font:1rem/1.5 system-ui,sans-serif;max-width:75rem;margin:auto;padding:1rem}h1{line-height:1.2}.warning{border:.2rem solid currentColor;padding:1rem}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}li{margin-block:1rem}section{border-block-start:1px solid currentColor;margin-top:2rem}</style></head><body><main><h1>Historical knowledge graph — not current</h1><p class="warning">Private historical inspection only. This is not the current website, current source truth, publication permission or permission to restore withdrawn records. Source destinations are deliberately plain text. Do not put this file in published website resources.</p><p>Recorded semantic snapshot: <code>${escape(snapshot.snapshotId)}</code>. Manifest receipt: <code>${escape(snapshot.receiptHash)}</code>. Dependency context: <code>${escape(snapshot.dependencyDigest)}</code>. ${snapshot.capturedAt==='unrecorded'?'Capture date was not recorded.':`Receipt first captured at <time>${escape(snapshot.capturedAt)}</time>.`} ${snapshot.artifactsVerified} receipt-bound artifacts verified; hashes detect corruption, not authenticity.</p>${body}<p>No public manifest, source, review decision or reader storage was changed. Historical source pages are not reconstructed by this view.</p></main></body></html>\n`;
  if(new TextEncoder().encode(html).byteLength>HISTORY_LIMITS.artifactBytes)fail('historical HTML exceeds its inspection budget');return html;
}
