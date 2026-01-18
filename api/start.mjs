import { getState, saveState, setPendingAi } from "../lib/storage.mjs";
import { refreshPrediction } from "../lib/game_service.mjs";
import { sendJson } from "../lib/http.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const state = await getState();
  const pending = await refreshPrediction(state).catch(() => null);
  await saveState(state);
  await setPendingAi(pending);
  return sendJson(res, 200, { ok: true, state });
}
