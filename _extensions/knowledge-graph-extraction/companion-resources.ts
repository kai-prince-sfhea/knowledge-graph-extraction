// Revalidate LA's bounded resource-presence/size contract without reading model
// weights or repeating inference. Browser model hashes remain LA's responsibility.
import {confined,projectPath,readJson} from './core.ts';
import {dirname,join} from 'stdlib/path';
export async function preparedResourcesValid(root:string,manifestPath:string):Promise<boolean>{
  try{
    const read=async(path:string)=>{const file=await confined(root,path);if((await Deno.stat(file)).size>262144)throw new Error();return await readJson(file);};
    const manifest=await read(manifestPath),base=dirname(manifestPath),receipt=await read(join(base,'asset-receipt.json').replaceAll('\\','/'));
    if(receipt.version!==1||receipt.operation!=='explicit-local-preparation'||!Array.isArray(receipt.resourceFiles)||receipt.resourceFiles.length<1||receipt.resourceFiles.length>256
      ||!Array.isArray(manifest.runtime?.inventory)||!Array.isArray(manifest.models))return false;
    const expected=new Map<string,number>();
    for(const item of [...manifest.runtime.inventory,...manifest.models])if(typeof item?.url==='string')expected.set(item.url.replace(/^\.\//,''),item.bytes);
    const seen=new Set<string>();
    for(const name of receipt.resourceFiles){
      if(typeof name!=='string'||name.length>2048||/[\\:?#%<>"'\s\u0000-\u001f]/.test(name)||name.split('/').some(part=>!part||part.startsWith('.'))||seen.has(name))return false;
      seen.add(name);let path=base;
      for(const part of projectPath(name).split('/')){path=join(path,part).replaceAll('\\','/');if((await Deno.lstat(await confined(root,path))).isSymlink)return false;}
      const stat=await Deno.stat(await confined(root,path));if(!stat.isFile)return false;
      if(expected.has(name)){const bytes=expected.get(name)!;if(!Number.isSafeInteger(bytes)||bytes<0||stat.size!==bytes)return false;}
      else if(stat.size>262144)return false;
    }
    return [...expected.keys()].every(name=>seen.has(name));
  }catch{return false;}
}
