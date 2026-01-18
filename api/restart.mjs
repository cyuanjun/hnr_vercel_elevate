import { resetState } from "../lib/storage.mjs";
import { sendJson } from "../lib/http.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const state = await resetState();
  return sendJson(res, 200, { ok: true, state });
}
