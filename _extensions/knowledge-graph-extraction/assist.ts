// Explicit authoring CLI, never imported by prepare/finalize or render filters.
import { parse, stringify } from "stdlib/yaml";
import { dirname, fromFileUrl, isAbsolute, join, resolve, relative } from "stdlib/path";
import { atomicJson, confined, fail, loadProject, projectPath, readJson, STATE } from "./core.ts";
import { acceptSuggestions, canonical, makeRequest, parseAssistanceManifest, retrieveContext, sha256, sliceBounds, suggest } from "./assistance.ts";
import { embeddingWindows, makeEmbeddingRequest, parseEmbeddingManifest } from "./embedding.ts";
import { contextualSuggestions, reviewContextualSuggestions } from './contextual.ts';
import { relationSuggestions, reviewRelationSuggestions } from './relation-proposals.ts';
import { buildRelationBatch } from './relation-batch.ts';
import { privatePath as managedPrivatePath } from './private-path.ts';
import {makeSemanticContextRequest,semanticContextSuggestions,validateSemanticContextSuggestions,reviewSemanticContextSuggestions} from './semantic-context.ts';
type Data=Record<string,any>;
const help=`Knowledge Graph Extraction: explicit local authoring assistance
  quarto run _extensions/knowledge-graph-extraction/assist.ts probe --python PATH [--runtime embedding]
  quarto run _extensions/knowledge-graph-extraction/assist.ts embed --manifest local-embedding.yml --source QUERY_PAGE --context PAGE,PAGE [--start 0 --end 1000] [--output ${STATE}/embeddings/context]
  quarto run _extensions/knowledge-graph-extraction/assist.ts suggest --manifest local-ai.yml --source page.qmd [--start 0 --end 1000] [--output ${STATE}/suggestions/review.json]
  quarto run _extensions/knowledge-graph-extraction/assist.ts accept --suggestions PRIVATE_JSON --ids URI,URI --reviewed --reviewer NAME [--public-ids URI] [--output ${STATE}/accepted/review.yml]
  quarto run _extensions/knowledge-graph-extraction/assist.ts disambiguate --source page.qmd --context context-policy.yml [--start 0 --end 12000] [--output PRIVATE_JSON]
  quarto run _extensions/knowledge-graph-extraction/assist.ts review-context --suggestions PRIVATE_JSON --choices choices.yml --reviewed --reviewer NAME [--output PRIVATE_YML]
  quarto run _extensions/knowledge-graph-extraction/assist.ts resolve --workspace ABSOLUTE_PRIVATE_DIRECTORY --source page.qmd --context context-policy.yml --server local-server.yml [--discovery indexed|open] [--start 0 --end 12000] [--output PRIVATE_RELATIVE_JSON]
  quarto run _extensions/knowledge-graph-extraction/assist.ts review-resolution --workspace SAME_PRIVATE_DIRECTORY --suggestions PRIVATE_RELATIVE_JSON --choices PRIVATE_RELATIVE_YML --server SAME_LOCAL_SERVER_YML --reviewed --reviewer NAME [--output PRIVATE_RELATIVE_YML]
  quarto run _extensions/knowledge-graph-extraction/assist.ts relate --source page.qmd --context relation-policy.yml [--manifest local-ai.yml] [--start 0 --end 12000] [--output PRIVATE_JSON]
  quarto run _extensions/knowledge-graph-extraction/assist.ts relate-project --context relation-policy.yml [--source page.qmd] [--output PRIVATE_NEW_DIRECTORY]
  quarto run _extensions/knowledge-graph-extraction/assist.ts review-relations --suggestions PRIVATE_JSON --ids URI,URI --reviewed --reviewer NAME [--manifest SAME_LOCAL_AI_YML] [--public-ids URI] [--output PRIVATE_YML]
Acceptance writes a separate declarations patch and review receipt. It never merges canonical declarations automatically.
Context policies use version: 1, defaults: {language: en, scopes: [your-scope], types: [concept]}, and senses: [{id: existing:id, require-any: [context phrase], exclude: [other phrase]}].
Context review uses version: 1 and choices: [{mentionId: SHA256, id: existing:id, public: true}] or id: null to leave a mention unlinked. These commands use no model and never link automatically.
resolve explicitly requests a localhost OpenAI-compatible server. It proposes existing identities and coreferences, including shared words, and preserves exact source evidence. It writes private suggestions and an initially non-public choices template. review-resolution rechecks source, catalogue, policy, server configuration and implementation; --reviewed plus public: true is required for each accepted identity. Reported model names are not weight attestation or semantic verification. No model is invoked during rendering.
resolve defaults to --discovery indexed: the model chooses glossary identities for catalogue wording and earlier source keys for references; the host inherits only the selected earlier proposed identity. For referring phrases outside that finite checklist, --discovery open uses the original source-bound surface protocol. Only indexed and open are accepted. Empty indexed selections stop before inference; narrow oversized selections or select eligible public prose. review-resolution derives discovery from its saved request; do not add --discovery there.
The semantic workspace must already exist outside the project and every Git repository. Paths for server configuration, suggestions, choices and reviewed outputs are relative to that workspace. Only already-public source belongs in QMD. Prompts, responses, credentials and review receipts must never be copied into QMD, public declarations or repository files.
Relation policy adds id-prefix: your-namespace:relation- and relations: [{type: requires, phrases: [requires], direction: forward}]. The finite cue profile supports English only. Both endpoint senses require their own positive context; negated, conditional and ambiguous clauses abstain. Without --manifest, relate uses no model. Review defaults to a private declared patch and never edits canonical declarations. Model review needs the same explicitly supplied manifest.
relate-project covers every selected scoped source with overlapping Unicode-safe windows, preserving original anchors/private ranges and whole clauses. It is model-free only: --manifest, --start and --end are refused. Each JSON sidecar uses review-relations unchanged. The private index.json is written last after freshness/budget checks; complete window coverage does not establish semantic completeness. Output must be a new directory under ${STATE}/; failed jobs may leave uncommitted private files but no current index.
No downloads, installation or model inference occur during Quarto rendering.`;
function argumentsFor(args:string[]):{command:string;values:Data}{
  const command=args[0]??"help",values:Data={};
  const allowed=command==="probe"?["python","runtime"]:command==="embed"?["manifest","source","context","start","end","output"]:command==="suggest"?["manifest","source","start","end","output"]:
    command==="accept"?["suggestions","ids","reviewed","reviewer","public-ids","output"]:
    command==='disambiguate'?['source','context','start','end','output']:
    command==='review-context'?['suggestions','choices','reviewed','reviewer','output']:
    command==='resolve'?['workspace','source','context','server','discovery','start','end','output']:
    command==='review-resolution'?['workspace','suggestions','choices','server','reviewed','reviewer','output']:
    command==='relate'?['source','context','manifest','start','end','output']:
    command==='relate-project'?['source','context','output']:
    command==='review-relations'?['suggestions','ids','reviewed','reviewer','manifest','public-ids','output']:[];
  for(let i=1;i<args.length;i++){
    const key=args[i].replace(/^--/,"");if(!args[i].startsWith("--")||!allowed.includes(key)||Object.hasOwn(values,key))fail("unknown or repeated assistance argument; use help");
    if(key==="reviewed"){values[key]=true;continue;}
    if(i+1>=args.length||args[i+1].startsWith("--"))fail(`--${key} needs a value`);values[key]=args[++i];
  }
  if(command==='resolve'&&values.discovery!==undefined&&!['indexed','open'].includes(values.discovery))fail('--discovery must be indexed or open');
  return {command,values};
}
function required(values:Data,key:string):string{if(typeof values[key]!=="string"||!values[key].trim())fail(`--${key} is required`);return values[key];}
function privatePath(value:string):string{
  const path=projectPath(value);if(!path.startsWith(`${STATE}/`))fail(`assistance output must stay under private ${STATE}/`);return path;
}
async function sourceAt(root:string,path:string):Promise<{path:string;hash:string;text:string}>{
  const bytes=await Deno.readFile(await confined(root,projectPath(path)));
  if(bytes.length>4_000_000)fail("authoring source exceeds the bounded four-megabyte byte limit");
  return {path,hash:await sha256(bytes),text:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes)};
}
/** New literal contextual inputs follow no links and never read installed/Git
 * payloads. Review sidecars/outputs use the managed private-state boundary. */
async function contextualFile(root:string,value:string,privateOnly=false):Promise<string>{
  const path=projectPath(value);
  if(privateOnly)return await managedPrivatePath(root,privatePath(path));
  if(path.split('/').some(part=>['_extensions','.git'].includes(part.toLowerCase())))fail('contextual author input is outside the supported source boundary');
  let current=root;
  for(const part of path.split('/')){current=join(current,part);if((await Deno.lstat(current)).isSymlink)fail('contextual author input must not contain symbolic links or junctions');}
  if(path.startsWith('.quarto/'))return await managedPrivatePath(root,path);
  return await confined(root,path);
}
async function contextualData(root:string,value:string,privateOnly=false):Promise<{value:Data;hash:string}>{
  if(!/\.(?:json|ya?ml)$/i.test(value))fail('contextual policy, choices and sidecars require literal YAML or JSON files');
  const path=await contextualFile(root,value,privateOnly);if((await Deno.stat(path)).size>8_000_000)fail('contextual author input exceeds eight megabytes');
  const bytes=await Deno.readFile(path);if(bytes.length>8_000_000)fail('contextual author input exceeds eight megabytes');
  let valueData;try{valueData=parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}catch{fail('contextual author input must be valid literal YAML or JSON');}
  if(!valueData||typeof valueData!=='object'||Array.isArray(valueData))fail('contextual author input must be a mapping');
  return {value:valueData as Data,hash:await sha256(bytes)};
}
/** Explicit external author workspace: no prompt/response file enters a project
 * or Git checkout. Existing legacy commands retain their documented contract. */
async function semanticWorkspace(root:string,path:string):Promise<string>{
  if(!isAbsolute(path))fail('semantic workspace requires an existing absolute directory outside the project and Git repositories');
  const absolute=resolve(path),inside=(parent:string,child:string)=>{const r=relative(parent,child);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..\\')&&!r.startsWith('../'));};
  if(inside(root,absolute)||inside(absolute,root))fail('semantic workspace must be separate from the publication project');
  let current=absolute;while(true){const stat=await Deno.lstat(current);if(stat.isSymlink||!stat.isDirectory)fail('semantic workspace ancestors must be ordinary directories');
    try{await Deno.lstat(join(current,'.git'));fail('semantic workspace must be outside every Git repository');}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
    const parent=dirname(current);if(parent===current)break;current=parent;
  }
  return absolute;
}
async function semanticFile(workspace:string,path:string,output=false):Promise<string>{
  const parts=projectPath(path).split('/');if(parts.some(p=>['_extensions','.git','.quarto'].includes(p.toLowerCase()))||!/\.(?:json|ya?ml)$/iu.test(path))fail('semantic private paths require YAML/JSON outside reserved directories');let current=workspace;
  for(let i=0;i<parts.length;i++){current=join(current,parts[i]);try{const stat=await Deno.lstat(current);if(stat.isSymlink||(i<parts.length-1?!stat.isDirectory:!stat.isFile))fail('semantic private path must contain ordinary directories and files only');}catch(error){if(!(error instanceof Deno.errors.NotFound)||!output)throw error;if(i<parts.length-1)await Deno.mkdir(current);}}
  return current;
}
async function semanticData(workspace:string,path:string):Promise<Data>{
  if(!/\.(?:json|ya?ml)$/iu.test(path))fail('semantic private data requires YAML or JSON');const absolute=await semanticFile(workspace,path),stat=await Deno.stat(absolute);if(stat.size>8_000_000)fail('semantic private input exceeds eight megabytes');
  const bytes=await Deno.readFile(absolute);if(bytes.length>8_000_000)fail('semantic private input exceeds eight megabytes');let value;try{value=parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('invalid semantic private data');}if(!value||typeof value!=='object'||Array.isArray(value))fail('semantic private data requires a mapping');return {value,hash:await sha256(bytes)};
}
/** Byte identities of actual authoring inputs; interpreted metadata fingerprints
 * remain separately captured in loadProject's dependencyDigest. */
async function relationBatchInputs(root:string,project:Data,sources:Data[],policyPath:string,policyHash:string):Promise<Data[]>{
  const values=new Map<string,Data>(sources.map(source=>[source.path,{path:source.path,hash:source.hash}]));
  values.set(policyPath,{path:policyPath,hash:policyHash});
  const literalFiles=new Set<string>(values.keys());let inputBytes=0;
  for(const path of literalFiles){const stat=await Deno.stat(await contextualFile(root,path));if(!stat.isFile||stat.size>4_000_000)fail('relation batch authoring input exceeds four million bytes');inputBytes+=stat.size;}
  const paths=new Set<string>(['_quarto.yml','_quarto.yaml']);
  for(const entry of project.dependencies)if(['source','include','metadata','ignored-metadata','missing-metadata','declarations','schema'].includes(entry.kind))paths.add(projectPath(entry.path));
  // Absence of a higher-priority directory metadata file is also an input.
  for(const source of project.sources){const parts=source.split('/');parts.pop();for(let count=0;count<=parts.length;count++){const prefix=parts.slice(0,count).join('/');for(const name of ['_metadata.yml','_metadata.yaml'])paths.add(prefix?prefix+'/'+name:name);}}
  if(paths.size>10000)fail('relation batch freshness inventory exceeds10000 inputs');
  for(const path of [...paths].sort()){
    if(values.has(path))continue;
    try{const absolute=await contextualFile(root,path),stat=await Deno.stat(absolute);if(!stat.isFile||stat.size>4_000_000)fail('relation batch authoring input exceeds four million bytes');inputBytes+=stat.size;if(inputBytes>64*1024*1024)fail('relation batch source/context freshness inputs exceed64MiB');const bytes=await Deno.readFile(absolute);if(bytes.length>4_000_000)fail('relation batch authoring input exceeds four million bytes');values.set(path,{path,hash:await sha256(bytes)});}
    catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;values.set(path,{path,absent:true});}
  }
  for(const entry of project.dependencies)if(['source','include','declarations','schema'].includes(entry.kind)&&values.has(entry.path)&&values.get(entry.path)!.hash!==entry.hash)fail('relation batch input changed after native project inspection; request a fresh batch');
  return [...values.values()].sort((a,b)=>a.path<b.path?-1:1);
}
/** A bounded name-only project inventory catches added/removed source or YAML
 * contexts without asking Quarto to reload the project for every window. */
async function relationBatchInventory(root:string,project:Data):Promise<string>{
  const output=project.config?.project?.['output-dir'],excluded=new Set(['.git','.quarto','_extensions','node_modules','_freeze','_site']);
  if(typeof output==='string'&&output!=='.')excluded.add(projectPath(output));
  const rows:Data[]=[];let directories=0,entries=0;
  async function walk(path:string){if(++directories>2048)fail('relation batch project inventory exceeds2048 directories');for await(const entry of Deno.readDir(path?join(root,path):root)){
    if(++entries>20000)fail('relation batch project inventory exceeds20000 entries');const relative=path?path+'/'+entry.name:entry.name;if(excluded.has(entry.name)||excluded.has(relative))continue;
    if(entry.isSymlink){rows.push({path:relative,kind:'link'});continue;}
    if(entry.isDirectory){rows.push({path:relative,kind:'directory'});await walk(relative);}
    else if(entry.isFile&&/\.(?:qmd|md|ya?ml)$/i.test(entry.name))rows.push({path:relative,kind:'authoring-input'});
  }}
  await walk('');return await sha256(canonical(rows.sort((a,b)=>a.path<b.path?-1:1)));
}
async function verifyRelationBatchInputs(root:string,inputs:Data[]):Promise<void>{
  let inputBytes=0;
  for(const input of inputs){try{const path=await contextualFile(root,input.path),stat=await Deno.stat(path);inputBytes+=stat.size;if(input.absent||!stat.isFile||stat.size>4_000_000||inputBytes>64*1024*1024)fail('relation batch input changed; no index was committed');const bytes=await Deno.readFile(path);if(bytes.length>4_000_000||await sha256(bytes)!==input.hash)fail('relation batch input changed; no index was committed');}
    catch(error){if(error instanceof Deno.errors.NotFound&&input.absent)continue;if(error instanceof Deno.errors.NotFound)fail('relation batch input disappeared; no index was committed');throw error;}}
}
const adapterPath=join(dirname(fromFileUrl(import.meta.url)),"adapters","litert_lm.py");
const encoderPath=join(dirname(fromFileUrl(import.meta.url)),"adapters","embeddinggemma.py");
export async function invokePython(python:string,args:string[],input:Data|undefined,timeout:number,adapter=adapterPath):Promise<Data>{
  if(!Number.isFinite(timeout)||timeout<1||timeout>300)fail("local adapter deadline must be within 1–300 seconds");
  const process=new Deno.Command(python,{args:["-I","-B",adapter,...args],stdin:input?"piped":"null",stdout:"piped",stderr:"piped",
    env:{PYTHONDONTWRITEBYTECODE:"1",HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1"}}).spawn();
  let failure:string|undefined;
  const stop=(message:string)=>{failure??=message;try{process.kill("SIGKILL");}catch{/* process already exited */}};
  const readBounded=async(stream:ReadableStream<Uint8Array>,limit:number,label:string):Promise<Uint8Array>=>{
    const reader=stream.getReader(),chunks:Uint8Array[]=[];let length=0;
    try{
      while(true){const next=await reader.read();if(next.done)break;
        if(length+next.value.length>limit){stop(`local adapter ${label} exceeds its ${limit}-byte protocol limit`);await reader.cancel();throw new Error(failure);}
        chunks.push(next.value);length+=next.value.length;
      }
      const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
    }finally{reader.releaseLock();}
  };
  const writeInput=async()=>{
    if(!input)return;const writer=process.stdin.getWriter();
    try{await writer.write(new TextEncoder().encode(JSON.stringify(input)));await writer.close();}finally{writer.releaseLock();}
  };
  const timer=setTimeout(()=>stop("local adapter exceeded its authoring deadline"),timeout*1000);
  const operations=[readBounded(process.stdout,adapter===encoderPath?64_000_000:2_000_000,"stdout"),
    readBounded(process.stderr,64_000,"stderr"),process.status,writeInput()] as const;
  try{
    const [stdout,stderr,status]=await Promise.all(operations);
    if(failure)fail(failure);
    // Adapter output can contain prompts, paths or credentials. A failure must
    // not replay that arbitrary stream into the renderer/terminal diagnostic.
    if(!status.success)fail("local adapter failed; inspect the selected runtime/model privately and retry with a synthetic input");
    try{return JSON.parse(new TextDecoder().decode(stdout));}catch{fail("local adapter returned an invalid protocol response");}
  }catch(error){
    stop(error instanceof Error?error.message:String(error));await Promise.allSettled(operations);fail(failure!);
  }finally{clearTimeout(timer);}
}
async function manifestAt(root:string,path:string):Promise<Data>{
  const manifest=parseAssistanceManifest(parse(await Deno.readTextFile(await confined(root,projectPath(path)))));
  for(const artifact of [manifest.runtime.python,manifest.generation.artifact]){
    artifact.path=isAbsolute(artifact.path)?artifact.path:resolve(root,projectPath(artifact.path));
  }
  if(manifest.retrieval)for(const artifact of [manifest.retrieval.index,manifest.retrieval.query]){
    const bytes=await Deno.readFile(await confined(root,projectPath(artifact.path)));
    if(await sha256(bytes)!==artifact.sha256)fail("local embedding input artifact hash mismatch");
  }
  return manifest;
}
export async function main(args:string[]=Deno.args):Promise<void>{
  const {command,values}=argumentsFor(args);
  if(command==="help"||command==="--help"||command==="-h"){console.log(help);return;}
  const root=Deno.cwd();
  if(command==="probe"){
    if(values.runtime!==undefined&&values.runtime!=="embedding")fail("probe runtime must be omitted or embedding");
    console.log(JSON.stringify(await invokePython(required(values,"python"),["--probe"],undefined,60,values.runtime==="embedding"?encoderPath:adapterPath),null,2));return;
  }
  if(!["suggest","accept","embed",'disambiguate','review-context','resolve','review-resolution','relate','relate-project','review-relations'].includes(command))fail("unknown assistance command; use help");
  const project=await loadProject(root);
  if(command==="embed"){
    const manifest=parseEmbeddingManifest(parse(await Deno.readTextFile(await confined(root,projectPath(required(values,"manifest"))))));
    for(const item of [manifest.runtime.python])item.path=isAbsolute(item.path)?item.path:resolve(root,projectPath(item.path));
    manifest.embedding.directory=isAbsolute(manifest.embedding.directory)?manifest.embedding.directory:resolve(root,projectPath(manifest.embedding.directory));
    const path=projectPath(required(values,"source"));if(!project.sources.includes(path))fail("embedding query source must belong to graph scope");
    const source=await sourceAt(root,path),start=values.start===undefined?0:Number(values.start),end=values.end===undefined?Math.min(source.text.length,start+1000):Number(values.end);
    sliceBounds(source.text,start,end,"embedding query");
    const items:Data[]=[];for(const raw of required(values,"context").split(",")){
      const path=projectPath(raw);if(!project.sources.includes(path))fail("embedding context source must belong to graph scope");
      items.push(...await embeddingWindows(await sourceAt(root,path)));
    }
    const request=await makeEmbeddingRequest(manifest,{path,sourceHash:source.hash,start,end,text:source.text.slice(start,end)},items,await sha256(await Deno.readFile(encoderPath)));
    const result=await invokePython(manifest.runtime.python.path,[],{request},manifest.embedding.timeoutSeconds,encoderPath);
    if(result.version!==0||result.requestId!==request.requestId)fail("encoder response does not match the authoring request");
    await retrieveContext(result.index,result.query,request.query.text,async path=>await sourceAt(root,path),1);
    const prefix=privatePath(values.output??`${STATE}/embeddings/${request.requestId}`);
    await atomicJson(await confined(root,`${prefix}.index.json`),result.index);await atomicJson(await confined(root,`${prefix}.query.json`),result.query);
    const indexBytes=await Deno.readFile(await confined(root,`${prefix}.index.json`)),queryBytes=await Deno.readFile(await confined(root,`${prefix}.query.json`));
    await atomicJson(await confined(root,`${prefix}.request.json`),request);
    await Deno.writeTextFile(await confined(root,`${prefix}.retrieval.yml`),stringify({retrieval:{index:{path:`${prefix}.index.json`,sha256:await sha256(indexBytes)},
      query:{path:`${prefix}.query.json`,sha256:await sha256(queryBytes)},"top-k":3}}));
    console.log(`Local embeddings: ${prefix}.index.json / .query.json; ${items.length} exact source windows; retrieval settings in ${prefix}.retrieval.yml`);return;
  }
  const declarationPath=projectPath(project.config["knowledge-graph"]?.declarations??"knowledge.yml");
  const declarationBytes=await Deno.readFile(await confined(root,declarationPath));
  const declarations=parse(new TextDecoder("utf-8",{fatal:true}).decode(declarationBytes)) as Data;
  if(command==='resolve'||command==='review-resolution'){
    const workspace=await semanticWorkspace(root,required(values,'workspace'));
    const code=async()=>{
      const files=await Promise.all(['assist.ts','semantic-context.ts','semantic-guidance.ts','contextual.ts','source-map.ts','relation-proposals.ts','assistance.ts','schema.ts','local-generation.ts'].map(async name=>({name,hash:await sha256(await Deno.readFile(new URL(name,import.meta.url)))})));
      return {algorithmHash:await sha256(canonical(files)),transportHash:files.find(f=>f.name==='local-generation.ts')!.hash};
    };
    const serverPath=projectPath(required(values,'server'));
    const capture=async(current:Data,path:string,policyPath:string,slices?:Data[],protocol='reference')=>{
      if(!current.sources.includes(projectPath(path)))fail('semantic source must belong to the selected graph scope');
      await contextualFile(root,path);const source=await sourceAt(root,path),policy=await contextualData(root,policyPath),server=await semanticData(workspace,serverPath),implementation=await code();
      const declaration=projectPath(current.config['knowledge-graph']?.declarations??'knowledge.yml'),declarationBytes=await Deno.readFile(await contextualFile(root,declaration));
      const start=values.start===undefined?0:Number(values.start),end=values.end===undefined?Math.min(source.text.length,start+12000):Number(values.end);
      const selected=slices?slices.map(s=>({start:s.start,end:s.end,text:source.text.slice(s.start,s.end)})):[{start,end,text:source.text.slice(start,end)}];
      for(const s of selected)sliceBounds(source.text,s.start,s.end,'semantic prose');
      return {protocol,source,slices:selected,schema:current.schema,objects:current.objects,namespaces:current.namespaces,declarationsHash:await sha256(declarationBytes),policy:policy.value,policyFile:{path:policyPath,hash:policy.hash},generation:server.value,generationFile:{path:serverPath,hash:server.hash},...implementation};
    };
    const identity=(value:Data)=>canonical({dependencyDigest:value.dependencyDigest,sources:value.sources,schema:value.schema,objects:value.objects,relations:value.relations,namespaces:value.namespaces});
    if(command==='resolve'){
      const protocol=values.discovery==='open'?'surface':'reference';
      const policyPath=projectPath(required(values,'context')),input=await capture(project,required(values,'source'),policyPath,undefined,protocol),request=await makeSemanticContextRequest(input),sidecar=await semanticContextSuggestions(request);
      await validateSemanticContextSuggestions(sidecar);
      const current=await loadProject(root),fresh=await makeSemanticContextRequest(await capture(current,input.source.path,policyPath,input.slices,protocol));
      if(identity(current)!==identity(project)||canonical(fresh)!==canonical(request))fail('semantic inputs changed during generation; no suggestions were committed');
      const output=values.output??`semantic/${request.requestId}/${crypto.randomUUID()}.json`,absolute=await semanticFile(workspace,output,true),choices=await semanticFile(workspace,output+'.choices.yml',true);
      for(const target of [absolute,choices])try{await Deno.lstat(target);fail('semantic output already exists; choose a new private path');}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
      await Deno.mkdir(dirname(absolute),{recursive:true});await Deno.writeTextFile(absolute,canonical(sidecar)+'\n',{createNew:true});
      await Deno.writeTextFile(choices,stringify({version:1,choices:sidecar.mentions.map((m:Data)=>({mentionId:m.mentionId,id:m.suggestedId,public:false}))}),{createNew:true});
      console.log(`Private semantic proposals: ${output}; ${sidecar.mentions.length} mentions; ${sidecar.status}; choices: ${output}.choices.yml; no links or canonical edits`);return;
    }
    const sidecar=(await semanticData(workspace,required(values,'suggestions'))).value;await validateSemanticContextSuggestions(sidecar);
    const previous=sidecar.request.context,choices=(await semanticData(workspace,required(values,'choices'))).value;
    if(choices.version!==1||Object.keys(choices).some(k=>!['version','choices'].includes(k)))fail('semantic choices require version 1 and a choices sequence');
    if(sidecar.request.generationFile?.path!==serverPath)fail('semantic review requires its original server configuration file');
    const protocol=sidecar.request.version===3?'reference':sidecar.request.version===2?'indexed':'surface';
    const input=await capture(project,previous.source.path,previous.policyFile.path,previous.slices,protocol),result=await reviewSemanticContextSuggestions(sidecar,{current:input,choices:choices.choices,reviewed:values.reviewed===true,reviewer:required(values,'reviewer')});
    const current=await loadProject(root),fresh=await makeSemanticContextRequest(await capture(current,previous.source.path,previous.policyFile.path,previous.slices,protocol));
    if(identity(current)!==identity(project)||canonical(fresh)!==canonical(sidecar.request))fail('semantic review inputs changed; no patch was committed');
    const output=values.output??`accepted/semantic-${sidecar.requestId}-${crypto.randomUUID()}.yml`,absolute=await semanticFile(workspace,output,true),receipt=await semanticFile(workspace,output+'.review.json',true);
    for(const target of [absolute,receipt])try{await Deno.lstat(target);fail('semantic review output already exists; choose a new private path');}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
    await Deno.mkdir(dirname(absolute),{recursive:true});await Deno.writeTextFile(absolute,stringify(result.patch),{createNew:true});await Deno.writeTextFile(receipt,canonical(result.review)+'\n',{createNew:true});
    console.log(`Reviewed semantic occurrence patch: ${output}; source prose, canonical identities and declarations unchanged; publication requires explicit selection`);return;
  }
  if(command==='relate'||command==='relate-project'||command==='review-relations'){
    const algorithmHash=await sha256(canonical(await Promise.all(['relation-proposals.ts','contextual.ts','assistance.ts'].map(async name=>({name,hash:await sha256(await Deno.readFile(new URL(name,import.meta.url)))})))));
    const sourceFor=async(path:string)=>{if(!project.sources.includes(projectPath(path)))fail('relation source must belong to the current graph scope');await contextualFile(root,path);return await sourceAt(root,path);};
    if(command==='relate-project'){
      const policyPath=projectPath(required(values,'context')),policy=await contextualData(root,policyPath);
      const paths=values.source===undefined?[...project.sources]:[projectPath(values.source)];if(paths.some(path=>!project.sources.includes(path)))fail('relation batch source must belong to the current graph scope');
      if(paths.length>256)fail('relation batch exceeds256 sources; select one scoped source or split the project');
      const sources:Data[]=[];let sourceBytes=0;for(const path of [...paths].sort()){const source=await sourceFor(path);sourceBytes+=new TextEncoder().encode(source.text).length;if(sourceBytes>32*1024*1024)fail('relation batch exceeds32MiB source bytes; select one source');sources.push(source);}
      const inputs=await relationBatchInputs(root,project,sources,policyPath,policy.hash),inventory=await relationBatchInventory(root,project);
      const batchAlgorithm=async()=>await sha256(canonical(await Promise.all(['assist.ts','relation-batch.ts','relation-proposals.ts','contextual.ts','assistance.ts'].map(async name=>({name,hash:await sha256(await Deno.readFile(new URL(name,import.meta.url)))})))));
      const batchAlgorithmHash=await batchAlgorithm(),output=values.output??`${STATE}/relations/project-${crypto.randomUUID()}`,absolute=await contextualFile(root,output,true);
      try{await Deno.lstat(absolute);fail('relation batch output directory already exists; choose a new private path');}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
      await Deno.mkdir(dirname(absolute),{recursive:true});await Deno.mkdir(absolute);
      const index=await buildRelationBatch({sources,context:{schema:project.schema,objects:project.objects,namespaces:project.namespaces,existingRelations:project.relations,declarationsHash:await sha256(declarationBytes),policy:policy.value,policyFile:{path:policyPath,hash:policy.hash},algorithmHash},scope:{sourcePaths:project.sources,dependencyDigest:project.dependencyDigest,batchAlgorithmHash,inventoryHash:inventory,inputFiles:inputs}},{
        writeSidecar:async(name,sidecar)=>{const target=await contextualFile(root,`${output}/${name}`,true);await Deno.writeTextFile(target,canonical(sidecar)+'\n',{createNew:true});},
        verifyFresh:async()=>{await verifyRelationBatchInputs(root,inputs);if(await relationBatchInventory(root,project)!==inventory||await batchAlgorithm()!==batchAlgorithmHash)fail('relation batch scope or algorithm changed; no index was committed');
          // One final native reinspection for the whole batch closes the gap
          // between interpreted metadata and its later raw-byte capture. Never
          // reload a project or reconstruct Quarto metadata per window.
          const current=await loadProject(root),identity=(value:Data)=>canonical({dependencyDigest:value.dependencyDigest,sources:value.sources,schema:value.schema,objects:value.objects,relations:value.relations,namespaces:value.namespaces});
          if(identity(current)!==identity(project))fail('relation batch native context changed; no index was committed');
          await verifyRelationBatchInputs(root,inputs);if(await relationBatchInventory(root,project)!==inventory||await batchAlgorithm()!==batchAlgorithmHash)fail('relation batch inputs changed during final native reinspection; no index was committed');
        },
        writeIndex:async(index)=>{const path=await contextualFile(root,`${output}/index.json`,true),pending=await contextualFile(root,`${output}/index-${crypto.randomUUID()}.pending`,true);await Deno.writeTextFile(pending,canonical(index)+'\n',{createNew:true});await Deno.rename(pending,path);}
      });
      console.log(`Private model-free relation batch: ${output}/index.json; ${index.sources.length} sources; ${index.budgets.windowJobs} windows; ${index.relations.length} unreviewed relation groups; complete window coverage, semantic completeness not established; no canonical edits or links`);return;
    }
    const adapterHash=await sha256(await Deno.readFile(adapterPath));
    if(command==='relate'){
      const source=await sourceFor(required(values,'source')),start=values.start===undefined?0:Number(values.start),end=values.end===undefined?Math.min(source.text.length,start+12000):Number(values.end);sliceBounds(source.text,start,end,'relation prose');
      const policyPath=projectPath(required(values,'context')),policy=await contextualData(root,policyPath),manifest=values.manifest===undefined?undefined:await manifestAt(root,values.manifest);
      if(manifest)await invokePython(manifest.runtime.python.path,['--verify'],{manifest},manifest.generation.timeoutSeconds);
      const sidecar=await relationSuggestions({source,slices:[{start,end,text:source.text.slice(start,end)}],schema:project.schema,objects:project.objects,namespaces:project.namespaces,existingRelations:project.relations,declarationsHash:await sha256(declarationBytes),policy:policy.value,policyFile:{path:policyPath,hash:policy.hash},algorithmHash,...(manifest?{manifest,adapterHash}:{})},manifest?{adapter:async(request,prompt)=>{
        const cacheDirectory=await contextualFile(root,`${STATE}/assist-cache`,true);await Deno.mkdir(cacheDirectory,{recursive:true});return await invokePython(manifest.runtime.python.path,[],{request,prompt,cacheDirectory},manifest.generation.timeoutSeconds);
      }}:{});
      const output=values.output??`${STATE}/relations/${sidecar.requestId}.json`;await atomicJson(await contextualFile(root,output,true),sidecar);
      console.log(`Private relation proposals: ${output}; ${sidecar.candidates.length} candidates; ${sidecar.status}; no canonical edits or links`);return;
    }
    const sidecar=(await contextualData(root,required(values,'suggestions'),true)).value,previous=sidecar.request?.context?.request;if(!previous)fail('relation suggestions require their source-bound context');
    const source=await sourceFor(previous.source?.path),policyPath=previous.policyFile?.path;if(typeof policyPath!=='string')fail('relation review requires its original policy file');
    const policy=await contextualData(root,policyPath),manifest=sidecar.request.manifest?await manifestAt(root,required(values,'manifest')):undefined;if(!sidecar.request.manifest&&values.manifest!==undefined)fail('deterministic review does not accept an unrelated model manifest');
    const result=await reviewRelationSuggestions(sidecar,{ids:required(values,'ids').split(','),reviewed:values.reviewed===true,reviewer:required(values,'reviewer'),publicIds:values['public-ids']?.split(','),currentSource:source,currentDeclarationsHash:await sha256(declarationBytes),schema:project.schema,objects:project.objects,relations:project.relations,policy:policy.value,policyFileHash:policy.hash,algorithmHash,...(manifest?{manifest,adapterHash}:{})});
    const output=values.output??`${STATE}/accepted/relations-${sidecar.requestId}.yml`,absolute=await contextualFile(root,output,true),receipt=await contextualFile(root,`${output}.review.json`,true);
    for(const path of [absolute,receipt])try{await Deno.lstat(path);fail('reviewed relation output already exists; choose a new private path');}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
    await Deno.mkdir(dirname(absolute),{recursive:true});await Deno.writeTextFile(absolute,stringify(result.patch),{createNew:true});await atomicJson(receipt,result.review);
    console.log(`Reviewed relation patch: ${output}; canonical declarations/source unchanged; publication requires explicit selection`);return;
  }
  if(command==='disambiguate'||command==='review-context'){
    const algorithmHash=await sha256(await Deno.readFile(new URL('./contextual.ts',import.meta.url)));
    const sourceFor=async(path:string)=>{
      if(!project.sources.includes(projectPath(path)))fail('contextual source must belong to current graph scope');
      await contextualFile(root,path);return await sourceAt(root,path);
    };
    if(command==='disambiguate'){
      const source=await sourceFor(required(values,'source')),start=values.start===undefined?0:Number(values.start),end=values.end===undefined?Math.min(source.text.length,start+12000):Number(values.end);
      sliceBounds(source.text,start,end,'contextual prose');const policyPath=projectPath(required(values,'context')),policy=await contextualData(root,policyPath);
      const sidecar=await contextualSuggestions({source,slices:[{start,end,text:source.text.slice(start,end)}],schema:project.schema,objects:project.objects,namespaces:project.namespaces,
        declarationsHash:await sha256(declarationBytes),policy:policy.value,algorithmHash,policyFile:{path:policyPath,hash:policy.hash}});
      const output=values.output??`${STATE}/contextual/${sidecar.requestId}.json`;
      await atomicJson(await contextualFile(root,output,true),sidecar);
      console.log(`Private contextual suggestions: ${output}; ${sidecar.mentions.length} mentions; no links or canonical edits`);return;
    }
    const sidecar=(await contextualData(root,required(values,'suggestions'),true)).value;
    const source=await sourceFor(sidecar.request?.source?.path),policyPath=sidecar.request?.policyFile?.path;
    if(typeof policyPath!=='string')fail('contextual review needs the original author policy file');
    const policy=await contextualData(root,policyPath),choices=(await contextualData(root,required(values,'choices'))).value;
    if(choices.version!==1||Object.keys(choices).some(key=>!['version','choices'].includes(key)))fail('context choices require version 1 and a choices sequence');
    const result=await reviewContextualSuggestions(sidecar,{choices:choices.choices,reviewed:values.reviewed===true,reviewer:required(values,'reviewer'),currentSource:source,
      currentDeclarationsHash:await sha256(declarationBytes),schema:project.schema,objects:project.objects,policy:policy.value,policyFileHash:policy.hash,algorithmHash});
    const output=values.output??`${STATE}/accepted/contextual-${sidecar.requestId}.yml`,absolute=await contextualFile(root,output,true),review=await contextualFile(root,`${output}.review.json`,true);
    for(const target of [absolute,review])try{await Deno.lstat(target);fail('reviewed contextual output already exists; choose a new private path');}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
    await Deno.mkdir(dirname(absolute),{recursive:true});await Deno.writeTextFile(absolute,stringify(result.patch),{createNew:true});await atomicJson(review,result.review);
    console.log(`Reviewed contextual occurrence patch: ${output}; canonical IDs, declarations and source text unchanged`);return;
  }
  if(command==="suggest"){
    const manifest=await manifestAt(root,required(values,"manifest"));
    await invokePython(manifest.runtime.python.path,["--verify"],{manifest},manifest.generation.timeoutSeconds);
    const path=projectPath(required(values,"source"));if(!project.sources.includes(path))fail("assistance source must belong to the selected graph scope");
    const source=await sourceAt(root,path),start=values.start===undefined?0:Number(values.start),end=values.end===undefined?Math.min(source.text.length,start+12000):Number(values.end);
    const slices=[{start,end,text:source.text.slice(start,end)}];let retrieved:Data[]=[];
    if(manifest.retrieval){
      const index=await readJson(await confined(root,manifest.retrieval.index.path)),query=await readJson(await confined(root,manifest.retrieval.query.path));
      retrieved=await retrieveContext(index,query,slices[0].text,async path=>{
        if(!project.sources.includes(projectPath(path)))fail("retrieved context must belong to the selected graph scope");return await sourceAt(root,path);
      },manifest.retrieval.topK);
    }
    const request=await makeRequest({manifest,schema:project.schema,source,slices,namespaces:declarations.namespaces,
      existingObjects:project.objects,existingRelations:project.relations,declarationsHash:await sha256(declarationBytes),retrieved});
    request.adapterHash=await sha256(await Deno.readFile(adapterPath));
    // The adapter's code identity is itself an input to cache/request provenance.
    const {requestId:_requestId,...body}=request;request.requestId=await sha256(canonical(body));
    const output=privatePath(values.output??`${STATE}/suggestions/${request.requestId}.json`);
    let cached:Data|undefined;try{cached=await readJson(await confined(root,output));}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
    const sidecar=await suggest(request,async (request,prompt)=>{
      const cacheDirectory=await confined(root,`${STATE}/assist-cache`);await Deno.mkdir(cacheDirectory,{recursive:true});
      return await invokePython(manifest.runtime.python.path,[],{request,prompt,cacheDirectory},manifest.generation.timeoutSeconds);
    },cached);
    await atomicJson(await confined(root,output),sidecar);
    console.log(`Private suggestions: ${output}; ${sidecar.candidates.length} candidates; ${sidecar.status}; cache ${sidecar.cacheHit?"reused":"new"}`);return;
  }
  const sidecar=await readJson(await confined(root,privatePath(required(values,"suggestions"))));
  if(!project.sources.includes(sidecar.request?.source?.path))fail("suggestion source is outside the current graph scope");
  const source=await sourceAt(root,sidecar.request.source.path);
  for(const item of sidecar.request.retrieved??[]){
    if(!project.sources.includes(projectPath(item.path)))fail("retrieved suggestion source left the current graph scope");
    const current=await sourceAt(root,item.path);if(current.hash!==item.sourceHash||current.text.slice(item.start,item.end)!==item.text)fail("retrieved context changed after suggestions; request fresh suggestions");
  }
  const result=await acceptSuggestions(sidecar,{ids:required(values,"ids").split(","),reviewed:values.reviewed===true,reviewer:required(values,"reviewer"),
    publicIds:values["public-ids"]?.split(","),currentSourceHash:source.hash,currentSourceText:source.text,currentDeclarationsHash:await sha256(declarationBytes),schema:project.schema});
  const output=privatePath(values.output??`${STATE}/accepted/${sidecar.requestId}.yml`),absolute=await confined(root,output);
  try{await Deno.stat(absolute);fail("accepted patch already exists; choose a new private output path");}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
  await Deno.mkdir(dirname(absolute),{recursive:true});
  await Deno.writeTextFile(absolute,stringify(result.patch),{createNew:true});
  await atomicJson(await confined(root,`${output}.review.json`),result.review);
  console.log(`Reviewed declarations patch: ${output}; canonical declarations unchanged; publication defaults to false.`);
}
if(import.meta.main)try{await main();}catch(error){console.error(error instanceof Error?error.message:String(error));Deno.exit(1);}
