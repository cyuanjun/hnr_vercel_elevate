import { readJson, sendJson } from "../lib/http.mjs";
import { getPendingAi, getState, saveState, setPendingAi } from "../lib/storage.mjs";
import { handleBid } from "../lib/game_service.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  let payload = {};
  try {
    payload = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON." });
  }

  const state = await getState();
  const bid = Number(payload.bid);
  if (!Number.isFinite(bid) || bid < 0 || bid > state.player.money) {
    return sendJson(res, 400, { error: `Bid must be between 0 and ${state.player.money}.` });
  }

  const pendingAi = await getPendingAi();
  const { outcome, report, state: nextState, nextPending } = await handleBid(state, bid, pendingAi);
  await saveState(nextState);
  await setPendingAi(nextPending);

  return sendJson(res, 200, {
    outcome,
    state: nextState,
    report,
  });
}
