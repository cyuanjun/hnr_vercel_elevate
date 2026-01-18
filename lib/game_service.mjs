import { build_report_context, play_round, predict_ai_bid } from "../game_core.mjs";
import { generateReport } from "../agent_pipeline.mjs";
import { getGraph } from "./runtime.mjs";

export async function refreshPrediction(state) {
  const graph = await getGraph();
  const res = await predict_ai_bid(state, graph);
  if (!res) return null;
  const [bid, reasons] = res;
  return { bid, reasons };
}

export async function handleBid(state, bid, pendingAi) {
  const graph = await getGraph();
  const outcome = await play_round(state, bid, graph, pendingAi);
  let report = null;
  if (outcome.status === "ended") {
    report = await generateReport(build_report_context(state));
  }
  let nextPending = null;
  if (outcome.status === "ok") {
    try {
      nextPending = await refreshPrediction(state);
    } catch {
      nextPending = null;
    }
  }
  return { outcome, report, state, nextPending };
}
