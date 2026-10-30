/** Pure federation of already public, anchor-verified graph projections. Source
 * observation, publication policy and optional navigator assets remain owned
 * by the coordinator; this module never reads declarations or private state. */
export { buildFederation, qualifiedFederationId } from "./federation.js";
