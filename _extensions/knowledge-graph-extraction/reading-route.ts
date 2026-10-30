/** Data-only markup and current public assets; no model or author-written JS. */
import { validateReadingRouteConfig } from './reading-route.js';
export * from './reading-route.js';
export function parseReadingOptions(value: unknown = {}) {
  const fail = (): never => { throw new Error('knowledge-graph-extraction: reading requires enabled and bounded local activity declarations'); };
  if (value === false) return {enabled:false,activities:[]};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const input=value as Record<string,unknown>;
  if(Object.keys(input).some(key=>!['enabled','activities'].includes(key)) || input.enabled!==undefined&&typeof input.enabled!=='boolean') fail();
  const activities=input.activities ?? [];
  if(!Array.isArray(activities)||activities.length>64) fail();
  const ids=new Set();
  const parsed=(activities as unknown[]).map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))fail();
    const item=raw as Record<string,unknown>;
    if(Object.keys(item).some(key=>!['id','label','url'].includes(key))||typeof item.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(item.id)||['constructor','prototype'].includes(item.id)||ids.has(item.id)||typeof item.label!=='string'||!item.label.trim()||item.label!==item.label.trim()||item.label.length>256||/[\u0000-\u001f\u007f]/.test(item.label)||typeof item.url!=='string'||!item.url||item.url.length>8192||item.url!==item.url.trim())fail();
    ids.add(item.id);
    let decoded:string;try{decoded=decodeURIComponent(item.url as string);}catch{fail();}
    const path=decoded.split('#')[0];
    if(/^(?:\/|[A-Za-z][A-Za-z0-9+.-]*:)/.test(decoded)||/[\\\u0000-\u001f\u007f]/.test(decoded)||/[?]/.test(path)||/\s/.test((item.url as string).split('#')[0])||/%(?:25)*(?:2f|5c)/i.test(item.url as string)||/%(?:25)*(?:2e|2f|5c|3a|00)/i.test(decoded)||!path.toLowerCase().match(/\.html?$/)||path.split('/').some(segment=>!segment||segment==='.'||segment==='..'||['.quarto','.git','_extensions'].includes(segment.toLowerCase())))fail();
    return {id:item.id as string,label:item.label as string,url:item.url as string};
  });
  return {enabled:input.enabled!==false,activities:parsed};
}
export function buildReadingRouteAssets(config: unknown, options: { assetPrefix?: string; baseUrl?: string } = {}) {
  const prefix = options.assetPrefix ?? './';
  if (!/^(?:\.\/|(?:\.\.\/)*)(?:[A-Za-z0-9._~-]+\/)*$/.test(prefix)) throw new Error('knowledge-graph-extraction: invalid reading-route asset prefix');
  const serialized = JSON.stringify(config);
  if (!serialized || serialized.length > 1_000_000) throw new Error('knowledge-graph-extraction: reading-route configuration exceeds its bound');
  validateReadingRouteConfig(config,options.baseUrl ?? 'https://reading-route.invalid/index.html');
  const escape = (value:string) => value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return { config, markup: `<script type="application/json" data-kg-reading-config>${serialized.replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029')}</script>\n<script type="module" src="${escape(prefix + 'reading-route.js')}" data-kg-reading-asset></script>`,
    assets: ['reading-route.js', 'query.js'].map(name => ({name,source:new URL(name,import.meta.url)})) };
}
