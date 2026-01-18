import { getState } from "../lib/storage.mjs";
import { sendJson } from "../lib/http.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const state = await getState();
  return sendJson(res, 200, { state });
}
