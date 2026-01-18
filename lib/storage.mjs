import { kv } from "@vercel/kv";
import { create_initial_state } from "../game_core.mjs";

const STATE_KEY = "game:state";
const PENDING_KEY = "game:pending_ai";

const memory = {
  state: null,
  pendingAi: null,
};

function hasKvConfig() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function loadStateFromMemory() {
  if (!memory.state) {
    memory.state = create_initial_state();
  }
  return memory.state;
}

export async function getState() {
  if (!hasKvConfig()) {
    return await loadStateFromMemory();
  }
  const state = await kv.get(STATE_KEY);
  if (state) return state;
  const fresh = create_initial_state();
  await kv.set(STATE_KEY, fresh);
  return fresh;
}

export async function saveState(state) {
  if (!hasKvConfig()) {
    memory.state = state;
    return;
  }
  await kv.set(STATE_KEY, state);
}

export async function getPendingAi() {
  if (!hasKvConfig()) return memory.pendingAi;
  return await kv.get(PENDING_KEY);
}

export async function setPendingAi(pendingAi) {
  if (!hasKvConfig()) {
    memory.pendingAi = pendingAi;
    return;
  }
  await kv.set(PENDING_KEY, pendingAi);
}

export async function resetState() {
  const fresh = create_initial_state();
  await saveState(fresh);
  await setPendingAi(null);
  return fresh;
}
