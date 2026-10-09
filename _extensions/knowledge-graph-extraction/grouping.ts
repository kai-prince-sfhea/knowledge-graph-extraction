/** Stable request-local indexes. Callers validate/project records first; no
 * index is retained across renders and no record or input array is mutated. */
export function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const name = key(value);
    const group = groups.get(name);
    if (group) group.push(value);
    else groups.set(name, [value]);
  }
  return groups;
}
