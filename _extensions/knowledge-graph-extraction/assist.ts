// Explicit authoring CLI, never imported by prepare/finalize or render filters.
import { parse, stringify } from "stdlib/yaml";
import { dirname, fromFileUrl, isAbsolute, join, resolve } from "stdlib/path";
import { atomicJson, confined, fail, loadProject, projectPath, readJson, STATE } from "./core.ts";
import { acceptSuggestions, canonical, makeRequest, parseAssistanceManifest, retrieveContext, sha256, sliceBounds, suggest } from "./assistance.ts";
import { embeddingWindows, makeEmbeddingRequest, parseEmbeddingManifest } from "./embedding.ts";
type Data=Record<string,any>;
const help=`Knowledge Graph Extraction: explicit local authoring assistance
  quarto run _extensions/knowledge-graph-extraction/assist.ts probe --python PATH [--runtime embedding]
  quarto run _extensions/knowledge-graph-extraction/assist.ts embed --manifest local-embedding.yml --source QUERY_PAGE --context PAGE,PAGE [--start 0 --end 1000] [--output ${STATE}/embeddings/context]
  quarto run _extensions/knowledge-graph-extraction/assist.ts suggest --manifest local-ai.yml --source page.qmd [--start 0 --end 1000] [--output ${STATE}/suggestions/review.json]
  quarto run _extensions/knowledge-graph-extraction/assist.ts accept --suggestions PRIVATE_JSON --ids URI,URI --reviewed --reviewer NAME [--public-ids URI] [--output ${STATE}/accepted/review.yml]
Acceptance writes a separate declarations patch and review receipt. It never merges canonical declarations automatically.
No downloads, installation or model inference occur during Quarto rendering.`;
function argumentsFor(args:string[]):{command:string;values:Data}{
  const command=args[0]??"help",values:Data={};
  const allowed=command==="probe"?["python","runtime"]:command==="embed"?["manifest","source","context","start","end","output"]:command==="suggest"?["manifest","source","start","end","output"]:
    command==="accept"?["suggestions","ids","reviewed","reviewer","public-ids","output"]:[];
  for(let i=1;i<args.length;i++){
    const key=args[i].replace(/^--/,"");if(!args[i].startsWith("--")||!allowed.includes(key)||Object.hasOwn(values,key))fail("unknown or repeated assistance argument; use help");
    if(key==="reviewed"){values[key]=true;continue;}
    if(i+1>=args.length||args[i+1].startsWith("--"))fail(`--${key} needs a value`);values[key]=args[++i];
  }
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
    if(!status.success)fail(`local adapter failed: ${new TextDecoder().decode(stderr).slice(-1500)}`);
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
  if(!["suggest","accept","embed"].includes(command))fail("unknown assistance command; use help");
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
