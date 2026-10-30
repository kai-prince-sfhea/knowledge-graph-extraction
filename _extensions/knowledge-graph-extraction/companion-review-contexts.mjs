// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Conservative context union; no per-document inspect/render subprocesses.
import {posix} from 'node:path';
import {collectCompanionDependencies,copyMetadata,createObservationSession} from './companion-review-collector.mjs';
import {canonical,sha,localPath} from './companion-review-files.mjs';

/** All relevant contexts MUST be supplied by core's EXISTING metadata visits:
 * root/profile config, directory metadata, metadata-files, source frontmatter,
 * applicable format maps, and literal includes. Contexts are NOT merged here.
 * This intentionally over-approximates enabled flags, inherited values and
 * plausible rebasing bases. A missing alternate is an absence probe; differing
 * parsed catalogues or ambiguous manifests cause source-local fresh-AST fallback.
 * No claim is made that an isolated raw map is effective native metadata.
 */
export async function collectCompanionContextUnion({contexts,...options}){
  contexts=copyMetadata(contexts);
  if(!Array.isArray(contexts)||!contexts.length||contexts.length>64)throw Error('bounded-complete-context-inventory-required');
  const inputDirectory=posix.dirname(localPath(options.sourcePath)),bases=new Set([inputDirectory]);
  for(const row of contexts){if(!row||typeof row!=='object'||typeof row.directory!=='string'||!row.metadata||typeof row.metadata!=='object'||Array.isArray(row.metadata))throw Error('invalid-raw-metadata-context');if(row.directory!=='.')localPath(row.directory);bases.add(row.directory);}
  if(bases.size>8)return {version:1,source:options.sourcePath,safe:false,reasons:[{scope:'source',code:'path-context-budget',feature:'raw-metadata-union'}],dependencies:[],trees:[],probes:[],derived:[],stats:{files:0,bytes:0}};
  const maps=contexts.map(({metadata})=>copyMetadata(metadata)),synthetic={};
  // Disabled flags may override elsewhere. Including declared inputs even when
  // a raw map says false over-hashes safely without executing the transform.
  for(const metadata of maps)for(const name of ['accessible-maths','maths-knowledge-graph','interactive-cv','generative-websites','local-ai'])if(metadata[name]&&typeof metadata[name]==='object'&&!Array.isArray(metadata[name]))delete metadata[name].enabled;
  // These cross-namespace/split-map switches can enable additional I/O. Cover
  // every declaration rather than inventing an effective merge precedence.
  if(maps.some(meta=>meta['accessible-maths']?.catalogue===true)){
    synthetic['accessible-maths']={catalogue:true};synthetic['maths-knowledge-graph']={'import-accessible-maths':true};
  }
  if(maps.some(meta=>meta['local-ai']?.['publish-assets']===true))for(const meta of maps)if(meta['local-ai']?.manifest&&meta['local-ai'].manifest!==false)meta['local-ai']['publish-assets']=true;
  if(Object.keys(synthetic).length)maps.push(synthetic);
  const observationSession=options.observationSession??await createObservationSession(options.root),results=[];
  for(const metadata of maps)results.push(await collectCompanionDependencies({...options,metadata,pathContexts:[...bases],observationSession}));
  const merge=field=>{const entries=new Map();for(const result of results)for(const row of result[field]){const key=field==='reasons'?canonical(row):`${row.kind}\n${row.path}`;const prior=entries.get(key);if(prior&&prior.hash!==row.hash)throw Error('raw-context-observation-changed');entries.set(key,row);}return [...entries.values()].sort((a,b)=>canonical(a)<canonical(b)?-1:canonical(a)>canonical(b)?1:0);};
  const dependencies=new Map();for(const result of results)for(const row of result.dependencies){const prior=dependencies.get(row.path);if(prior&&prior.hash!==row.hash)throw Error('raw-context-observation-changed');dependencies.set(row.path,row);}
  const reasons=merge('reasons');
  return {version:1,source:options.sourcePath,safe:reasons.length===0,reasons,dependencies:[...dependencies.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),trees:merge('trees'),probes:merge('probes'),derived:merge('derived'),stats:observationSession.fs.stats(),contextEvidence:{mode:'conservative-raw-context-union',contexts:contexts.length,bases:[...bases],hash:sha(canonical(contexts.map(row=>({directory:row.directory,metadata:row.metadata}))))}};
}
