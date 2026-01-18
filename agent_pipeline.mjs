import "dotenv/config";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, StateGraph, END, START } from "@langchain/langgraph";

const MAINTENANCE_ROUND_INTERVAL = 2;
const MAINTENANCE_COST_INCREMENT = 5;

const AgentStateAnnotation = Annotation.Root({
  me: Annotation(),
  round: Annotation(),
  maintenance_fee: Annotation(),
  maintenance_outlook: Annotation(),
  my_money: Annotation(),
  opp_money: Annotation(),
  my_score: Annotation(),
  opp_score: Annotation(),
  last_rounds: Annotation(),
  personality: Annotation(),
  plan: Annotation(),
  final_bid: Annotation(),
  reasons: Annotation(),
});

const OpponentRead = z.object({
  style_label: z.enum(["conservative", "neutral", "aggressive"]),
  aggression: z.number().min(0).max(1),
  tilt: z.number().min(0).max(1),
  volatility: z.number().min(0).max(1),
});

const OpponentBidForecast = z
  .object({
    q10: z.number().int().min(0),
    q25: z.number().int().min(0),
    q50: z.number().int().min(0),
    q75: z.number().int().min(0),
    q90: z.number().int().min(0),
  })
  .superRefine((v, ctx) => {
    if (!(v.q10 <= v.q25 && v.q25 <= v.q50 && v.q50 <= v.q75 && v.q75 <= v.q90)) {
      ctx.addIssue({ code: "custom", message: "Forecast quantiles must be monotonic." });
    }
  });

const BidPlan = z.object({
  intent: z.enum(["save", "bait", "spike", "balanced"]),
  opponent: OpponentRead,
  forecast: OpponentBidForecast,
  bid_min: z.number().int().min(0),
  bid_max: z.number().int().min(0),
  notes: z.array(z.string()).min(1),
});

function clampInt(x, lo, hi) {
  const v = Number.isFinite(Number(x)) ? Math.trunc(Number(x)) : lo;
  return Math.max(lo, Math.min(v, hi));
}

function maintenanceFeeForRound(roundNum, interval = MAINTENANCE_ROUND_INTERVAL, inc = MAINTENANCE_COST_INCREMENT) {
  const multiplier = Math.max(0, Math.floor((roundNum - 1) / interval));
  return multiplier * inc;
}

function thinkNode(llm) {
  const planner = llm.withStructuredOutput(BidPlan);

  return async (s) => {
    const reasons = s.reasons ?? [];
    const outlook = s.maintenance_outlook ?? {};

    const prompt = `
You are an adaptive bidding agent in a repeated sealed-bid all-pay auction with maintenance and walkover.

Key facts (do not forget):
- All-pay: BOTH pay bids; ONLY higher bid scores +1; tie scores 0.
- Money never increases; it only decreases.
- Maintenance is paid BEFORE bidding each round; if you cannot pay it, you are eliminated and walkover occurs.
- Therefore: preserving liquidity to keep paying maintenance can be worth more than winning a single round.

Objective:
Maximize FINAL score under rising maintenance + limited capital.

Cold-start prior (when data is sparse):
Assume opponent median bid is 10-20% of their bankroll, not 0.

This round:
round=${s.round}
maintenance_fee_paid_this_round=${s.maintenance_fee}
maintenance_outlook_next=${JSON.stringify(outlook)}
my_money=${s.my_money} opp_money=${s.opp_money}
my_score=${s.my_score} opp_score=${s.opp_score}
personality=${s.personality}

Recent rounds (most recent last):
${JSON.stringify(s.last_rounds ?? [])}

Output requirements:
- forecast quantiles must be monotonic: q10<=q25<=q50<=q75<=q90
- forecast quantiles are integers in [0, opp_money]
- bid_min/bid_max are integers in [0, my_money] with bid_min<=bid_max
- Do NOT output [0, my_money] unless personality is chaotic.
- Early-game guidance: unless intentionally "spike", keep bid_max <= 40% of my_money.
- If next_round maintenance is unaffordable regardless, choose intent="spike" and spend to maximize points now.
- notes: 3-6 short bullets, actionable.
`.trim();

    const plan = await planner.invoke(prompt);

    reasons.push(`Intent: ${plan.intent} | Personality: ${s.personality}`);
    reasons.push(
      `Opponent read: ${plan.opponent.style_label} (aggr=${plan.opponent.aggression.toFixed(
        2
      )}, tilt=${plan.opponent.tilt.toFixed(2)}, vol=${plan.opponent.volatility.toFixed(2)})`
    );
    reasons.push(
      `Forecast q25/q50/q75: ${plan.forecast.q25}/${plan.forecast.q50}/${plan.forecast.q75} (opp money=${s.opp_money})`
    );
    reasons.push(...plan.notes.slice(0, 6));

    return { ...s, plan, reasons };
  };
}

async function finalizeNode(s) {
  const reasons = s.reasons ?? [];
  const myMoney = s.my_money;
  const oppMoney = s.opp_money;

  const plan = s.plan ?? { intent: "balanced", bid_min: 0, bid_max: 0, forecast: {} };
  const intent = String(plan.intent ?? "balanced");

  const nextFee = Number(s.maintenance_outlook?.next_round ?? 0);
  const doomedNext = nextFee > myMoney;

  const spendable = doomedNext ? myMoney : Math.max(0, myMoney - nextFee);

  reasons.push(
    doomedNext
      ? `Guardrail: next maintenance $${nextFee} is unaffordable -> SPIKE mode (spend now).`
      : `Guardrail: reserved next maintenance $${nextFee}, spendable=${spendable}.`
  );

  let bidMin = clampInt(plan.bid_min, 0, spendable);
  let bidMax = clampInt(plan.bid_max, 0, spendable);
  if (bidMax < bidMin) bidMax = bidMin;

  const finalBid =
    bidMax > bidMin ? bidMin + Math.floor(Math.random() * (bidMax - bidMin + 1)) : bidMin;

  const forecast = { ...(plan.forecast ?? {}) };
  for (const k of ["q10", "q25", "q50", "q75", "q90"]) {
    if (forecast[k] !== undefined) forecast[k] = clampInt(forecast[k], 0, oppMoney);
  }

  reasons.push(`LLM range [${bidMin},${bidMax}] -> final bid $${finalBid} (intent=${intent})`);

  return { ...s, plan: { ...plan, forecast }, final_bid: clampInt(finalBid, 0, myMoney), reasons };
}

export function buildPipeline(model = "gpt-4o-mini") {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set. Put it in your .env file.");

  const llm = new ChatOpenAI({ model, apiKey, temperature: 0.2 });

  const g = new StateGraph(AgentStateAnnotation)
    .addNode("think", thinkNode(llm))
    .addNode("finalize", finalizeNode)
    .addEdge(START, "think")
    .addEdge("think", "finalize")
    .addEdge("finalize", END);

  return g.compile();
}

export async function chooseBid(
  graph,
  state,
  me,
  personality = "neutral",
  lookback = 6,
  maintenanceInterval = MAINTENANCE_ROUND_INTERVAL,
  maintenanceIncrement = MAINTENANCE_COST_INCREMENT
) {
  const my = me === "PLAYER" ? state.player : state.ai;
  const opp = me === "PLAYER" ? state.ai : state.player;

  const history = state.history.slice(-lookback).map((r) => ({
    round: r.round,
    player_bid: r.player_bid,
    ai_bid: r.ai_bid,
    winner: r.winner,
    fee: r.maintenance_fee_of_round,
    p_after: r.p_money_after_b,
    a_after: r.a_money_after_b,
  }));

  const r = Number(state.current_round);
  const outlook = {
    next_round: maintenanceFeeForRound(r + 1, maintenanceInterval, maintenanceIncrement),
    in_2_rounds: maintenanceFeeForRound(r + 2, maintenanceInterval, maintenanceIncrement),
    in_3_rounds: maintenanceFeeForRound(r + 3, maintenanceInterval, maintenanceIncrement),
  };

  const agentState = {
    me,
    round: r,
    maintenance_fee: Number(state.maintenance_fee_current),
    maintenance_outlook: outlook,
    my_money: Number(my.money),
    opp_money: Number(opp.money),
    my_score: Number(my.score),
    opp_score: Number(opp.score),
    last_rounds: history,
    personality,
    reasons: [],
  };

  const result = await graph.invoke(agentState);
  const rawReasons = result.reasons ?? [];
  const filtered = rawReasons.filter((r) => {
    const lower = String(r).toLowerCase();
    if (lower.startsWith("intent:")) return false;
    if (lower.startsWith("opponent read:")) return false;
    if (lower.startsWith("forecast")) return false;
    if (lower.startsWith("guardrail:")) return false;
    if (lower.includes("llm range")) return false;
    if (lower.includes("personality")) return false;
    return true;
  });
  return [Number(result.final_bid ?? 0), filtered];
}

export async function generateReport(context, model = "gpt-4o-mini") {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set; check your environment or .env file.");
  }

  const llm = new ChatOpenAI({ model, apiKey, temperature: 0.2 });

  const prompt = `
You are a concise game analyst. Review the structured game summary and produce a formatted capital profile block (text-only).
Use finance analogies (maintenance = inflation/carry; bids = position sizing; cash = liquidity; score = returns).
Use ASCII only.

Include exactly these sections/labels:

Your Capital Profile:
Risk Posture: <descriptor>
Capital Efficiency: <descriptor>
Emotional Discipline: <descriptor>
Liquidity Management: <descriptor>
Adaptability: <descriptor>

Overall Archetype:
<archetype name>

Key Takeaway:
<one or two sentences>

Player Suggestions:
- <bullet 1>
- <bullet 2>
- <bullet 3>

Game context:
${JSON.stringify(context)}
`.trim();

  const resp = await llm.invoke(prompt);
  return typeof resp.content === "string" ? resp.content : JSON.stringify(resp.content);
}
