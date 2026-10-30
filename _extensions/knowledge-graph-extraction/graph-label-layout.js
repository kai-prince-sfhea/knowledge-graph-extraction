// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Original bounded screen-space presentation only: no force or graph mutation.
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('und', {granularity:'grapheme'}) : null;
const fail = () => { throw new Error('knowledge-graph-extraction: invalid graph label layout'); };
function number(value, min, max) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(); return value; }
function text(value, maximum) { if (typeof value !== 'string' || value.length > maximum || !value.isWellFormed()) fail(); return value; }
function literal(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail();
  for (const key of Reflect.ownKeys(value)) if (typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')) fail();
  return value;
}
function graphemes(value) {
  // At most72 clusters are displayed; one extra establishes truncation without
  // segmenting a maximum-size source title on every animation frame.
  if (segmenter) { const result=[];for(const item of segmenter.segment(value)){result.push(item.segment);if(result.length===73)break;}return result; }
  // Conservatively keep marks, variation selectors and joiner sequences with
  // their preceding character on engines without Intl.Segmenter.
  const result=[]; let joined=false, regional=0;
  for (const part of Array.from(value)) {
    const mark=/[\p{Mark}\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u{1F3FB}-\u{1F3FF}]/u.test(part), flag=/\p{Regional_Indicator}/u.test(part);
    if (result.length && (mark || joined || part==='\u200d' || flag && regional%2===1)) result[result.length-1]+=part;
    else result.push(part);
    joined=part==='\u200d'; regional=flag?regional+1:0;
    if(result.length>73)break;
  }
  return result;
}
const intersects=(a,b)=>a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Place measured labels without changing world positions, zoom or graph state.
 * nodes: <=120 {id,label,x,y,radius} records, all coordinates already in pixels.
 * measureText(text,node): actual width at the fixed 13px screen font/weight.
 * x/y in each visible result are text-left and baseline screen coordinates.
 */
export function layoutGraphLabels(nodes, options, measureText) {
  if (!Array.isArray(nodes) || nodes.length>120 || typeof measureText!=='function') fail();
  literal(options,['width','height','selectedId','neighbourIds','inset','scale']);
  const width=number(options.width,1,16384),height=number(options.height,1,16384),inset=number(options.inset??8,0,64),scale=number(options.scale??1,.25,4);
  const selectedId=options.selectedId??null;if(selectedId!==null)text(selectedId,10000);
  const neighbours=options.neighbourIds??[];if(!Array.isArray(neighbours)||neighbours.length>120)fail();
  const neighbourIds=new Set();for(const id of neighbours){text(id,10000);if(neighbourIds.has(id))fail();neighbourIds.add(id);}
  const ids=new Set();
  const values=nodes.map(raw=>{
    literal(raw,['id','label','x','y','radius']);
    const id=text(raw.id,10000);if(!id||ids.has(id))fail();ids.add(id);
    return Object.freeze({id,label:text(raw.label,10000),x:number(raw.x,-10000000,10000000),y:number(raw.y,-10000000,10000000),radius:number(raw.radius,0,500)});
  }).sort((a,b)=>(a.id===selectedId?0:neighbourIds.has(a.id)?1:2)-(b.id===selectedId?0:neighbourIds.has(b.id)?1:2)||compare(a.id,b.id));
  const occupied=[],result=[],padding=3,lineHeight=18,gap=5,innerWidth=width-2*inset,innerHeight=height-2*inset;
  for (const node of values) {
    const base={id:node.id,text:'',visible:false,reason:'collision',truncated:false},priority=node.id===selectedId?0:neighbourIds.has(node.id)?1:2;
    const hide=reason=>result.push(Object.freeze({...base,reason}));
    if(innerWidth<=padding*2 || innerHeight<lineHeight+padding*2){hide('viewport-too-small');continue;}
    if(node.x<0 || node.x>width || node.y<0 || node.y>height){hide('offscreen');continue;}
    if(priority===2 && scale<.45){hide('zoom');continue;}
    const original=node.label.replace(/\s+/gu,' ').trim(),parts=graphemes(original),cache=new Map(),fits=new Map();
    if(!parts.length){hide('empty');continue;}
    const measure=value=>{if(!cache.has(value))cache.set(value,number(measureText(value,node),0,10000000));return cache.get(value);};
    function fit(available) {
      const limit=Math.min(240,available)-padding*2;if(limit<=0)return null;
      if(fits.has(limit))return fits.get(limit);
      const maximum=Math.min(parts.length,72),candidate=count=>parts.slice(0,count).join('')+(count<parts.length?'…':'');
      let count=maximum,value=candidate(count),measured=measure(value);
      if(measured>limit){let low=1,high=maximum-1,best=0;while(low<=high){const middle=Math.floor((low+high)/2);if(measure(candidate(middle))<=limit){best=middle;low=middle+1;}else high=middle-1;}if(!best){fits.set(limit,null);return null;}count=best;value=candidate(count);measured=measure(value);}
      if(measured>limit){fits.set(limit,null);return null;}
      const result={text:value,width:measured+padding*2,height:lineHeight+padding*2,count,truncated:count<parts.length};fits.set(limit,result);return result;
    }
    const right=node.x+node.radius+gap,left=node.x-node.radius-gap;
    const declarations=[
      ['right',width-inset-right,fit=>({left:right,top:clamp(node.y-fit.height/2,inset,height-inset-fit.height)})],
      ['left',left-inset,fit=>({left:left-fit.width,top:clamp(node.y-fit.height/2,inset,height-inset-fit.height)})],
      ['above',innerWidth,fit=>({left:clamp(node.x-fit.width/2,inset,width-inset-fit.width),top:node.y-node.radius-gap-fit.height})],
      ['below',innerWidth,fit=>({left:clamp(node.x-fit.width/2,inset,width-inset-fit.width),top:node.y+node.radius+gap})],
      ['above-right',width-inset-right,fit=>({left:right,top:node.y-node.radius-gap-fit.height})],
      ['below-right',width-inset-right,fit=>({left:right,top:node.y+node.radius+gap})],
      ['above-left',left-inset,fit=>({left:left-fit.width,top:node.y-node.radius-gap-fit.height})],
      ['below-left',left-inset,fit=>({left:left-fit.width,top:node.y+node.radius+gap})]
    ];
    const candidates=[];
    for(const [side,available,position]of declarations){const fitted=fit(available);if(!fitted)continue;const point=position(fitted),box={left:point.left,top:point.top,right:point.left+fitted.width,bottom:point.top+fitted.height};
      if(box.left<inset || box.top<inset || box.right>width-inset || box.bottom>height-inset)continue;
      candidates.push({...fitted,side,box,index:candidates.length});}
    candidates.sort((a,b)=>b.count-a.count||a.index-b.index);
    const chosen=candidates.find(candidate=>!occupied.some(box=>intersects(candidate.box,box)));
    if(!chosen){hide(candidates.length?'collision':'label-too-wide');continue;}
    const box=Object.freeze(chosen.box);occupied.push(box);
    result.push(Object.freeze({id:node.id,text:chosen.text,visible:true,reason:'visible',truncated:chosen.truncated,side:chosen.side,x:box.left+padding,y:box.top+padding+13,box}));
  }
  return Object.freeze(result);
}
