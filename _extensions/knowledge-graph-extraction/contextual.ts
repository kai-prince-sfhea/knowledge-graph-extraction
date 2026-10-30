// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Private deterministic sense proposals. This is not a semantic parser or linker.
import {canonical,sha256,sliceBounds} from './assistance.ts';
import {validateObjectType,type SchemaContract} from './schema.ts';

type Data=Record<string,any>;
export const CONTEXTUAL_VERSION=1;
export const CONTEXTUAL_LIMITS=Object.freeze({source:2_000_000,selection:12000,slices:16,objects:2000,terms:2000,mentions:200,context:512});
const fail=(message:string):never=>{throw new Error('knowledge-graph-extraction: contextual assistance: '+message);};
function map(v:any,name:string):Data{if(!v||typeof v!=='object'||Array.isArray(v))fail(name+' must be a mapping');return v;}
function fields(v:Data,names:string[],name:string){if(Object.keys(v).some(k=>!names.includes(k)))fail(name+' contains an unsupported field');}
function text(v:any,name:string,max=256):string{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f]/u.test(v))fail(name+' requires bounded nonblank text');return v;}
function hash(v:any,name:string):string{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail(name+' requires a SHA-256 digest');return v;}
function path(v:any):string{const s=text(v,'source path',4096).replaceAll('\\','/');if(s.includes(':')||s.startsWith('/')||s.split('/').some(p=>!p||p==='.'||p==='..'))fail('source path must stay within the project');return s;}
function identifier(v:any,namespaces:Data={}):string{
  let s=text(v,'identity',8192),colon=s.indexOf(':');if(colon>0&&Object.hasOwn(namespaces,s.slice(0,colon)))s=String(namespaces[s.slice(0,colon)])+s.slice(colon+1);
  if(/^urn:[A-Za-z0-9][A-Za-z0-9-]{0,31}:[^\s]+$/u.test(s))return s;
  try{const u=new URL(s);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||/\s/u.test(s))fail('identity must be an existing absolute URI');}catch{fail('identity must be an existing absolute URI');}
  return s;
}
function strings(v:any,name:string,max=32):string[]{if(v===undefined)return [];if(!Array.isArray(v)||v.length>max)fail(name+' must be a bounded text sequence');const out=v.map(x=>text(x,name));if(new Set(out).size!==out.length)fail(name+' repeats a value');return out.sort();}
const esc=(v:string)=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const word=(v:string|undefined)=>v!==undefined&&/[\p{L}\p{N}\p{M}_]/u.test(v);
function occurrences(content:string,phrase:string):{start:number;end:number}[]{
  const pattern=phrase.trim().split(/[ \t]+/u).map(esc).join('[ \\t]+'),regex=new RegExp(pattern,'giu'),rows=[];let match;
  while((match=regex.exec(content))!==null){const start=match.index,end=start+match[0].length;
    const before=[...content.slice(Math.max(0,start-2),start)].at(-1),after=[...content.slice(end,end+2)][0];
    if(!word(before)&&!word(after))rows.push({start,end});
  }return rows;
}
function phrasePresent(content:string,phrase:string):boolean{return occurrences(content,phrase).length>0;}

/** Mask excluded QMD without changing any UTF-16 offset. This conservative
 * lexical fragment intentionally does not emulate the complete Pandoc reader. */
function prose(content:string):{masked:string;anchors:{start:number;anchor:string|null}[];counts:Map<string,number>}{
  const chars=content.split(''),anchors:{start:number;anchor:string|null}[]=[],counts=new Map<string,number>();
  const mask=(start:number,end:number)=>{for(let i=start;i<end;i++)if(chars[i]!=='\n'&&chars[i]!=='\r')chars[i]=' ';};
  for(const regex of [/<!--[\s\S]*?(?:-->|$)/g,/<(script|style|pre|code|textarea|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,/<[^>\r\n]+>/g]){
    for(const match of content.matchAll(regex))mask(match.index!,match.index!+match[0].length);
  }
  const lines=[...content.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(m=>m[0].length),headings=new Map<number,string>(),explicitSections=new Set<number>(),divs:{anchor:string|null;explicit:boolean}[]=[];
  let front=false,frontClosed=false,fence:{char:string;length:number}|null=null,current:string|undefined;
  for(const [index,line]of lines.entries()){
    const start=line.index!,raw=chars.slice(start,start+line[0].length).join('').replace(/[\r\n]+$/u,''),trimmed=raw.replace(/^\ufeff/u,'');
    if(index===0&&trimmed==='---'){front=true;mask(start,start+line[0].length);continue;}
    if(front){mask(start,start+line[0].length);if(trimmed==='---'||trimmed==='...'){front=false;frontClosed=true;}continue;}
    const marker=/^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if(fence){mask(start,start+line[0].length);if(marker&&marker[1][0]===fence.char&&marker[1].length>=fence.length&&/^ {0,3}(?:`+|~+)\s*$/u.test(raw))fence=null;continue;}
    if(marker){fence={char:marker[1][0],length:marker[1].length};mask(start,start+line[0].length);continue;}
    if(/^(?: {4}|\t)/u.test(raw)){mask(start,start+line[0].length);continue;}
    const heading=/^ {0,3}(#{1,6})\s+/.exec(raw),div=/^ {0,3}:::+\s*(.*)$/u.exec(raw);
    if(heading||div){
      const id=/\{[^}\r\n]*#([^\s{}"'<>]+)[^}\r\n]*\}/u.exec(raw)?.[1];
      if(id)counts.set(id,(counts.get(id)??0)+1);
      const explicit=/\b(?:data-kg-id|semantic-id)\s*=/u.test(raw);
      if(heading){const level=heading[1].length;for(const key of headings.keys())if(key>=level)headings.delete(key);for(const key of explicitSections)if(key>=level)explicitSections.delete(key);if(id)headings.set(level,id);if(explicit)explicitSections.add(level);}
      if(div){if(!div[1])divs.pop();else divs.push({anchor:id??null,explicit});}
      current=[...divs].reverse().find(v=>v.anchor!==null)?.anchor??[...headings].sort(([a],[b])=>b-a)[0]?.[1];
      anchors.push({start:start+line[0].length,anchor:current??null});mask(start,start+line[0].length);continue;
    }
    // Raw HTML/comment/code/link text is not eligible prose. Masking happens
    // globally below as well, so multiline blocks cannot supply context cues.
    // Existing authored identities take precedence. Their native annotation
    // workflow owns them; this lexical helper must not propose another sense.
    if(explicitSections.size||divs.some(v=>v.explicit)){mask(start,start+line[0].length);continue;}
    for(const match of raw.matchAll(/\[[^\]\r\n]*\]\{[^}\r\n]*\b(?:data-kg-id|semantic-id)\s*=[^}\r\n]*\}/gu))mask(start+match.index!,start+match.index!+match[0].length);
    for(const match of raw.matchAll(/(`+)[^\r\n]*?\1|!?\[[^\]\r\n]*\]\([^\)\r\n]*\)|!?\[[^\]\r\n]*\]\[[^\]\r\n]*\]|\{[^}\r\n]*\}|https?:\/\/[^\s<>]+/gu))mask(start+match.index!,start+match.index!+match[0].length);
    const unmatched=chars.slice(start,start+raw.length).indexOf('`');if(unmatched>=0)mask(start+unmatched,start+raw.length);
    if(/\{\{[<%]|^ {0,3}\[[^\]]+\]:/u.test(raw))mask(start,start+line[0].length);
  }
  if(front&&!frontClosed)mask(0,content.length);
  return {masked:chars.join(''),anchors,counts};
}
// The semantic proposal helper shares these conservative source boundaries.
// It may discover new wording/coreferences, but cannot invent source anchors.
export const scanContextualProse=prose;
function definitions(objects:Data[],schema:SchemaContract):Data[]{
  if(!Array.isArray(objects)||objects.length>CONTEXTUAL_LIMITS.objects)fail('catalogue exceeds its bounded object inventory');
  const ids=new Set<string>();return objects.filter(item=>item.eligible===true).map(item=>{
    const id=identifier(item.id);if(ids.has(id))fail('catalogue repeats a semantic identity');ids.add(id);
    const labels=map(item.labels,'labels'),aliases=item.aliases===undefined?{}:map(item.aliases,'aliases');
    if(Object.keys(labels).length>32||!Object.keys(labels).length||Object.keys(aliases).length>32)fail('language labels exceed their inventory');
    for(const [language,label]of Object.entries(labels)){if(!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language))fail('label language is invalid');text(label,'label');}
    const copiedAliases:Data={};for(const [language,values]of Object.entries(aliases)){
      if(!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language))fail('alias language is invalid');copiedAliases[language]=strings(values,'aliases',32);
    }
    const locations=[...(item.source?[item.source]:[]),...(item.occurrences??[])];if(locations.length>10000)fail('occurrences exceed their inventory');
    const known=locations.map(value=>({path:path(value.path),anchor:text(value.anchor,'anchor',512)}));
    return {id,type:validateObjectType(schema,item.type),scope:text(item.scope,'scope'),labels:{...labels},aliases:copiedAliases,eligible:true,
      occurrences:[...new Map(known.map(v=>[canonical(v),v])).values()].sort((a,b)=>canonical(a)<canonical(b)?-1:1)};
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
function policyValue(value:any,defs:Data[],schema:SchemaContract,namespaces:Data):Data{
  const valueMap=map(value,'policy');fields(valueMap,['version','defaults','senses'],'policy');if(valueMap.version!==1)fail('policy requires version 1');
  const defaults=map(valueMap.defaults??{},'defaults');fields(defaults,['language','scopes','types'],'defaults');
  const language=defaults.language??'en';if(typeof language!=='string'||!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language))fail('default language is invalid');
  const types=strings(defaults.types,'default types');for(const type of types)validateObjectType(schema,type);
  const scopes=strings(defaults.scopes,'default scopes'),known=new Set(defs.map(d=>d.id)),seen=new Set<string>();
  if(!Array.isArray(valueMap.senses)||valueMap.senses.length>CONTEXTUAL_LIMITS.objects)fail('policy requires a bounded senses sequence');
  const senses=valueMap.senses.map((raw:any)=>{
    const item=map(raw,'sense');fields(item,['id','require-any','require-all','exclude'],'sense');const id=identifier(item.id,namespaces);
    if(!known.has(id)||seen.has(id))fail('sense must select a distinct existing public catalogue identity');seen.add(id);
    return {id,'require-any':strings(item['require-any'],'positive contexts'),'require-all':strings(item['require-all'],'required contexts'),exclude:strings(item.exclude,'excluded contexts')};
  }).sort((a:Data,b:Data)=>a.id<b.id?-1:1);
  return {version:1,defaults:{language,scopes,types},senses};
}
function requestInput(input:Data):Data{
  fields(input,['source','slices','schema','objects','namespaces','declarationsHash','policy','algorithmHash','policyFile'],'request');
  const source=map(input.source,'source');fields(source,['path','text','hash'],'source');
  if(typeof source.text!=='string'||source.text.length>CONTEXTUAL_LIMITS.source)fail('source exceeds its text bound');
  const slices=input.slices;if(!Array.isArray(slices)||!slices.length||slices.length>CONTEXTUAL_LIMITS.slices)fail('selected slices exceed their inventory');
  let total=0;const selected=slices.map(value=>{fields(map(value,'slice'),['start','end','text'],'slice');const bounds=sliceBounds(source.text,value.start,value.end,'contextual slice');
    if(value.text!==source.text.slice(bounds.start,bounds.end))fail('selected slice must equal the unchanged source');total+=value.text.length;return {...bounds,text:value.text};});
  if(total>CONTEXTUAL_LIMITS.selection)fail('selected prose exceeds 12000 characters');
  const defs=definitions(input.objects,input.schema),namespaces={...map(input.namespaces??{},'namespaces')};
  const policy=policyValue(input.policy,defs,input.schema,namespaces);
  let policyFile;
  if(input.policyFile!==undefined){fields(map(input.policyFile,'policy file'),['path','hash'],'policy file');policyFile={path:path(input.policyFile.path),hash:hash(input.policyFile.hash,'policy file')};}
  return {source:{path:path(source.path),text:source.text,hash:hash(source.hash,'source')},slices:selected,schema:input.schema,objects:defs,namespaces,
    declarationsHash:hash(input.declarationsHash,'declarations'),policy,algorithmHash:hash(input.algorithmHash,'algorithm'),...(policyFile?{policyFile}:{})};
}
const instructionLike=(v:string)=>/ignore\s+(?:(?:all|any|the)\s+)?(?:previous|above|prior)\s+instructions|system\s+prompt|(?:set|make)\s+public\s*[:=]\s*true|execute\s+(?:a\s+)?(?:command|script)/iu.test(v);

/** Exact labels only discover spans. A distinct, positive contextual rule must
 * support one sense; defaults and frequency never count as semantic evidence. */
export async function contextualSuggestions(input:Data):Promise<Data>{
  const request=requestInput(input);if(await sha256(request.source.text)!==request.source.hash)fail('source bytes do not match their hash');
  const requestId=await sha256(canonical(request)),parsed=prose(request.source.text),rules=new Map<string,Data>(request.policy.senses.map((r:Data)=>[r.id,r]));
  const terms=new Map<string,{term:string;options:Data[]}>(),language=request.policy.defaults.language;
  for(const object of request.objects){const selected=Object.hasOwn(object.labels,language)?language:language.split('-')[0];
    for(const term of [object.labels[selected],...(object.aliases[selected]??[])].filter(Boolean)){
      const key=term.toLowerCase(),row=terms.get(key)??{term,options:[]};if(!row.options.some(v=>v.id===object.id))row.options.push(object);terms.set(key,row);
    }
  }
  if(terms.size>CONTEXTUAL_LIMITS.terms)fail('catalogue terminology exceeds its bounded inventory');
  const matches=new Map<string,Data>();
  for(const {term,options}of terms.values())for(const span of occurrences(parsed.masked,term)){
    if(!request.slices.some((slice:Data)=>span.start>=slice.start&&span.end<=slice.end))continue;
    const key=span.start+':'+span.end,previous=matches.get(key);matches.set(key,{...span,options:[...(previous?.options??[]),...options]});
    if(matches.size>CONTEXTUAL_LIMITS.mentions*4)fail('mention discovery exceeds its bound; select less prose');
  }
  // Longest explicit phrase wins over its contained shorter aliases. Distinct
  // senses sharing that longest phrase remain competitors, never first-match.
  const ordered=[...matches.values()].sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start),chosen:Data[]=[];
  for(const match of ordered)if(!chosen.some(v=>match.start<v.end&&match.end>v.start))chosen.push(match);
  if(chosen.length>CONTEXTUAL_LIMITS.mentions)fail('mention inventory exceeds its bound; select less prose');
  const mentions=[];
  for(const match of chosen.sort((a,b)=>a.start-b.start)){
    const anchor=parsed.anchors.filter(v=>v.start<=match.start).at(-1)?.anchor;
    const selection=request.slices.find((slice:Data)=>match.start>=slice.start&&match.end<=slice.end)!;
    const before=parsed.masked.slice(selection.start,match.start),after=parsed.masked.slice(match.end,selection.end);
    const left=[...before.matchAll(/(?:\r?\n)[ \t]*(?:\r?\n)/g)].at(-1),right=/(?:\r?\n)[ \t]*(?:\r?\n)/u.exec(after);
    let start=Math.max(selection.start,left?selection.start+left.index!+left[0].length:selection.start,match.start-CONTEXTUAL_LIMITS.context/2);
    let end=Math.min(selection.end,right?match.end+right.index:selection.end,match.end+CONTEXTUAL_LIMITS.context/2);
    // Context bounds also retain complete surrogate pairs.
    if(start>0&&/[\udc00-\udfff]/u.test(request.source.text[start])&&/[\ud800-\udbff]/u.test(request.source.text[start-1]))start++;
    if(end<request.source.text.length&&/[\udc00-\udfff]/u.test(request.source.text[end])&&/[\ud800-\udbff]/u.test(request.source.text[end-1]))end--;
    const contextText=parsed.masked.slice(start,match.start)+' '.repeat(match.end-match.start)+parsed.masked.slice(match.end,end);
    const blocked=instructionLike(contextText)||!anchor||parsed.counts.get(anchor)!==1;
    const options=[...new Map(match.options.map((v:Data)=>[v.id,v])).values()].map((object:any)=>{
      const rule=rules.get(object.id),matchedAny=(rule?.['require-any']??[]).filter((p:string)=>phrasePresent(contextText,p)),matchedAll=(rule?.['require-all']??[]).filter((p:string)=>phrasePresent(contextText,p)),excluded=(rule?.exclude??[]).filter((p:string)=>phrasePresent(contextText,p));
      const allowedScope=!request.policy.defaults.scopes.length||request.policy.defaults.scopes.includes(object.scope),allowedType=!request.policy.defaults.types.length||request.policy.defaults.types.includes(object.type);
      const positive=rule&&((rule['require-any'].length&&matchedAny.length)||rule['require-all'].length)&&(!rule['require-any'].length||matchedAny.length)&&matchedAll.length===rule['require-all'].length;
      const status=!allowedScope?'outside-default-scope':!allowedType?'outside-default-type':excluded.length?'excluded-by-context':positive?'supported':'missing-positive-context';
      return {id:object.id,type:object.type,scope:object.scope,status,matchedAny,matchedAll,excluded};
    }).sort((a:any,b:any)=>a.id<b.id?-1:1);
    const supported=options.filter((v:any)=>v.status==='supported'),suggestedId=!blocked&&supported.length===1?supported[0].id:null;
    const mention={evidence:{start:match.start,end:match.end,text:request.source.text.slice(match.start,match.end)},context:{start,end,text:request.source.text.slice(start,end)},
      source:anchor?{path:request.source.path,anchor}:null,options,suggestedId,status:blocked?'blocked':supported.length>1?'ambiguous':suggestedId?'proposed':'unresolved',
      reason:blocked?(instructionLike(contextText)?'instruction-like-context':'requires-one-explicit-authored-section-anchor'):suggestedId?'unique-positive-context':supported.length>1?'competing-positive-contexts':'insufficient-positive-context'};
    mentions.push({...mention,mentionId:await sha256(canonical(mention)),review:'unreviewed'});
  }
  return {version:1,operation:'contextual-disambiguation',requestId,request,mentions,status:'unreviewed',links:[],
    provenance:{method:'deterministic-context-rules',algorithmVersion:1,algorithmHash:request.algorithmHash,model:null,prompt:null,promptHash:null,
      sourceHash:request.source.hash,declarationsHash:request.declarationsHash,catalogueDigest:await sha256(canonical(request.objects)),schemaDigest:await sha256(canonical(request.schema)),policyDigest:await sha256(canonical(request.policy)),sourcePrecision:'utf16-exact-source-slice; reviewed occurrence remains anchor precision'}};
}
export async function validateContextualSuggestions(sidecar:Data):Promise<void>{
  const regenerated=await contextualSuggestions(sidecar.request);
  if(canonical(sidecar)!==canonical(regenerated))fail('private suggestions differ from their exact source, policy or derived candidates');
}
/** An author can explicitly resolve an ambiguous eligible option or decline it.
 * Blocked/excluded senses, changed inputs and invented IDs cannot be accepted. */
export async function reviewContextualSuggestions(sidecar:Data,input:Data):Promise<Data>{
  await validateContextualSuggestions(sidecar);
  if(input.reviewed!==true)fail('review requires explicit --reviewed human confirmation');
  const reviewer=text(input.reviewer,'reviewer');
  if(input.currentSource?.hash!==sidecar.request.source.hash||input.currentSource?.text!==sidecar.request.source.text||input.currentSource?.path!==sidecar.request.source.path)fail('source changed; request fresh suggestions');
  if(input.currentDeclarationsHash!==sidecar.request.declarationsHash)fail('declarations changed; request fresh suggestions');
  if(input.algorithmHash!==sidecar.request.algorithmHash)fail('contextual algorithm changed; request fresh suggestions');
  if(canonical(input.schema)!==canonical(sidecar.request.schema))fail('schema changed; request fresh suggestions');
  const currentObjects=definitions(input.objects,input.schema);
  if(canonical(currentObjects)!==canonical(sidecar.request.objects))fail('catalogue changed; request fresh suggestions');
  const current=policyValue(input.policy,currentObjects,input.schema,sidecar.request.namespaces);
  if(canonical(current)!==canonical(sidecar.request.policy))fail('context policy changed; request fresh suggestions');
  if(sidecar.request.policyFile&&input.policyFileHash!==sidecar.request.policyFile.hash)fail('context policy file changed; request fresh suggestions');
  if(!Array.isArray(input.choices)||!input.choices.length||input.choices.length>CONTEXTUAL_LIMITS.mentions)fail('review requires a bounded explicit choices sequence');
  const seen=new Set<string>(),occurrences=new Set<string>(),additions=[],decisions=[];
  for(const raw of input.choices){
    const choice=map(raw,'choice');fields(choice,['mentionId','id','public'],'choice');if(!Object.hasOwn(choice,'id'))fail('choice must explicitly name an identity or null');
    const mention=sidecar.mentions.find((v:Data)=>v.mentionId===choice.mentionId);if(!mention||seen.has(mention.mentionId))fail('choose distinct existing mention identities');seen.add(mention.mentionId);
    if(choice.id===null){if(choice.public!==undefined&&choice.public!==false)fail('declined mentions cannot authorize publication');decisions.push({mentionId:mention.mentionId,id:null,decision:'leave-unlinked'});continue;}
    const id=identifier(choice.id,sidecar.request.namespaces),option=mention.options.find((v:Data)=>v.id===id);
    if(mention.status==='blocked'||!option||['outside-default-scope','outside-default-type','excluded-by-context'].includes(option.status))fail('selected sense is unavailable or excluded by the reviewed context');
    if(choice.public!==true)fail('an occurrence of a public canonical object requires explicit public: true');
    const object=sidecar.request.objects.find((v:Data)=>v.id===id),key=id+'\n'+canonical(mention.source);
    if(!occurrences.has(key)&&!object.occurrences.some((v:Data)=>canonical(v)===canonical(mention.source)))additions.push({target:id,source:mention.source,public:true});occurrences.add(key);
    decisions.push({mentionId:mention.mentionId,id,decision:'author-declared',public:true,evidence:mention.evidence,context:mention.context,source:mention.source,suggestedId:mention.suggestedId});
  }
  return {patch:{version:0,objects:[],relations:[],occurrenceAdditions:additions},review:{version:1,operation:'contextual-disambiguation',requestId:sidecar.requestId,reviewer,
    decision:'author-declared',decisions,provenance:sidecar.provenance,publication:'explicit occurrence decisions only; canonical eligibility and records are unchanged'}};
}
