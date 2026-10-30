// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// One authoritative current admission table: companion-cache.ts.
// Historical primary contracts remain separately preserved there.
import {companionPayloads,reviewedCurrentCompanionPayloads,compatibleCompanion as primaryCompatible} from './companion-cache.ts';
export const historicalPayloads=companionPayloads;
export const reviewedCurrentPayloads=reviewedCurrentCompanionPayloads;
export function compatibleProvider(name,version,hash,reviewed=reviewedCurrentPayloads){
  if(!Object.hasOwn(historicalPayloads,name)||typeof version!=='string'||typeof hash!=='string'||!/^[a-f0-9]{64}$/u.test(hash))return false;
  return Object.hasOwn(reviewed,name)&&Array.isArray(reviewed[name])&&reviewed[name].some(pair=>pair&&pair.contract==='current-v1'&&typeof pair.review==='string'&&pair.review.length>0&&pair.version===version&&pair.hash===hash);
}
// Primary admission retains the exact historical contracts; providers require
// a separately reviewed complete current closure.
export function compatibleCompanion(name,version,hash,reviewed=reviewedCurrentPayloads){return primaryCompatible(name,version,hash)||compatibleProvider(name,version,hash,reviewed);}
