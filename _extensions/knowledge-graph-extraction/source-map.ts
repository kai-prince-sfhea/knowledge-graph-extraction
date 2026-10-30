/** Conservative original-source provenance for observed native explicit IDs.
 * Callers own project confinement, include ancestry and native observation.
 * This module reads no files and never maps generated/implicit HTML anchors.
 * Coordinates are zero-based UTF-16, end exclusive, for the literal #ID token.
 * An optional hash-bound span describes original lexical block structure,
 * never expanded include content, a proof's validity or semantic equivalence.
 * Only block-boundary headings and fenced Div IDs are supported. Inline IDs
 * and conditional Div content remain unavailable; this is not a general
 * Markdown, HTML or TeX parser. Native anchor admission remains mandatory. */
type File = {path:string;text:string;sha256:string};
export type SourceSpan = {kind:'heading-section'|'fenced-div';start:number;end:number;hash:string;precision:'source-structure'};
export type SourceOrigin = {path:string;anchor:string;hash:string;start:number;end:number;precision:'anchor-token';span?:SourceSpan};
export type SourceOriginResult = {status:'available';origin:SourceOrigin}|{status:'unavailable';reason:'invalid-input'|'source-integrity'|'missing'|'ambiguous'|'limit'};
export const SOURCE_MAP_LIMITS = Object.freeze({files:512,fileBytes:2*1024*1024,totalBytes:16*1024*1024,anchorCharacters:512,structuralBlocks:16384});
const unavailable = (reason:Exclude<SourceOriginResult,{status:'available'}>['reason']):SourceOriginResult => ({status:'unavailable',reason});
const mapping=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const path=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=4096&&/\.(?:qmd|md)$/i.test(value)&&!value.startsWith('/')&&!/[:\\\u0000-\u001f\u007f?#]/.test(value)&&!value.split('/').some(part=>!part||part==='.'||part==='..'||['.git','.quarto','_extensions'].includes(part.toLowerCase()));
const anchor=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=SOURCE_MAP_LIMITS.anchorCharacters&&!/[\s{}"'`<>#\\]/u.test(value);
const digest=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
const escaped=(text:string,index:number)=>{let count=0;for(let i=index-1;i>=0&&text[i]==='\\';i--)count++;return count%2===1;};
function quotePrefix(line:string):number {const match=line.match(/^(?: {0,3}>[ \t]?){1,32}/);return match?.[0].length??0;}
function htmlEnd(value:string):number {
  let quote:string|null=null;
  for(let i=1;i<value.length;i++){const ch=value[i];if(quote){if(ch===quote)quote=null;}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='>')return i;}
  return -1;
}
type Structure = {kind:'heading-section'|'fenced-div';start:number;end:number|null;parent:number|null;safe:boolean;level?:number;fence?:number;closeStart?:number};
type Token = {start:number;end:number;structure?:number};
function tokens(text:string,wanted:string):{matches:Token[];uncertain:boolean;structures:Structure[];structureComplete:boolean} {
  const lines=[...text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(match=>match[0].length).map(match=>({start:match.index!,end:match.index!+match[0].length,body:match[0].replace(/(?:\r\n|\n|\r)$/,'')}));
  const matches:Token[]=[],structures:Structure[]=[],structureDivs:number[]=[],conditionalStarts:number[]=[],setextUnderlines=new Set<number>();let uncertain=false,structureComplete=true;
  let yaml=false,fence:{character:string;count:number}|null=null,inlineCode=0,math:string|null=null,comment=false,pendingTag='',html:string[]=[],tex:string[]=[],divs:boolean[]=[];
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const rawTags=new Set(['script','style','pre','code','textarea','title']);
  const rawTex=new Set(['verbatim','Verbatim','lstlisting','minted']);
  function texLine(value:string){for(const token of value.matchAll(/\\(begin|end)\{([A-Za-z][A-Za-z0-9*_-]{0,63})\}/g)){
    if(tex.length&&rawTex.has(tex.at(-1)!)){if(token[1]==='end'&&token[2]===tex.at(-1))tex.pop();}
    else if(token[1]==='begin')tex.push(token[2]);else if(token[2]===tex.at(-1))tex.pop();
  }}
  function tag(value:string){
    const parsed=value.match(/^<(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)([\s\S]*)>$/);
    if(!parsed||parsed[3]&&parsed[3]!=='/'&&!/^\s/.test(parsed[3]))return;
    const name=parsed[2].toLowerCase();
    if(parsed[1]){const at=html.lastIndexOf(name);if(at>=0)html.length=at;}
    else if(!voidTags.has(name))html.push(name);
  }
  for(let lineIndex=0;lineIndex<lines.length;lineIndex++) {
    const line=lines[lineIndex],prefix=quotePrefix(line.body),body=line.body.slice(prefix),logical=lineIndex===0?body.replace(/^\uFEFF/,''):body;
    if(!body.trim()){inlineCode=0;math=null;}
    if(tex.length){texLine(body);continue;}
    if(!html.length&&!comment&&!pendingTag&&!inlineCode&&!math){
      if(yaml){if(/^\s*(?:---|\.\.\.)\s*$/.test(logical))yaml=false;continue;}
      // A later metadata block may begin with comments or multiline values.
      // Treat a standalone delimiter conservatively as metadata rather than
      // guessing from its next line (a horizontal rule may therefore withhold
      // optional provenance until a closing delimiter).
      if(/^ {0,3}---\s*$/.test(logical)&&!setextUnderlines.has(lineIndex)){yaml=true;continue;}
      if(fence){if(new RegExp('^ {0,3}'+(fence.character==='`'?'`':'~')+'{'+fence.count+',}\\s*$').test(body))fence=null;continue;}
      const opening=body.match(/^ {0,3}(`{3,}|~{3,})/);if(opening){fence={character:opening[1][0],count:opening[1].length};continue;}
      if(/^(?: {4}|\t)/.test(body))continue;
      if(/^ {0,3}\\begin\{[A-Za-z][A-Za-z0-9*_-]{0,63}\}/.test(body)){texLine(body);continue;}
    }else if(fence){continue;}
    const visible=Array(line.body.length).fill(' ');
    for(let i=0;i<line.body.length;){
      if(pendingTag){const previous=pendingTag+'\n',combined=previous+line.body.slice(i),close=htmlEnd(combined);if(close<0){pendingTag=combined;break;}tag(combined.slice(0,close+1));pendingTag='';i+=close+1-previous.length;continue;}
      if(comment){const close=line.body.indexOf('-->',i);if(close<0)break;comment=false;i=close+3;continue;}
      const raw=html.at(-1);
      if(raw&&rawTags.has(raw)){const close=line.body.slice(i).match(new RegExp('^</'+raw+'\\s*>','i'));if(close){html.pop();i+=close[0].length;}else i++;continue;}
      if(!inlineCode&&!math&&line.body.startsWith('<!--',i)){comment=true;i+=4;continue;}
      if(!inlineCode&&!math&&line.body[i]==='<'&&/^<(?:\/?[A-Za-z]|!|\?)/.test(line.body.slice(i))){const value=line.body.slice(i),close=htmlEnd(value);if(/^<[!?]/.test(value))structureComplete=false;if(close<0){pendingTag=value;break;}tag(value.slice(0,close+1));i+=close+1;continue;}
      if(html.length){i++;continue;}
      if(line.body[i]==='`'&&!escaped(line.body,i)&&!math){let end=i;while(line.body[end]==='`')end++;const count=end-i;if(!inlineCode)inlineCode=count;else if(inlineCode===count)inlineCode=0;i=end;continue;}
      if(inlineCode){i++;continue;}
      if(!escaped(line.body,i)){
        const marker=line.body.startsWith('$$',i)?'$$':line.body[i]==='$'?'$':line.body.startsWith('\\(',i)?'\\(':line.body.startsWith('\\[',i)?'\\[':null;
        if(math){const closing=math==='\\('? '\\)':math==='\\['?'\\]':math;if(line.body.startsWith(closing,i)){i+=closing.length;math=null;}else i++;continue;}
        if(marker){math=marker;i+=marker.length;continue;}
      }
      if(math){i++;continue;}
      visible[i]=lineIndex===0&&i===0&&line.body[i]==='\uFEFF'?' ':line.body[i];i++;
    }
    const content=visible.join(''),effective=content.slice(prefix),structuralEffective=lineIndex===0&&line.body.startsWith('\uFEFF')?effective.slice(1):effective;
    const divFence=effective.match(/^ {0,3}:{3,}(.*)$/);
    let currentStructure:number|undefined;
    if(divFence){
      const count=effective.match(/^ {0,3}(:{3,})/)![1].length;
      if(!divFence[1].trim()){
        divs.pop();const closing=structureDivs.pop();
        if(closing===undefined)structureComplete=false;
        else if(closing===-1){/* Structural budget exhausted; retain tokens only. */}
        else {const block=structures[closing];block.end=line.end;block.closeStart=line.start;if(prefix||!/^:{3,}\s*$/.test(structuralEffective)||block.fence!==count){block.safe=false;structureComplete=false;}}
        continue;
      }
      // Native format/profile/metadata conditions can suppress an explicit ID
      // even when another implicit observed anchor has the same spelling.
      // Without the renderer's condition evaluation no token in such a
      // container, including its own opening ID, can establish ownership.
      const conditional=/(?:^|[\s{.])content-(?:hidden|visible)(?=[\s}]|$)|(?:^|[\s{])(?:when|unless)-[A-Za-z-]+\s*=/.test(divFence[1]);
      divs.push(divs.includes(true)||conditional);
      if(structures.length>=SOURCE_MAP_LIMITS.structuralBlocks){structureComplete=false;structureDivs.push(-1);}
      else {
        currentStructure=structures.length;
        const safe=prefix===0&&/^:{3,}(?:\s+\{[^{}]*\}|\s+[A-Za-z][A-Za-z0-9_-]*)\s*$/.test(structuralEffective)&&!divs.includes(true);
        structures.push({kind:'fenced-div',start:line.start,end:null,parent:structureDivs.at(-1)??null,safe,fence:count});
        structureDivs.push(currentStructure);
        if(!safe&&!divs.includes(true))structureComplete=false;
      }
      if(divs.includes(true))conditionalStarts.push(line.start);
    }
    if(divs.includes(true))continue;
    const previous=lines[lineIndex-1]?.body??'',previousContent=previous.slice(quotePrefix(previous));
    const boundary=lineIndex===0||!previousContent.trim()||/^ {0,3}(?:---|\.\.\.|`{3,}|~{3,})\s*$/.test(previousContent);
    const heading=/^ {0,3}#{1,6}(?:\s|$)/.test(effective),div=/^ {0,3}:{3,}\s*/.test(effective);
    const nextBody=lines[lineIndex+1]?.body??'';
    const setext=effective.trim().length>0&&!comment&&!pendingTag&&!html.length&&!inlineCode&&!math&&quotePrefix(nextBody)===prefix&&
      /^ {0,3}(?:=+|-+)\s*$/.test(nextBody.slice(prefix));
    if((heading||setext)&&!divFence&&!setextUnderlines.has(lineIndex)){
      const level=heading?effective.match(/^ {0,3}(#{1,6})/)![1].length:/=/.test(lines[lineIndex+1].body)?1:2;
      if(structures.length>=SOURCE_MAP_LIMITS.structuralBlocks)structureComplete=false;
      else {
        currentStructure=structures.length;
        structures.push({kind:'heading-section',start:line.start,end:null,parent:structureDivs.at(-1)??null,level,
          safe:prefix===0&&boundary&&!/^ /.test(structuralEffective)});
      }
      if(setext&&!heading)setextUnderlines.add(lineIndex+1);
    }
    for(let open=content.indexOf('{');open>=0;open=content.indexOf('{',open+1)){
      if(escaped(line.body,open))continue;
      let quote:string|null=null,close=-1,nested=false;
      for(let i=open+1;i<content.length;i++){
        const ch=content[i];if(escaped(content,i))continue;
        if(quote){if(ch===quote)quote=null;continue;}
        if(ch==='"'||ch==="'"){quote=ch;continue;}
        if(ch==='{'){nested=true;break;}if(ch==='}'){close=i;break;}
      }
      if(close<0||nested)continue;
      const preceding=content.slice(prefix,open),tail=content.slice(close+1);
      const nativeBlock=(heading||setext)&&/^\s*(?:#+\s*)?$/.test(tail)||div&&/^ {0,3}:{3,}\s*$/.test(preceding)&&/^\s*$/.test(tail);
      quote=null;
      for(let i=open+1;i<close;i++){
        const ch=content[i];if(escaped(content,i))continue;
        if(quote){if(ch===quote)quote=null;continue;}
        if(ch==='"'||ch==="'"){quote=ch;continue;}
        if(ch!=='#'||i>open+1&&!/\s/.test(content[i-1]))continue;
        let end=i+1;while(end<close&&!/[\s{}"'`<>#\\]/u.test(content[end]))end++;
        if(content.slice(i+1,end)===wanted){
          if(nativeBlock&&boundary)matches.push({start:line.start+i,end:line.start+end,...currentStructure===undefined?{}:{structure:currentStructure}});
          // Unsupported visible syntax cannot substantiate an origin, but it
          // may be another native explicit ID. Never turn that uncertainty
          // into a false unique match elsewhere in the include closure.
          else uncertain=true;
        }
        i=end-1;
      }
      open=close;
    }
  }
  if(yaml||fence||inlineCode||math||comment||pendingTag||html.length||tex.length||structureDivs.length)structureComplete=false;
  // Bounds refer only to lexical content in this original file. A heading's
  // section never absorbs an enclosing Div's closing fence or a sibling
  // same/higher heading. Child Div headings have their own structural scope.
  const nextHeadings=new Map<number|null,(number|undefined)[]>();
  for(let index=structures.length-1;index>=0;index--){
    const block=structures[index];
    if(block.kind==='heading-section'){
      const parent=block.parent===null?null:structures[block.parent];
      block.end=parent?.end===null?null:parent?parent.closeStart??null:text.length;
      const next=nextHeadings.get(block.parent)??[];let ending:Structure|null=null;
      for(let level=1;level<=block.level!;level++){
        const candidate=next[level]===undefined?null:structures[next[level]!];
        if(candidate&&(!ending||candidate.start<ending.start))ending=candidate;
      }
      if(ending){block.end=ending.start;if(!ending.safe)block.safe=false;}
      next[block.level!]=index;nextHeadings.set(block.parent,next);
    }
    if(block.end===null||block.end<=block.start)block.safe=false;
  }
  // Work remains linear in source lines/blocks (heading levels are bounded at
  // six). Binary-search conditional starts rather than rescanning every region
  // for every heading in a large document.
  for(const block of structures){
    if(block.parent!==null&&!structures[block.parent]?.safe)block.safe=false;
    let low=0,high=conditionalStarts.length;
    while(low<high){const middle=(low+high)>>>1;if(conditionalStarts[middle]<block.start)low=middle+1;else high=middle;}
    if(low<conditionalStarts.length&&conditionalStarts[low]<(block.end??text.length))block.safe=false;
  }
  return {matches,uncertain,structures,structureComplete};
}
/** Files must be the containing document's already inventoried include closure,
 * never an unrestricted project scan. Verify all bytes before resolving, so a
 * corrupt or missing contributor cannot make an ambiguous token look unique. */
export async function resolveSourceOrigin(files:unknown,observation:unknown):Promise<SourceOriginResult>{
  if(!Array.isArray(files)||!mapping(observation)||Object.keys(observation).some(key=>key!=='anchor')||!anchor(observation.anchor))return unavailable('invalid-input');
  if(files.length>SOURCE_MAP_LIMITS.files)return unavailable('limit');
  const accepted:File[]=[],seen=new Set<string>();let total=0;
  for(const value of files){
    if(!mapping(value)||Object.keys(value).some(key=>!['path','text','sha256'].includes(key))||!path(value.path)||seen.has(value.path)||typeof value.text!=='string'||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))return unavailable('invalid-input');
    if(value.text.length>SOURCE_MAP_LIMITS.fileBytes)return unavailable('limit');
    const bytes=new TextEncoder().encode(value.text);total+=bytes.byteLength;if(bytes.byteLength>SOURCE_MAP_LIMITS.fileBytes||total>SOURCE_MAP_LIMITS.totalBytes)return unavailable('limit');
    if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)!==value.text||await digest(bytes)!==value.sha256)return unavailable('source-integrity');
    seen.add(value.path);accepted.push(value as unknown as File);
  }
  let found:SourceOrigin|null=null,uncertain=false;
  for(const file of accepted){
    const scanned=tokens(file.text,observation.anchor as string);uncertain||=scanned.uncertain;
    for(const token of scanned.matches){
      if(found)return unavailable('ambiguous');
      const block=token.structure===undefined?null:scanned.structures[token.structure];
      let span:SourceSpan|undefined;
      if(scanned.structureComplete&&block?.safe&&block.end!==null&&block.start<=token.start&&block.end>=token.end)
        span={kind:block.kind,start:block.start,end:block.end,hash:await digest(new TextEncoder().encode(file.text.slice(block.start,block.end))),precision:'source-structure'};
      found={path:file.path,anchor:observation.anchor as string,hash:file.sha256,start:token.start,end:token.end,precision:'anchor-token',...span?{span}:{}};
    }
  }
  return found?uncertain?unavailable('ambiguous'):{status:'available',origin:found}:unavailable('missing');
}
/** Both the graph record and original source owner must explicitly permit this
 * provenance. These declarations do not authenticate consent or publish files. */
export function publicSourceOrigin(result:SourceOriginResult,decisions:{recordPublic:boolean;sourcePublic:boolean}):SourceOrigin|null {
  if(!mapping(decisions)||Object.keys(decisions).some(key=>!['recordPublic','sourcePublic'].includes(key))||decisions.recordPublic!==true||decisions.sourcePublic!==true||!mapping(result)||result.status!=='available')return null;
  const value=result.origin;
  if(!mapping(value)||Object.keys(value).some(key=>!['path','anchor','hash','start','end','precision','span'].includes(key))||!path(value.path)||!anchor(value.anchor)||!/^[a-f0-9]{64}$/.test(value.hash)||value.precision!=='anchor-token'||!Number.isInteger(value.start)||!Number.isInteger(value.end)||value.start<0||value.end!==value.start+value.anchor.length+1||value.end>SOURCE_MAP_LIMITS.fileBytes)return null;
  if(value.span!==undefined){const span=value.span;
    if(!mapping(span)||Object.keys(span).some(key=>!['kind','start','end','hash','precision'].includes(key))||!['heading-section','fenced-div'].includes(span.kind)||span.precision!=='source-structure'||!/^[a-f0-9]{64}$/.test(span.hash??'')||!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<0||span.start>value.start||span.end<value.end||span.end>SOURCE_MAP_LIMITS.fileBytes)return null;
  }
  return {...value,...value.span?{span:{...value.span}}:{}};
}
