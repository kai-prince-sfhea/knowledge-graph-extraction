// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Source-derived prompt scaffolding, never an identity/coreference decision.
type Data=Record<string,any>;
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const has=(value:string,phrase:string)=>new RegExp('(?:^|[^\\p{L}\\p{N}\\p{M}_])'+escape(phrase)+'(?=$|[^\\p{L}\\p{N}\\p{M}_])','iu').test(value);
const word=(value:string)=>/[\p{L}\p{N}\p{M}_]/u.test(value);

/** Suggest exact source spans to inspect. Labels discover surfaces; author
 * rules only remove forbidden alternatives. Neither operation proves meaning.
 * All positions refer to the already masked source, including CRLF/UTF-16. */
export function semanticGuidance(request:Data,masked:string):Data{
 const context=request.context,language=context.policy.defaults.language,eligible=context.objects.filter((object:Data)=>request.catalogueIds.includes(object.id));
 const inside=(start:number,end:number)=>context.slices.some((slice:Data)=>start>=slice.start&&end<=slice.end);
 const spans=new Map<string,Data>();
 for(const object of eligible){
  const selected=Object.hasOwn(object.labels,language)?language:language.split('-')[0];
  for(const term of [object.labels[selected],...(object.aliases[selected]??[])].filter(Boolean)){
   const expression=new RegExp(escape(term.trim()).replace(/ +/gu,'[ \\t]+'),'giu');let match;
   while((match=expression.exec(masked))!==null){
    const start=match.index,end=start+match[0].length;
    if(!inside(start,end)||word([...masked.slice(Math.max(0,start-2),start)].at(-1)??'')||word([...masked.slice(end,end+2)][0]??''))continue;
    const key=start+':'+end,span=spans.get(key)??{start,end,text:match[0],kind:'catalogue-wording',ids:[]};
    if(!span.ids.includes(object.id))span.ids.push(object.id);spans.set(key,span);
    if(spans.size>400)return {status:'omitted-budget',qualification:'No guidance changes the accepted identities or source constraints.',mentions:[]};
   }
  }
 }
 // A demonstrative adjoining an existing catalogue wording belongs to the
 // same exact-source noun phrase. Never split "this field" into a bare
 // determiner and "field", and never bridge masked/private/code contents.
 if(language.split('-')[0].toLowerCase()==='en'){
  const expanded=new Map<string,Data>();
  for(const original of spans.values()){
   const prefix=masked.slice(Math.max(0,original.start-128),original.start),match=prefix.match(/(?:^|[^\p{L}\p{N}\p{M}_])((?:this|that|these|those)[ \t]+)$/iu);
   let span=original;
   if(match){const start=original.start-match[1].length,end=original.end;if(inside(start,end)&&context.source.text.slice(start,end)===masked.slice(start,end))span={...original,start,text:masked.slice(start,end),referringExpression:true};}
   const key=span.start+':'+span.end,existing=expanded.get(key);if(existing){for(const id of span.ids)if(!existing.ids.includes(id))existing.ids.push(id);if(span.referringExpression)existing.referringExpression=true;}else expanded.set(key,span);
  }
  spans.clear();for(const[key,span]of expanded)spans.set(key,span);
 }
 // Inspect English referring expressions explicitly, rather than silently
 // treating a nearest noun or a shared label as a coreference resolution.
 if(language.split('-')[0].toLowerCase()==='en'){
  const expression=/\b(?:it|its|they|them|their|(?:this|that|these|those)(?:\s+(?:action|approach|concept|process|method|structure|operation))?)\b/giu;
  for(const match of masked.matchAll(expression)){
   const start=match.index!,end=start+match[0].length;if(!inside(start,end))continue;
   if(![...spans.values()].some(span=>start<span.end&&end>span.start))spans.set(start+':'+end,{start,end,text:match[0],kind:'possible-referring-expression',ids:eligible.map((object:Data)=>object.id)});
   if(spans.size>400)return {status:'omitted-budget',qualification:'No guidance changes the accepted identities or source constraints.',mentions:[]};
  }
 }
 const longest=[...spans.values()].sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start),selected:Data[]=[];
 for(const span of longest)if(!selected.some(other=>span.start<other.end&&span.end>other.start))selected.push(span);
 selected.sort((a,b)=>a.start-b.start);
 if(selected.length>100)return {status:'omitted-budget',qualification:'No guidance changes the accepted identities or source constraints.',mentions:[]};
 const mentions=selected.map(span=>{
  const slice=context.slices.find((part:Data)=>span.start>=part.start&&span.end<=part.end),start=Math.max(slice.start,span.start-256),end=Math.min(slice.end,span.end+256);
  const surrounding=masked.slice(start,span.start)+' '.repeat(span.end-span.start)+masked.slice(span.end,end);
  const alternatives=span.ids.map((id:string)=>{
   const rule=context.policy.senses.find((item:Data)=>item.id===id);
   const excluded=rule?.exclude.filter((cue:string)=>has(surrounding,cue))??[];
   const missingAll=rule?.['require-all'].filter((cue:string)=>!has(surrounding,cue))??[];
   const matchingAny=rule?.['require-any'].filter((cue:string)=>has(surrounding,cue))??[];
   const allowed=!excluded.length&&!missingAll.length&&(!rule?.['require-any'].length||matchingAny.length>0);
   return {id,allowedByAuthorPolicy:allowed,matchingAny,missingAll,excluded};
  });
  // Count identical, case-sensitive surfaces across the selected source union.
  // Repeated/overlapping slices never duplicate an occurrence.
  const occurrences=new Set<number>();for(const part of context.slices){let at=part.start;while(at<part.end){const found=masked.indexOf(span.text,at);if(found<0||found+span.text.length>part.end)break;const finish=found+span.text.length;
   if(!word([...masked.slice(Math.max(0,found-2),found)].at(-1)??'')&&!word([...masked.slice(finish,finish+2)][0]??''))occurrences.add(found);at=finish;
  }}
  return {text:span.text,occurrence:[...occurrences].sort((a,b)=>a-b).indexOf(span.start),kind:span.kind,...(span.referringExpression?{referringExpression:true}:{}),alternatives};
 });
 return {status:'available',qualification:'Inspection hints only. Matching words and policy permission do not prove identity. Referring expressions may refer to a person, event, or another concept; return null when unsupported. Do not label surrounding context cues as the concept itself.',mentions};
}
