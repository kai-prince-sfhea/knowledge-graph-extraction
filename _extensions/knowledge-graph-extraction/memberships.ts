// Explicit author membership, not identity inference from labels or URLs.
type Value=Record<string,any>;
const fail=(message:string):never=>{throw new Error('knowledge-graph-extraction: '+message);};
export function memberships(item:Value):string[]{return item.graphIds??[item.graphId??'website'];}
export function inGraph(item:Value,id:string):boolean{return memberships(item).includes(id);}
/** The v1 companion contract uses one graphId per entry, including shared claims. */
export function preparedPrerequisites(project:Value):Value{
  return {version:1,dependencyDigest:project.dependencyDigest,namespaces:project.namespaces,
    objects:project.objects.filter((item:Value)=>item.eligible).flatMap((item:Value)=>memberships(item).map(graphId=>({id:item.id,graphId}))),
    relations:project.relations.filter((item:Value)=>item.eligible&&item.type==='requires').flatMap((item:Value)=>memberships(item).map(graphId=>({from:item.from,to:item.to,graphId,
      ...(item.properties?.['prerequisite-group']?{group:item.properties['prerequisite-group']}:{})}))) };
}
export function parseMemberships(item:Value,known:Set<string>,fallback='website'):{graphId:string;graphIds?:string[]}{
  const values=item.graphs===undefined?[item.graph??fallback]:item.graphs;
  if(!Array.isArray(values)||!values.length||values.length>64||new Set(values).size!==values.length
    ||values.some((id:unknown)=>typeof id!=='string'||!known.has(id)))fail('graph membership requires distinct declared graph ids');
  const graphIds=[...values].sort(),graphId=item.graph??(item.graphs===undefined?fallback:graphIds[0]);
  if(!graphIds.includes(graphId))fail('primary graph must be one of the explicit graph memberships');
  return {graphId,...(item.graphs===undefined?{}:{graphIds})};
}
export function parseRelationMemberships(item:Value,from:Value,to:Value,known:Set<string>){
  const result=parseMemberships(item,known,from.graphId??'website');
  if(memberships(result).some(id=>!inGraph(from,id)||!inGraph(to,id)))fail('a relation needs public endpoints sharing its explicit graph membership; declare a shared membership instead of silently crossing graphs');
  return result;
}
