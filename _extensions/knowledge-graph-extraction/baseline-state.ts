import { fail, readJson, STATE } from './core.ts';
import { privatePath } from './private-path.ts';

export async function importedBaseline(root: string): Promise<Record<string, any> | null> {
  let value;
  try { value = await readJson(await privatePath(root, STATE + '/baselines/imported.json')); }
  catch (error) { if (error instanceof Deno.errors.NotFound) return null; throw error; }
  if (!value || value.bundleVersion !== 0 || typeof value.fullFrozenRenderRequired !== 'boolean'
      || !['bundleHash','snapshotId','dependencyDigest'].every(key => /^[a-f0-9]{64}$/.test(value[key] ?? ''))) {
    fail('invalid imported baseline receipt; inspect private baseline state before continuing');
  }
  return value;
}

export async function requireImportedBaselineRender(root: string, mode: string, fullFresh: boolean): Promise<void> {
  if (mode === 'frozen' && (await importedBaseline(root))?.fullFrozenRenderRequired && !fullFresh) {
    fail('imported baseline requires a complete fresh native frozen render; partial and cache-only builds cannot validate it');
  }
}
