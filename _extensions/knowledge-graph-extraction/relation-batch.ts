// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Explicit, model-free private authoring jobs. No filesystem or render hooks.
import {canonical,sha256} from './assistance.ts';
import {relationSuggestions} from './relation-proposals.ts';

type Data=Record<string,any>;
export const RELATION_BATCH_LIMITS=Object.freeze({sources:256,windows:1024,sourceBytes:32*1024*1024,outputBytes:128*1024*1024,scanUTF16:512*1024*1024});
const fail=(message:string):never=>{throw new Error('knowledge-graph-extraction: relation batch: '+message);};
const encoder=new TextEncoder();
function copy(value:any,depth=0,budget={nodes:0}):any{
 if(++budget.nodes>300000||depth>48)fail('literal input exceeds structural bounds');
 if(value===null||value===undefined||typeof value==='boolean')return value;
 if(typeof value==='string'){if(!value.isWellFormed())fail('malformed Unicode input');return value;}
 if(typeof value==='number'){if(!Number.isFinite(value))fail('nonfinite literal input');return value;}
 if(typeof value!=='object'||![Object.prototype,Array.prototype,null].includes(Object.getPrototypeOf(value)))fail('plain literal input is required');
 const ds=Object.getOwnPropertyDescriptors(value);for(const key of Reflect.ownKeys(ds))if(typeof key!=='string'||!Object.hasOwn(ds[key],'value'))fail('accessors and symbols are unsupported');
 if(Array.isArray(value)){if(value.length>20000||Object.keys(ds).some(key=>key!=='length'&&!/^(?:0|[1-9]\d*)$/u.test(key)))fail('array inventory exceeds its bound');return Array.from({length:value.length},(_,i)=>{if(!Object.hasOwn(ds,String(i)))fail('sparse literal arrays are unsupported');return copy(ds[i].value,depth+1,budget);});}
 const out:Data={};for(const [key,d]of Object.entries(ds))Object.defineProperty(out,key,{value:copy(d.value,depth+1,budget),enumerable:true,writable:true,configurable:true});return out;
}
function fields(value:Data,names:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!names.includes(key)))fail('unsupported field in the closed batch contract');}
function positive(value:any,max:number,name:string):number{if(!Number.isSafeInteger(value)||value<1||value>max)fail(name+' exceeds the finite batch bound');return value;}
function sourcePath(value:any):string{if(typeof value!=='string'||!value.length||value.length>4096||/[\u0000-\u001f:\\]/u.test(value)||value.startsWith('/')||value.split('/').some((p:string)=>!p||p==='.'||p==='..')||value.split('/').some((p:string)=>['_extensions','.git','.quarto'].includes(p.toLowerCase())))fail('source path must be an ordinary project source');return value;}
function digest(value:any):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))fail('SHA-256 identity is required');return value;}
function safeBoundary(text:string,at:number):number{
 if(at>0&&at<text.length&&((/[\udc00-\udfff]/u.test(text[at])&&/[\ud800-\udbff]/u.test(text[at-1]))||(text[at-1]==='\r'&&text[at]==='\n')))return at-1;
 return at;
}

/** Whole-source coverage windows, not independent parsed documents. Every
 * request retains the original source, anchor stack and protected ranges. */
export function planRelationWindows(text:string,options:Data={}):{start:number;end:number;text:string}[]{
 fields(options,['windowSize','overlap']);if(typeof text!=='string'||text.length>2_000_000)fail('source exceeds the supported two-million UTF16 bound');if(!text.isWellFormed())fail('malformed Unicode input');
 const windowSize=positive(options.windowSize??12000,12000,'window size'),overlap=positive(options.overlap??2048,4096,'overlap');
 if(windowSize<4096||overlap<2048||overlap>=windowSize-1)fail('windows require at least4096 UTF16 units and2048 overlapping units');
 const result=[];let start=0;
 while(start<text.length){const end=safeBoundary(text,Math.min(text.length,start+windowSize));if(end<=start)fail('window planning made no progress');result.push({start,end,text:text.slice(start,end)});if(end===text.length)break;const next=safeBoundary(text,end-overlap);if(next<=start)fail('overlap prevents bounded progress');start=next;}
 return result;
}

/** Build all private review sidecars; only the last callback may publish an
 * index. A refusal may leave uncommitted private sidecars, never a new index.
 * Callers own confined exclusive writes and freshness checks against files. */
export async function buildRelationBatch(input:Data,io:{writeSidecar:(name:string,sidecar:Data,identity:Data)=>Promise<void>;verifyFresh:()=>Promise<void>;writeIndex:(index:Data)=>Promise<void>}):Promise<Data>{
 input=copy(input);fields(input,['sources','context','scope','limits']);fields(input.context,['schema','objects','namespaces','existingRelations','declarationsHash','policy','policyFile','algorithmHash']);
 if(!Array.isArray(input.sources))fail('sources require an explicit captured inventory');
 const limits:Data={...RELATION_BATCH_LIMITS};if(input.limits!==undefined){fields(input.limits,Object.keys(limits));for(const [key,value]of Object.entries(input.limits))limits[key]=positive(value,limits[key],key);}
 if(input.sources.length>limits.sources)fail('source inventory exceeds the source budget');
 if(!io||typeof io.writeSidecar!=='function'||typeof io.verifyFresh!=='function'||typeof io.writeIndex!=='function')fail('private staging and freshness callbacks are required');
 const seen=new Set<string>(),sources:Data[]=[],jobs:Data[]=[];let totalSourceBytes=0,scanUTF16=0,minimumOutput=0;
 for(const raw of input.sources){fields(raw,['path','text','hash']);const path=sourcePath(raw.path);if(seen.has(path))fail('source inventory repeats a path');seen.add(path);const windows=planRelationWindows(raw.text),bytes=encoder.encode(raw.text).length;digest(raw.hash);
  if(bytes>4_000_000)fail('one source exceeds four million UTF8 bytes');totalSourceBytes+=bytes;scanUTF16+=raw.text.length*windows.length;minimumOutput+=bytes*windows.length;
  if(totalSourceBytes>limits.sourceBytes||scanUTF16>limits.scanUTF16||minimumOutput>limits.outputBytes)fail('source, repeated-scan or minimum output budget exceeded; split the authoring job');
  const sourceIndex=sources.length,source={path,hash:raw.hash,utf16Length:raw.text.length,bytes,windows:[],coveredRanges:raw.text.length?[{start:0,end:raw.text.length}]:[],windowCoverage:'complete'};
  sources.push(source);for(const window of windows){jobs.push({sourceIndex,source:raw,window,name:`source-${String(sourceIndex+1).padStart(3,'0')}-window-${String(source.windows.length+1).padStart(4,'0')}.json`});source.windows.push({start:window.start,end:window.end});if(jobs.length>limits.windows)fail('window inventory exceeds the job budget');}
 }
 // Validate every source hash before any staging, including empty sources.
 for(const source of input.sources)if(await sha256(source.text)!==source.hash)fail('captured source hash differs from its exact text');
 if(!jobs.length){const text='\n';await relationSuggestions({...input.context,source:{path:'batch-empty-validation.qmd',text,hash:await sha256(text)},slices:[{start:0,end:1,text}]});}
 let scope:Data|undefined;if(input.scope!==undefined){fields(input.scope,['sourcePaths','dependencyDigest','batchAlgorithmHash','inventoryHash','inputFiles']);if(!Array.isArray(input.scope.sourcePaths)||input.scope.sourcePaths.length>10000)fail('captured scope inventory exceeds its bound');const paths=input.scope.sourcePaths.map(sourcePath);if(new Set(paths).size!==paths.length||input.sources.some((s:Data)=>!paths.includes(s.path)))fail('selected sources must be a unique subset of captured scope');
  const files=input.scope.inputFiles??[];if(!Array.isArray(files)||files.length>10000)fail('freshness input inventory exceeds its bound');for(const file of files){fields(file,['path','hash','absent']);if(typeof file.path!=='string'||!file.path.length||/[\u0000-\u001f]/u.test(file.path))fail('freshness input path is invalid');if(file.absent===true){if(file.hash!==undefined)fail('absent input cannot carry a byte hash');}else{if(file.absent!==undefined)fail('absence marker must be true');digest(file.hash);}}
  scope={sourcePaths:[...paths].sort(),dependencyDigest:digest(input.scope.dependencyDigest),batchAlgorithmHash:digest(input.scope.batchAlgorithmHash),...(input.scope.inventoryHash===undefined?{}:{inventoryHash:digest(input.scope.inventoryHash)}),inputFiles:files};}
 const groups=new Map<string,Data>();let outputBytes=0;
 for(const job of jobs){const sidecar=await relationSuggestions({...input.context,source:job.source,slices:[job.window]});if(sidecar.status!=='unreviewed'||sidecar.request.mode!=='deterministic'||sidecar.provenance.model!==null)fail('batch requires only model-free unreviewed sidecars');
  const serialized=canonical(sidecar)+'\n',bytes=encoder.encode(serialized).length;outputBytes+=bytes;if(outputBytes>limits.outputBytes)fail('private sidecar output budget exceeded; no index was committed');
  const identity={sha256:await sha256(serialized),bytes};await io.writeSidecar(job.name,copy(sidecar),{...identity});
  const row=sources[job.sourceIndex].windows.find((v:Data)=>v.start===job.window.start)!;Object.assign(row,{sidecar:job.name,...identity,requestId:sidecar.requestId,candidateIds:sidecar.candidates.flatMap((v:Data)=>[v.candidateId,...(v.supportingEvidence??[]).map((e:Data)=>e.candidateId)])});
  for(const c of sidecar.candidates){let group=groups.get(c.record.id);if(!group){group={id:c.record.id,type:c.record.type,scope:c.record.scope,from:c.record.from,to:c.record.to,evidence:[]};groups.set(c.record.id,group);}for(const support of [{candidateId:c.candidateId,evidence:c.evidence,source:c.record.source},...(c.supportingEvidence??[])]){
    let item=group.evidence.find((v:Data)=>v.candidateId===support.candidateId);if(!item){item={candidateId:support.candidateId,sourcePath:job.source.path,sourceHash:job.source.hash,source:support.source,evidence:support.evidence,sidecars:[]};group.evidence.push(item);}item.sidecars.push({path:job.name,requestId:sidecar.requestId});
  }}
 }
 const body={version:1,operation:'relation-project-proposals',status:'unreviewed',mode:'deterministic',windowSize:12000,overlap:2048,...(scope?{scope}:{}),sources,relations:[...groups.values()].sort((a,b)=>a.id<b.id?-1:1),budgets:{...limits,sourceBytesUsed:totalSourceBytes,scanUTF16Used:scanUTF16,sidecarBytesUsed:outputBytes,windowJobs:jobs.length},coverage:{sourceInventory:scope?'captured-current-project-scope':'caller-supplied-source-inventory',selectedSourceCount:sources.length,windowCoverage:'complete',semanticCompleteness:'not-established',skippedWindows:0},qualification:'Every selected source UTF16 position is covered by model-free windows; only eligible complete original clauses can propose relations. This is not semantic completeness, entailment, review, publication or proof. Separate review-relations remains required for each sidecar.'};
 const index={...body,indexId:await sha256(canonical(body))},indexBytes=encoder.encode(canonical(index)+'\n').length;
 if(outputBytes+indexBytes>limits.outputBytes)fail('private index exceeds the remaining output budget');
 await io.verifyFresh();await io.writeIndex(copy(index));return index;
}
