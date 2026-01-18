import { chooseBid } from "./agent_pipeline.mjs";

export const STARTING_AMT = 100;
const MAINTENANCE_ROUND_INTERVAL = 2;
const MAINTENANCE_COST_INCREMENT = 5;

export class PlayerState {
  constructor(name, money, score = 0) {
    this.name = name;
    this.money = money;
    this.score = score;
  }
}

export class RoundRecord {
  constructor(
    round,
    player_bid,
    ai_bid,
    winner,
    maintenance_fee_of_round,
    p_score,
    p_money_before_m,
    p_money_before_b,
    p_money_after_b,
    a_score,
    a_money_before_m,
    a_money_before_b,
    a_money_after_b
  ) {
    this.round = round;
    this.player_bid = player_bid;
    this.ai_bid = ai_bid;
    this.winner = winner;
    this.maintenance_fee_of_round = maintenance_fee_of_round;
    this.p_score = p_score;
    this.p_money_before_m = p_money_before_m;
    this.p_money_before_b = p_money_before_b;
    this.p_money_after_b = p_money_after_b;
    this.a_score = a_score;
    this.a_money_before_m = a_money_before_m;
    this.a_money_before_b = a_money_before_b;
    this.a_money_after_b = a_money_after_b;
  }
}

export class GameState {
  constructor(starting_money, current_round, maintenance_fee_current, player, ai, history = []) {
    this.starting_money = starting_money;
    this.current_round = current_round;
    this.maintenance_fee_current = maintenance_fee_current;
    this.player = player;
    this.ai = ai;
    this.history = history;
  }
}

function calculate_maintenance_fee(roundNum) {
  const multiplier = Math.max(0, Math.floor((roundNum - 1) / MAINTENANCE_ROUND_INTERVAL));
  return multiplier * MAINTENANCE_COST_INCREMENT;
}

function apply_maintenance_fee(state, player, ai) {
  const fee = state.maintenance_fee_current;
  if (player.money < fee || ai.money < fee) return false;
  player.money -= fee;
  ai.money -= fee;
  return true;
}

function round_winner(player_bid, ai_bid) {
  if (player_bid > ai_bid) return "PLAYER";
  if (ai_bid > player_bid) return "AI";
  return null;
}

function apply_payment(player, ai, player_bid, ai_bid) {
  player.money = Math.max(0, player.money - player_bid);
  ai.money = Math.max(0, ai.money - ai_bid);
}

function award_point(player, ai, winner) {
  if (winner === "PLAYER") player.score += 1;
  if (winner === "AI") ai.score += 1;
}

function walkover(bankrupt, state, start_from_next_round = false) {
  let round_num = start_from_next_round ? state.current_round + 1 : state.current_round;

  while (true) {
    if (bankrupt === "TIE") return;

    const p_money_before_m = state.player.money;
    const a_money_before_m = state.ai.money;

    state.maintenance_fee_current = calculate_maintenance_fee(round_num);

    let winner = null;
    if (bankrupt === "PLAYER") {
      if (state.maintenance_fee_current <= state.ai.money) {
        winner = "AI";
        state.ai.score += 1;
        state.ai.money -= state.maintenance_fee_current;
      } else {
        return;
      }
    } else if (bankrupt === "AI") {
      if (state.maintenance_fee_current <= state.player.money) {
        winner = "PLAYER";
        state.player.score += 1;
        state.player.money -= state.maintenance_fee_current;
      } else {
        return;
      }
    }

    const rec = new RoundRecord(
      state.current_round,
      0,
      0,
      winner,
      state.maintenance_fee_current,
      state.player.score,
      p_money_before_m,
      state.player.money,
      state.player.money,
      state.ai.score,
      a_money_before_m,
      state.ai.money,
      state.ai.money
    );

    state.history.push(rec);
    state.current_round = round_num;
    round_num += 1;
  }
}

function avg(nums) {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function build_report_context(state) {
  const history = state.history;
  const rounds = history.length;

  const player_wins = history.filter((r) => r.winner === "PLAYER").length;
  const ai_wins = history.filter((r) => r.winner === "AI").length;
  const ties = rounds - player_wins - ai_wins;

  const player_bids = [];
  const ai_bids = [];

  let maintenance_total = 0;

  for (const rec of history) {
    player_bids.push(rec.player_bid);
    ai_bids.push(rec.ai_bid);
    maintenance_total += rec.maintenance_fee_of_round;
  }

  const player_total = player_bids.reduce((a, b) => a + b, 0);
  const ai_total = ai_bids.reduce((a, b) => a + b, 0);

  const player_max = player_bids.length > 0 ? Math.max(...player_bids) : 0;
  const ai_max = ai_bids.length > 0 ? Math.max(...ai_bids) : 0;

  return {
    rounds: rounds,
    scores: { player: state.player.score, ai: state.ai.score },
    money_final: { player: state.player.money, ai: state.ai.money },
    wins: { player: player_wins, ai: ai_wins, ties: ties },
    bids: {
      player_avg: avg(player_bids),
      ai_avg: avg(ai_bids),
      player_max: player_max,
      ai_max: ai_max,
      player_total: player_total,
      ai_total: ai_total,
    },
    maintenance_total_paid: maintenance_total,
    history: history.map((r) => ({
      round: r.round,
      player_bid: r.player_bid,
      ai_bid: r.ai_bid,
      winner: r.winner,
      maintenance_fee: r.maintenance_fee_of_round,
      p_money_after: r.p_money_after_b,
      a_money_after: r.a_money_after_b,
    })),
  };
}

export function create_initial_state() {
  return new GameState(
    STARTING_AMT,
    1,
    0,
    new PlayerState("PLAYER", STARTING_AMT),
    new PlayerState("AI", STARTING_AMT),
    []
  );
}

export async function play_round(state, player_bid, graph, aiOverride = null) {
  const p_money_before_m = state.player.money;
  const a_money_before_m = state.ai.money;

  const m_fee = calculate_maintenance_fee(state.current_round);
  state.maintenance_fee_current = m_fee;

  const ok = apply_maintenance_fee(state, state.player, state.ai);

  const p_money_before_b = state.player.money;
  const a_money_before_b = state.ai.money;

  if (!ok) {
    if (p_money_before_m < m_fee && a_money_before_m < m_fee) {
      return { status: "ended", message: "Both players could not afford maintenance fees." };
    }
    if (p_money_before_m < m_fee) {
      walkover("PLAYER", state);
      return { status: "ended", message: "PLAYER could not afford maintenance fees." };
    }
    walkover("AI", state);
    return { status: "ended", message: "AI could not afford maintenance fees." };
  }

  const p_bid = Math.max(0, Math.min(player_bid, p_money_before_b));

  let a_bid = 0;
  let desc = [];
  if (aiOverride && Number.isFinite(aiOverride.bid)) {
    a_bid = Number(aiOverride.bid);
    desc = Array.isArray(aiOverride.reasons) ? aiOverride.reasons : [];
  } else {
    [a_bid, desc] = await chooseBid(graph, state, "AI");
  }
  a_bid = Math.max(0, Math.min(a_bid, a_money_before_b));

  const winner = round_winner(p_bid, a_bid);
  apply_payment(state.player, state.ai, p_bid, a_bid);
  award_point(state.player, state.ai, winner);

  const rec = new RoundRecord(
    state.current_round,
    p_bid,
    a_bid,
    winner,
    state.maintenance_fee_current,
    state.player.score,
    p_money_before_m,
    p_money_before_b,
    state.player.money,
    state.ai.score,
    a_money_before_m,
    a_money_before_b,
    state.ai.money
  );

  state.history.push(rec);

  if (state.player.money === 0 && state.ai.money === 0) {
    state.current_round += 1;
    return { status: "ended", message: "Both players hit $0.", round: rec, aiReasons: desc };
  }
  if (state.player.money === 0) {
    walkover("PLAYER", state, true);
    state.current_round += 1;
    return { status: "ended", message: "PLAYER hit $0.", round: rec, aiReasons: desc };
  }
  if (state.ai.money === 0) {
    walkover("AI", state, true);
    state.current_round += 1;
    return { status: "ended", message: "AI hit $0.", round: rec, aiReasons: desc };
  }

  state.current_round += 1;
  return { status: "ok", round: rec, aiReasons: desc };
}

export async function predict_ai_bid(state, graph) {
  const clone = JSON.parse(JSON.stringify(state));
  const m_fee = calculate_maintenance_fee(clone.current_round);
  clone.maintenance_fee_current = m_fee;
  const ok = apply_maintenance_fee(clone, clone.player, clone.ai);
  if (!ok) return null;
  return await chooseBid(graph, clone, "AI");
}
