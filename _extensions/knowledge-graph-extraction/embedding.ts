import { AI_DEFAULTS } from "./ai-config.ts";
import { canonical, sha256 } from "./assistance.ts";
type Data=Record<string,any>;
function fail(message:string):never{throw new Error(`knowledge-graph-extraction: ${message}`);}
function map(value:unknown,name:string):Data{if(!value||typeof value!=="object"||Array.isArray(value))fail(`${name} must be a mapping`);return value as Data;}
function fields(value:Data,allowed:string[],name:string):void{const key=Object.keys(value).find(key=>!allowed.includes(key));if(key)fail(`${name} contains unsupported field '${key}'`);}
function text(value:unknown,name:string):string{if(typeof value!=="string"||!value.trim()||/[\u0000-\u001f]/.test(value))fail(`${name} must be nonempty text`);return value;}
function hash(value:unknown,name:string):string{if(typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value))fail(`${name} must be a lowercase SHA-256 digest`);return value;}
function pinned(value:unknown,name:string):Data{const item=map(value,name);fields(item,["version","sha256","licence"],name);return {version:text(item.version,`${name}.version`),sha256:hash(item.sha256,`${name}.sha256`),licence:text(item.licence,`${name}.licence`)};}
export function parseEmbeddingManifest(value:unknown):Data{
  const input=map(value,"embedding manifest");fields(input,["version","runtime","embedding"],"embedding manifest");if(input.version!==0)fail("only embedding manifest version 0 is supported");
  const runtime=map(input.runtime,"embedding runtime"),python=map(runtime.python,"embedding runtime.python");
  fields(runtime,["python","distribution","version","sha256","licence","dependencies"],"embedding runtime");fields(python,["path","sha256"],"embedding Python");
  if(runtime.distribution!=="sentence-transformers")fail("embedding runtime.distribution must be sentence-transformers");
  const dependencies=map(runtime.dependencies,"embedding runtime.dependencies"),names=["torch","transformers","tokenizers","safetensors","numpy"];
  fields(dependencies,names,"embedding runtime.dependencies");for(const name of names)if(!Object.hasOwn(dependencies,name))fail(`embedding runtime requires pinned dependency '${name}'`);
  const embedding=map(input.embedding,"embedding policy");fields(embedding,["model","directory","files","revision","licence","dimensions","timeout-seconds"],"embedding policy");
  const files=map(embedding.files,"embedding.files");if(!Object.keys(files).length||Object.keys(files).length>1000)fail("embedding.files needs 1 to 1000 pinned local files");
  for(const [path,digest] of Object.entries(files)){if(path.includes(":")||path.includes("\\")||path.split("/").some(part=>!part||part==="."||part===".."))fail("embedding artifact names must be relative paths without traversal");hash(digest,"embedding artifact digest");}
  const dimensions=embedding.dimensions??AI_DEFAULTS.embedding.dimensions;if(![128,256,512,768].includes(dimensions))fail("embedding dimensions must be 128, 256, 512 or 768");
  const timeout=embedding["timeout-seconds"]??120;if(typeof timeout!=="number"||!Number.isInteger(timeout)||timeout<1||timeout>300)fail("embedding timeout-seconds must be 1 to 300");
  const revision=text(embedding.revision,"embedding revision");if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))fail("embedding revision must be an immutable 40-character commit or 64-character content digest");
  return {version:0,runtime:{python:{path:text(python.path,"embedding Python path"),sha256:hash(python.sha256,"embedding Python digest")},distribution:"sentence-transformers",
    ...pinned({version:runtime.version,sha256:runtime.sha256,licence:runtime.licence},"embedding runtime"),dependencies:Object.fromEntries(names.map(name=>[name,pinned(dependencies[name],`dependency '${name}'`)]))},
    embedding:{model:text(embedding.model??AI_DEFAULTS.embedding.model,"embedding model"),directory:text(embedding.directory,"embedding directory"),files:{...files},revision,
      licence:text(embedding.licence,"embedding licence"),dimensions,timeoutSeconds:timeout}};
}
/** UTF-16 windows preserve complete surrogate pairs and the original text. */
export async function embeddingWindows(source:{path:string;hash:string;text:string},window=1000,overlap=100):Promise<Data[]>{
  if(!Number.isInteger(window)||window<1||window>12000||!Number.isInteger(overlap)||overlap<0||overlap>=window)fail("invalid embedding window/overlap");
  const result:Data[]=[];let start=0;
  while(start<source.text.length){let end=Math.min(source.text.length,start+window);
    if(end<source.text.length&&source.text.charCodeAt(end)>=0xdc00&&source.text.charCodeAt(end)<=0xdfff)end++;
    const text=source.text.slice(start,end);
    result.push({id:`sha256:${await sha256(`${source.path}\n${source.hash}\n${start}\n${end}`)}`,path:source.path,sourceHash:source.hash,start,end,text});
    if(end===source.text.length)break;
    let next=end-overlap;if(next<source.text.length&&source.text.charCodeAt(next)>=0xdc00&&source.text.charCodeAt(next)<=0xdfff)next--;
    if(next<=start){next=start+1;if(next<source.text.length&&source.text.charCodeAt(next)>=0xdc00&&source.text.charCodeAt(next)<=0xdfff)next++;}
    start=next;
    if(result.length>10000)fail("embedding source produces more than 10000 windows; select smaller context sources");
  }
  return result;
}
export async function makeEmbeddingRequest(manifest:Data,query:Data,items:Data[],adapterHash:string):Promise<Data>{
  hash(query.sourceHash,"embedding query sourceHash");hash(adapterHash,"embedding adapterHash");
  if(typeof query.text!=="string"||!query.text.length||query.text.length>12000)fail("embedding query must contain 1 to 12000 characters");
  if(!items.length||items.length>10000)fail("embedding context needs 1 to 10000 windows");
  const body={version:0,manifest,query,items,adapterHash};return {...body,requestId:await sha256(canonical(body))};
}
