import { buildPipeline } from "../agent_pipeline.mjs";

let graphPromise = null;

export function getGraph() {
  if (!graphPromise) {
    graphPromise = Promise.resolve().then(() => buildPipeline());
  }
  return graphPromise;
}
