// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Explicit private history inspection; never restores a public generation.
import { STATE, fail } from './core.ts';
import { privatePath } from './private-path.ts';
import { historicalReceipt, verifiedHistoricalSnapshot, selectHistoricalSnapshot, historicalHtml, HISTORY_LIMITS } from './historical.ts';
type Value = Record<string, any>;
const HELP = `Knowledge Graph Extraction private history
quarto run <installed-path>/history.ts list
quarto run <installed-path>/history.ts view --snapshot SHA256 [--receipt SHA256] [--graph GRAPH-ID]

list verifies private receipt contexts without writing. One semantic snapshot can
have several source/dependency contexts; each manifest hash is a separate receipt.
view --snapshot selects the newest fully verified recorded capture date; undated
legacy receipts sort last. Equal-date ties use receipt hash, not inferred chronology.
Use --receipt with a listed manifest receipt hash to select that exact context.
Damaged receipts are never selected; list reports them as unavailable.

view writes a self-contained report under .quarto/knowledge-graph/history, in a
separate directory for the snapshot and receipt. Open its HTML in a browser/editor.
No server or author JS is needed. Old generations without a receipt are unverified
and cannot be viewed. This never restores public output, labels old facts current
or authorises their publication. Dates and hashes do not authenticate the author.
`;
const args = [...Deno.args], command = args.shift();
if (!command || command === '--help' || command === 'help') { console.log(HELP); Deno.exit(0); }
if (!['list', 'view'].includes(command)) fail('history: use list or view');
const options: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!['--snapshot', '--receipt', '--graph'].includes(key) || Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--')) fail('history: unsupported, duplicate or missing option');
  options[key] = args[++i];
}
if (command === 'list' && Object.keys(options).length) fail('history: list accepts no options');
if (command === 'view' && !/^[a-f0-9]{64}$/.test(options['--snapshot'] ?? '')) fail('history: view requires a SHA-256 snapshot identity');
if (options['--receipt'] && !/^[a-f0-9]{64}$/.test(options['--receipt'])) fail('history: receipt requires a SHA-256 manifest identity');
if (options['--graph'] && !/^[a-z][a-z0-9-]{0,63}$/.test(options['--graph'])) fail('history: invalid graph identity');
const root = await Deno.realPath(Deno.cwd()), base = `${STATE}/public/generations`;
type Location = { directory: string; receiptHash?: string };

/** New receipts have their own immutable directory. The legacy direct receipt
 * remains readable in place; neither enumeration nor viewing migrates it. */
async function locations(snapshotId: string, requested?: string): Promise<Location[]> {
  const result: Location[] = [], directory = `${base}/${snapshotId}`;
  try { await Deno.lstat(await privatePath(root, `${directory}/receipt.json`)); result.push({ directory }); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  if (requested) {
    try { await Deno.lstat(await privatePath(root, `${directory}/receipts/${requested}/receipt.json`)); result.push({ directory: `${directory}/receipts/${requested}`, receiptHash: requested }); }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
    return result;
  }
  try {
    for await (const entry of Deno.readDir(await privatePath(root, `${directory}/receipts`))) {
      if (entry.isSymlink || !entry.isDirectory || !/^[a-f0-9]{64}$/.test(entry.name)) fail('history: unexpected private receipt path');
      result.push({ directory: `${directory}/receipts/${entry.name}`, receiptHash: entry.name });
      if (result.length > 200) fail('history: over 200 receipt contexts; select an exact receipt with view');
    }
  } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  return result.sort((a, b) => (a.receiptHash ?? '') < (b.receiptHash ?? '') ? -1 : (a.receiptHash ?? '') > (b.receiptHash ?? '') ? 1 : 0);
}
async function load(snapshotId: string, location: Location) {
  const receiptPath = await privatePath(root, `${location.directory}/receipt.json`), info = await Deno.lstat(receiptPath);
  if (!info.isFile || info.isSymlink || info.size > HISTORY_LIMITS.receiptBytes) fail('history: receipt requires a bounded regular file');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await Deno.readFile(receiptPath))); }
  catch { fail('history: receipt is not valid UTF-8 JSON; inspect private history before retrying'); }
  const receipt = historicalReceipt(value);
  if (receipt.manifest.snapshotId !== snapshotId || location.receiptHash !== undefined && (receipt.cacheVersion !== 1 || receipt.manifestHash !== location.receiptHash)
      || location.receiptHash === undefined && receipt.cacheVersion !== 0) fail('history: receipt identity disagrees with its directory');
  return await verifiedHistoricalSnapshot(receipt, async name => {
    const path = await privatePath(root, `${location.directory}/${name}`), info = await Deno.lstat(path);
    if (!info.isFile || info.isSymlink || info.size > HISTORY_LIMITS.artifactBytes) fail('history: artifact requires a bounded regular file');
    return await Deno.readFile(path);
  });
}

if (command === 'list') {
  const rows: Value[] = []; let directory: string;
  try { directory = await privatePath(root, base); await Deno.stat(directory); }
  catch (error) { if (error instanceof Deno.errors.NotFound) { console.log(JSON.stringify({ historicalVersion: 1, scope: 'private-not-current', snapshots: [] }, null, 2)); Deno.exit(0); } throw error; }
  const ids: string[] = [];
  for await (const entry of Deno.readDir(directory!)) {
    if (entry.isSymlink || !entry.isDirectory || !/^[a-f0-9]{64}$/.test(entry.name)) fail('history: unexpected private generation path');
    ids.push(entry.name); if (ids.length > 200) fail('history: over 200 generations; inspect an exact snapshot with view instead');
  }
  for (const id of ids.sort()) {
    const contexts = await locations(id), verified: Value[] = [], unavailable: Value[] = [];
    if (!contexts.length) unavailable.push({ snapshotId: id, receiptHash: null, verified: false, status: 'unreceipted-or-incomplete', viewAvailable: false });
    for (const location of contexts) {
      try { const s = await load(id, location); verified.push(s); }
      catch (error) { unavailable.push({ snapshotId: id, receiptHash: location.receiptHash ?? null, verified: false,
        status: error instanceof Deno.errors.NotFound ? 'unreceipted-or-incomplete' : 'damaged-or-incompatible', viewAvailable: false }); }
    }
    const preferred = verified.length ? selectHistoricalSnapshot(verified).receiptHash : null;
    // Reuse the documented comparator; a hash tie-break is never a time claim.
    while (verified.length) {
      const s = selectHistoricalSnapshot(verified); verified.splice(verified.indexOf(s), 1);
      rows.push({ snapshotId: id, receiptHash: s.receiptHash, dependencyDigest: s.dependencyDigest, receiptVersion: s.receiptVersion,
        verified: true, status: s.status, capturedAt: s.capturedAt, selectedBySnapshot: s.receiptHash === preferred,
        graphs: s.graphs.map((g: Value) => ({ id: g.id, status: g.graph.status, objects: g.graph.objects.length, relations: g.graph.relations.length })) });
    }
    rows.push(...unavailable);
  }
  console.log(JSON.stringify({ historicalVersion: 1, scope: 'private-not-current',
    ordering: 'snapshot identity; newest verified recorded capture first, undated legacy last; receipt hash breaks equal-date ties',
    selection: 'view --snapshot selects selectedBySnapshot; --receipt selects an exact listed manifest receipt', snapshots: rows }, null, 2));
} else {
  const snapshotId = options['--snapshot'], requested = options['--receipt'];
  const contexts = await locations(snapshotId, requested);
  const verified: Value[] = []; let rejected = 0;
  for (const location of contexts) { try { verified.push(await load(snapshotId, location)); } catch { rejected++; } }
  if (!verified.length) fail('history: no fully verified receipt is available for the selected snapshot/context');
  const snapshot = selectHistoricalSnapshot(verified, requested), html = historicalHtml(snapshot, options['--graph']);
  const folder = `${STATE}/history/${snapshot.snapshotId}/${snapshot.receiptHash}`;
  await Deno.mkdir(await privatePath(root, folder), { recursive: true });
  const name = options['--graph'] ? 'graph-' + options['--graph'] : 'all-graphs';
  const path = await privatePath(root, `${folder}/${name}.html`), pending = await privatePath(root, `${folder}/${name}.${crypto.randomUUID()}.pending`);
  try { await Deno.writeTextFile(pending, html, { createNew: true }); await Deno.rename(pending, path); }
  finally { try { await Deno.remove(pending); } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; } }
  if (rejected) console.log(`Historical receipt contexts that failed verification were skipped: ${rejected}. Use list to inspect their status.`);
  console.log(`Private historical view (not current, not for publication); receipt ${snapshot.receiptHash}: ${path}`);
}
