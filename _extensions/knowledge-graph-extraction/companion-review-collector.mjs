// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// No project/runtime imports, native execution or networking.
import {posix,resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
import {boundedFS,localPath,canonical,sha,Refusal} from './companion-review-files.mjs';
import {compatibleProvider as compatibleCompanion,reviewedCurrentPayloads} from './companion-review-admission.mjs';
const decoder=new TextDecoder('utf-8',{fatal:true});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const error=code=>{throw new Refusal(code);};
function data(value,depth=0,count={value:0}){
  if(depth>32||++count.value>20000)error('metadata-budget');
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value)){
    if(value.length>1024||Reflect.ownKeys(value).length!==value.length+1)error('nondata-array');
    return Array.from({length:value.length},(_,i)=>{const p=Object.getOwnPropertyDescriptor(value,String(i));if(!p||!Object.hasOwn(p,'value'))error('nondata-array');return data(p.value,depth+1,count);});
  }
  if(!object(value))error('nondata-metadata');const result=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
    const p=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!p.enumerable||!Object.hasOwn(p,'value'))error('nondata-metadata');
    result[key]=data(p.value,depth+1,count);
  }
  return result;
}
export const copyMetadata=value=>data(value);
/** One bounded observation session per union/prepare, NEVER across renders. */
export async function createObservationSession(root){return {fs:await boundedFS(root,{memoize:true}),packageCache:new Map()};}
const list=(value,max,code)=>{if(!Array.isArray(value)||value.length>max)error(code);return value;};
const mapping=(value,code)=>{if(!object(value))error(code);return value;};
const knownFields={
  'accessible-maths':['enabled','theorem-controls','semantics','mathml-output','intent-speech','catalogue','labels'],
  'maths-knowledge-graph':['enabled','declarations','notation','scopes','notation-defaults','notation-overrides','notation-preferences','formal-proofs','reuse-relations','import-accessible-maths','graph'],
  'interactive-cv':['enabled','as-of','services','records','record-id','exports','catalogue','graph','graph-file','language-pages','page-revision','reports','delivery','temporal-rules','claim-validity','professional-narratives'],
  'generative-websites':['translations','enabled','prerequisites','graph-prerequisites','local-ai-sources','catalogue','numbas','activities','controlled-authoring','scenario-candidates','wai-adapt','project','defaults','assertions','exercises','records','reports','sandbox','sandbox-session-mappings','publication','offline','oer'],
  'local-ai-websites':['enabled','manifest','publish-assets','proposal-format','source-pages','corpus','graphs'],
};
function fields(value,allowed,code){mapping(value,code);if(Object.keys(value).some(key=>!allowed.includes(key)))error(code);return value;}

/** Caller MUST pass effective, path-rebased native metadata for ONE containing
 * document. This does not merge Quarto profiles/frontmatter/metadata files.
 * `kgPrerequisites` is semantic preparedPrerequisites(project), WITHOUT its
 * dependencyDigest, supplied by KG itself (avoids a circular digest/run file).
 * `parseYAML` must be the same bounded literal parser KG uses, never execution.
 * Returned unsafe reasons are SOURCE-SCOPED, not an excuse for global admission.
 */
export async function collectCompanionDependencies({root,sourcePath,metadata,activeCompanions,parseYAML,reviewed=reviewedCurrentPayloads,kgPrerequisites,mkgDirectory,pathContexts,observationSession}={}){
  const session=observationSession??await createObservationSession(root),fs=session.fs;if(fs.root!==resolve(root))error('observation-session-root-mismatch');
  const source=localPath(sourcePath),base=posix.dirname(source);
  const deps=new Map(),reasons=[],trees=[],probes=[],derived=[],packageCache=session.packageCache;
  const reason=(code,feature)=>{if(!reasons.some(r=>r.code===code&&r.feature===feature))reasons.push({scope:'source',code,feature});};
  async function attempt(feature,operation){try{return await operation();}catch(cause){reason(cause.code??(cause.code==='ENOENT'?'missing-input':'unavailable-input'),feature);return null;}}
  function add(row,kind='companion-input'){
    const prior=deps.get(row.path);if(prior&&prior.hash!==row.hash)error('input-changed-between-features');
    deps.set(row.path,{path:row.path,hash:row.hash,kind,bytes:row.size});return row;
  }
  async function read(reference,options={}){
    const contexts=options.base!==undefined?[options.base]:pathContexts??[base],paths=[];
    if(!Array.isArray(contexts)||!contexts.length||contexts.length>8)error('path-context-budget');
    for(const context of contexts){
      try{const path=localPath(reference,context,{rootRelative:options.rootRelative??false,runtime:options.runtime??false});if(!paths.includes(path))paths.push(path);}
      catch(cause){if(!pathContexts||options.base!==undefined)throw cause;}
    }
    if(!paths.length)error('unsafe-local-path');const rows=[];
    for(const path of paths){
      const row=await fs.read(path,{...options,missing:!!pathContexts||options.missing});
      if(row){add(row,options.kind);rows.push(row);}else probes.push({path,kind:'raw-context-absence',hash:sha('absent-companion-input')});
    }
    if(!rows.length)error('all-context-inputs-absent');
    return {...rows[0],alternatives:rows.map(({path,hash})=>({path,hash}))};
  }
  async function optional(path,kind='companion-probe'){
    const row=await fs.read(path,{missing:true});if(row)add(row,kind);else probes.push({path,kind,hash:sha('absent-companion-input')});return row;
  }
  async function packageObservation(directory){
    if(packageCache.has(directory)){const cached=packageCache.get(directory);if(!compatibleCompanion(directory.split('/').at(-1),cached.result.version,cached.result.hash,reviewed))error('unreviewed-provider-payload');for(const row of cached.rows)add(row,'companion-runtime');trees.push(cached.tree);return cached.result;}
    const tree=await fs.tree(directory,{runtime:true,maxFiles:256,maxBytes:8*1024*1024,maxFileBytes:8*1024*1024});
    for(const row of tree.rows)add(row,'companion-runtime');
    const manifest=tree.rows.find(row=>row.path===directory+'/_extension.yml');if(!manifest)error('missing-provider-manifest');
    const version=decoder.decode(manifest.bytes).match(/^version:\s*([^\r\n]+)$/mu)?.[1];
    const name=directory.split('/').at(-1);if(!compatibleCompanion(name,version,tree.hash,reviewed))error('unreviewed-provider-payload');
    const marker={path:directory,kind:'provider-tree',hash:tree.hash,files:tree.rows.length};trees.push(marker);const result={directory,version,hash:tree.hash};packageCache.set(directory,{result,rows:tree.rows,tree:marker});return result;
  }
  /** CV discovers only flat + one owner level (<=64 owner entries), no recursion.
   * Probe records the exact candidate SET, including empty/ambiguous states.
   * The selected COMPLETE package is hashed, covering transitive relative imports.
   * More than one provider remains unsafe; missing optional providers are stable.
   */
  async function provider(name,file,{directories}={}){
    let candidates=directories;
    if(!candidates){
      const extensions=await fs.inspect('_extensions',{runtime:true,directory:true,missing:true});
      if(!extensions){probes.push({kind:'provider-presence',path:`provider:${name}/${file}`,hash:sha(canonical([]))});return null;}
      const entries=await readdir(extensions.absolute,{withFileTypes:true});if(entries.length>64)error('provider-owner-budget');
      candidates=[`_extensions/${name}`];
      for(const entry of entries){if(entry.isSymbolicLink())error('linked-provider-owner');if(entry.isDirectory()&&entry.name!==name)candidates.push(`_extensions/${entry.name}/${name}`);}
    }
    const found=[];
    for(const directory of [...new Set(candidates)].sort()){
      localPath(directory,'.',{runtime:true});
      const path=directory+'/'+file,entry=await fs.inspect(path,{runtime:true,missing:true});if(entry)found.push(directory);
    }
    probes.push({kind:'provider-presence',path:`provider:${name}/${file}`,hash:sha(canonical({searched:[...new Set(candidates)].sort(),found}))});
    if(found.length>1)error('ambiguous-provider');return found.length?await packageObservation(found[0]):null;
  }
  let meta;
  try{meta=data(metadata??{});}catch(cause){return {version:1,source,safe:false,reasons:[{scope:'source',code:cause.code??'invalid-metadata',feature:'effective-metadata'}],dependencies:[],trees:[],probes:[],derived:[],stats:fs.stats()};}
  const known=['accessible-maths','maths-knowledge-graph','interactive-cv','generative-websites','local-ai-websites','additional-citation-options'];
  let selected=[];
  if(!Array.isArray(activeCompanions)||activeCompanions.some(name=>!known.includes(name)))reason('active-companion-inventory-required','effective-metadata');
  else selected=[...new Set(activeCompanions)];
  const active=(name,namespace=name)=>{
    if(!selected.includes(name))return null;
    if(meta[namespace]===undefined)return {};
    if(!object(meta[namespace])){reason('unsupported-companion-options',name);return null;}
    if(knownFields[name]&&Object.keys(meta[namespace]).some(key=>!knownFields[name].includes(key))){reason('unknown-companion-option',name);return null;}
    return meta[namespace].enabled===false?null:meta[namespace];
  };
  await attempt('native-source',()=>read(source,{base:'.',kind:'source'}));

  const am=active('accessible-maths');
  // AM parses literal realisations before it returns the enabled flag; retain
  // the configured input even when intent-speech.enabled is false.
  const rawAM=selected.includes('accessible-maths')&&object(meta['accessible-maths'])?meta['accessible-maths']:am;
  if(rawAM&&object(rawAM['intent-speech'])&&rawAM['intent-speech']['braille-literals-file']!==undefined){
    await attempt('am-braille-literals',()=>read(rawAM['intent-speech']['braille-literals-file'],{maxBytes:65536}));
  }
  const mkg=active('maths-knowledge-graph');
  if(mkg){
    const declarations=mkg.declarations??(object(meta['knowledge-graph'])?meta['knowledge-graph'].declarations:undefined);
    if(declarations!==undefined)await attempt('mkg-declarations',()=>read(declarations));
    for(const field of ['notation','notation-preferences'])if(mkg[field]!==undefined)await attempt('mkg-'+field,()=>read(mkg[field],{maxBytes:field==='notation-preferences'?65536:2*1024*1024}));
    // Native defaults are ordered; include BOTH present files and absence probes.
    if(declarations===undefined)for(const path of ['knowledge.yml','knowledge.yaml','knowledge.json'])await attempt('mkg-default-catalogue',()=>optional(path));
    if(mkg['import-accessible-maths']!==false&&am?.catalogue===true)await attempt('mkg-accessible-maths-api',async()=>{
      if(typeof mkgDirectory!=='string')error('missing-native-mkg-directory');
      const adjacent=posix.dirname(localPath(mkgDirectory,'.',{runtime:true}))+'/accessible-maths';
      await provider('accessible-maths','catalogue-api.lua',{directories:[adjacent,'_extensions/accessible-maths','_extensions/kai-prince-sfhea/accessible-maths']});
    });
    if(object(mkg['formal-proofs'])&&mkg['formal-proofs'].enabled===true)await attempt('mkg-formal-proof-inputs',async()=>{
      const seen=new Set(),stack=new Set();let bytes=0;
      async function scan(path,depth=0){
        if(depth>8||seen.size>=32)error('proof-include-budget');if(stack.has(path))error('proof-include-cycle');if(seen.has(path))return;seen.add(path);stack.add(path);
        const row=await read(path,{base:'.',maxBytes:2*1024*1024});bytes+=row.size;if(bytes>4*1024*1024)error('proof-source-byte-budget');
        const lines=decoder.decode(row.bytes).split(/\r?\n/u);
        let fence=null,comment=false;
        for(const line of lines){
          const marker=/^ {0,3}(`{3,}|~{3,})/u.exec(line);if(marker){if(fence===null)fence=marker[1][0];else if(marker[1][0]===fence)fence=null;}
          if(line.includes('<!--'))comment=true;
          if(line.includes('proof-proposal')){
            // Conservative syntax subset: a SINGLE-LINE native fenced Div
            // opening, one quoted attribute, with both owning proof classes.
            const opening=/^ {0,3}:{3,}[ \t]*\{([^{}\r\n]+)\}[ \t]*$/u.exec(line);
            const matches=[...line.matchAll(/\bproof-proposal=(?:"([^"\r\n]+)"|'([^'\r\n]+)')/gu)];
            if(fence!==null||comment||!opening||!/(?:^|\s)\.maths-formal-proof(?:\s|$)/u.test(opening[1])||!/(?:^|\s)\.proof(?:\s|$)/u.test(opening[1])||matches.length!==1||(line.match(/proof-proposal/gu)??[]).length!==1||/[&`{}]/u.test(matches[0][1]??matches[0][2]))error('unsupported-proof-proposal-syntax');
            await read(matches[0][1]??matches[0][2],{base,maxBytes:2*1024*1024});
          }
          if(/\{\{<\s*include\b/u.test(line)){
            const include=/^[ \t]*\{\{<[ \t]*include[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s>]+))[ \t]*>\}\}[ \t]*$/u.exec(line);
            if(fence!==null||comment||!include)error('unsupported-proof-include-syntax');
            const value=include[1]??include[2]??include[3],native=localPath(value,base);
            // MKG's exact-source inventory resolves nested owner contexts;
            // native Quarto resolves in the main input context. Decline a
            // nested relative include if these two contracts would differ.
            if(localPath(value,posix.dirname(path))!==native)error('ambiguous-nested-proof-include-context');
            await scan(native,depth+1);
          }
          if(line.includes('-->'))comment=false;
        }
        stack.delete(path);
      }
      await scan(source);
    });
  }

  const cv=active('interactive-cv');
  if(cv){
    for(const field of ['catalogue','graph-file'])if(cv[field]!==undefined)await attempt('cv-'+field,()=>read(cv[field]));
    if(cv['professional-narratives']!==undefined)await attempt('cv-narrative-providers',async()=>{
      const rows=list(cv['professional-narratives'],32,'unsupported-cv-narratives');if(!rows.length)return;
      await provider('generative-websites','professional.js');
      if(rows.some(row=>object(row)&&row.proposal)){
        const la=await provider('local-ai-websites','proposal.js');if(la)await provider('local-ai-websites','local-ai-websites.js');
      }
    });
    if(cv.reports!==undefined)await attempt('cv-report-provider',async()=>{if(list(cv.reports,12,'unsupported-cv-reports').length&&!await provider('generative-websites','transparency.js'))error('required-report-provider-absent');});
  }

  const gw=active('generative-websites');
  if(gw)await attempt('gw-native-inputs',async()=>{
    let options=gw;
    if(gw.catalogue!==undefined){
      if(typeof parseYAML!=='function')error('yaml-parser-required');
      const row=await read(gw.catalogue,{maxBytes:1024*1024}),catalogue=data(parseYAML(decoder.decode(row.bytes)));
      if(new Set(row.alternatives.map(item=>item.hash)).size>1)error('ambiguous-raw-catalogue-context');
      mapping(catalogue,'invalid-gw-catalogue');if(catalogue.version!==1)error('unsupported-gw-catalogue-version');
      if(catalogue.catalogue!==undefined)error('recursive-gw-catalogue');
      fields(catalogue,['version',...knownFields['generative-websites'].filter(key=>!['enabled','catalogue','graph-prerequisites','local-ai-sources'].includes(key))],'unknown-gw-catalogue-option');
      // Matches compile.ts:80. Nested file references retain INPUT directory.
      options={...catalogue,...gw,project:{...(catalogue.project??{}),...(gw.project??{})},defaults:{...(catalogue.defaults??{}),...(gw.defaults??{})}};
    }
    if(options['graph-prerequisites']!==false){
      if(!object(kgPrerequisites)||kgPrerequisites.version!==1||Object.hasOwn(kgPrerequisites,'dependencyDigest'))error('kg-prerequisite-semantic-context-required');
      const semantic=data(kgPrerequisites);derived.push({kind:'derived-input',path:'derived:kg-public-prerequisites-v1',hash:sha(canonical(semantic))});
    }
    if(options.translations!==undefined&&options.translations!==false){
      const cfg=fields(options.translations,['mode','imports','reviews'],'unsupported-translations');
      for(const path of list(cfg.imports??[],16,'translation-import-budget'))await read(path,{maxBytes:262144});
    }
    if(options['wai-adapt']!==undefined&&options['wai-adapt']!==false){
      const cfg=fields(options['wai-adapt'],['mode','helper','symbols','reviews'],'unsupported-wai-adapt');
      for(const entry of list(cfg.symbols??[],32,'symbol-budget'))await read(mapping(entry,'invalid-symbol').path,{maxBytes:262144});
    }
    if(options.oer!==undefined&&options.oer!==false){
      const cfg=fields(options.oer,['source-consent','files','title','include-runtime'],'unsupported-oer');if(cfg['source-consent']!==true)error('oer-consent-required');
      for(const entry of list(cfg.files,64,'oer-file-budget')){
        mapping(entry,'invalid-oer-file');
        // Native omits these licences before reading the selected file.
        if(typeof entry.licence!=='string')error('invalid-oer-licence');
        if(/^(?:unknown|noassertion|restricted|all rights reserved)$/iu.test(entry.licence))continue;
        await read(entry.path,{base:'.',maxBytes:1024*1024});
      }
    }
    if(options.numbas!==undefined&&options.numbas!==false){
      const items=list(options.numbas,4,'numbas-package-budget');if(!items.length)error('empty-numbas-list');let count=0,total=0;
      for(const item of items){
        const paths=new Set();for(const context of pathContexts??[base]){try{paths.add(localPath(mapping(item,'invalid-numbas-package').path,context));}catch(cause){if(!pathContexts)throw cause;}}
        let present=false;for(const path of paths){
          const entry=await fs.inspect(path,{directory:true,missing:!!pathContexts});
          if(!entry){probes.push({path,kind:'raw-context-tree-absence',hash:sha('absent-companion-tree')});continue;}
          present=true;const tree=await fs.tree(path);count+=tree.rows.length+1;total+=tree.bytes;if(count>512||total>64*1024*1024)error('numbas-page-package-budget');
          for(const row of tree.rows)add(row,'numbas-package-file');trees.push({kind:'numbas-package-tree',path,hash:tree.hash,files:tree.rows.length});
        }
        if(!present)error('all-context-trees-absent');
      }
    }
  });

  const la=active('local-ai-websites','local-ai');
  if(la){
    const manifest=la.manifest===false?null:la.manifest??null;
    if(manifest!==null)await attempt('la-manifest',async()=>{
      const row=await read(manifest,{rootRelative:true,maxBytes:262144});
      if(row.alternatives.length>1)error('ambiguous-raw-manifest-context');
      if(la['publish-assets']===true){
        const receiptPath=posix.join(posix.dirname(row.path),'asset-receipt.json'),receipt=await read(receiptPath,{base:'.',maxBytes:262144});
        const info=JSON.parse(decoder.decode(row.bytes)),value=JSON.parse(decoder.decode(receipt.bytes));
        if(value.version!==1||value.operation!=='explicit-local-preparation')error('invalid-prepared-receipt');
        const resources=list(value.resourceFiles,256,'prepared-resource-budget');
        const expected=new Map([...list(info.runtime?.inventory,256,'invalid-runtime-inventory'),...list(info.models,256,'invalid-model-inventory')].filter(x=>typeof x?.url==='string').map(x=>[x.url.replace(/^\.\//u,''),x.bytes]));
        const seen=new Set();for(const name of resources){
          if(typeof name!=='string'||name.startsWith('.')||name.includes('/.'))error('unsafe-prepared-resource');
          const path=localPath(name,posix.dirname(row.path));if(seen.has(path))error('duplicate-prepared-resource');seen.add(path);
          const stat=await fs.inspect(path);const size=stat.stat.size;
          if(expected.has(name)&&(!Number.isSafeInteger(expected.get(name))||size!==expected.get(name))||!expected.has(name)&&size>262144)error('prepared-resource-size');
          // Presence/size ONLY: retain LA's reviewed existing contract. NEVER
          // hash/open model weights, run inference, or follow a remote URL.
          probes.push({kind:'prepared-resource-presence-size',path,hash:sha(canonical({present:true,bytes:size}))});
        }
        for(const name of expected.keys())if(!seen.has(localPath(name,posix.dirname(row.path))))error('missing-prepared-resource');
      }
    });
  }
  for(const field of ['bibliography','csl'])if(meta[field]!==undefined)await attempt('native-'+field,async()=>{for(const value of Array.isArray(meta[field])?list(meta[field],32,'native-resource-budget'):[meta[field]])await read(value,{rootRelative:true});});
  const dependencies=[...deps.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {version:1,source,safe:reasons.length===0,reasons,dependencies,trees,probes,derived,stats:fs.stats()};
}
