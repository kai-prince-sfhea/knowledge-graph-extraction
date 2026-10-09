/** One dependency-free implementation is shared by Node, Deno and browsers. */
export { QUERY_VERSION, recordLabel, createSemanticLabels, query, search, traverse, prerequisites, shortestPath,
  createNavigationState, acceptRoute, beginDetour, returnFromDetour,
  advanceRoute, setKnown, setKnowledge, restoreNavigationState } from "./query.js";
export type Graph = { snapshotId: string; status: "complete" | "incomplete";
  objects: Record<string, any>[]; relations: Record<string, any>[];
  occurrences: Record<string, any>[]; scope: Record<string, any> };
