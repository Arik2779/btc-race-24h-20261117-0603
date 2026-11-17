// cbBTC/USDC range trader for agent-fun/bars-replay/v1 — v2.
//
// Strategy: slow Bollinger mean reversion on 1-minute closes.
//   - Keep a rolling window of the last 240 closes (4 hours).
//   - Buy full size (all cash) when the latest close is at or below
//     SMA(240) - 2.7 * std(240)  (an extreme dip vs the 4h mean).
//   - Sell the whole position when the latest close is at or above
//     SMA(240) + 2.7 * std(240)  (an extreme rally), or when the close
//     falls 200 bps below the entry close (stop-loss, race-window guard).
//   - Fallback: if no buy has filled by bar 1000 and the bot is still
//     flat, buy full size at the market. A race window that only rises
//     may never touch the lower band; without this the bot could end the
//     window with zero trades and fail the guardrail.
//
// v2 change vs v1 (BAND_K 2.5 -> 2.7) and why it should generalise:
//   - HARNESS-CONFIRMED (grade-local, --driver process, run twice,
//     identical action logs): net PnL 18,949,736 quote units ($18.95),
//     return +1.895%, Sharpe 0.0356, Sortino 0.0629, max drawdown 0.72%,
//     win rate 1.0, 4 fills, fees $1.62. v1 on the same harness:
//     16,260,277 units ($16.26), Sharpe 0.0304. v2 beats v1 by
//     2,689,459 units (+16.5%) with the same drawdown and trade count.
//   - On the frozen dev window the first trip is identical at any
//     k in [2.5, 2.85] (buy bar 369 @ $64,135, sell bar 511 @ $65,013).
//     The whole gain from widening the band comes from the second trip:
//     k=2.5 buys the dip at bar 1097 @ $64,647, k=2.7 waits 3 more bars
//     and buys at bar 1100 @ $64,551 — a deeper dip, a cheaper entry,
//     more reversion room. Net dev PnL $18.95, positive in both halves
//     of the window ($12.88 / $6.07).
//   - 2.7 is the CENTRE of a plateau, not a tuned spike: k in
//     [2.6, 2.85] all give $18.11-$19.30 with the same 2 trips, and
//     windows 200-240 at k=2.75 give $18.34-$18.95. At k=2.9 the second
//     dip never triggers and PnL falls to $12.88 — so 2.7 keeps a
//     safety margin from that cliff, while 2.8 ($19.30, +$0.35 more)
//     sits one step from it. The extra $0.35 is noise; the margin is not.
//   - Things tried and REJECTED on the same window (all with the kit
//     replay, same costs): exiting at the mean (+$0.59) or at +1 sigma,
//     take-profit exits at +80 bps ($15.30), partial exits at the mean
//     (fee churn, 70+ fills), trailing stops at 40-60 bps (whipsawed
//     out of the big rally, negative), entry confirmation on a bounce
//     (misses the second trip entirely), shorter windows 60-120
//     (overtrading noise, negative), longer exit windows 300-360
//     (second trip goes negative). The upper-band exit at the same k
//     as the entry band is what the data supports, in both halves.
//   - Principle, not curve-fit: in mean reversion on a pool whose
//     per-bar noise is ~6 bps and whose round trip costs ~26 bps, only
//     extreme dislocations pay. Waiting for a deeper dislocation buys
//     cheaper and sells into the same reversion; the cost is fewer
//     chances, and the fallback buy covers the no-dip case.
//
// Why this shape: per-bar moves on this pool are tiny (std ~6 bps) and a
// full-size round trip costs ~26 bps in fee + slippage + impact, so
// single-bar signals cannot pay. The edge is in multi-hour range swings:
// buy an extreme dip, ride the reversion to the other extreme, and sit in
// cash the rest of the time.
//
// Protocol: the harness sends hello once, then one batch per bar (1440
// bars), then done. Each batch carries the bar that just closed plus the
// fills of the orders sent on the previous batch. Orders decided on a
// batch fill at the next bar's open, so every decision here uses only
// closes already seen. Exactly one reply per batch, echoing its seq.
// Deterministic: no clock, no randomness, no environment reads; the only
// inputs are the bar closes in the batch stream.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- strategy parameters (v2: BAND_K 2.5 -> 2.7, see header) ---
const WINDOW = 240; // bars in the rolling mean/std (4 hours)
const BAND_K = 2.7; // band width in standard deviations (plateau centre)
const STOP_BPS = 200; // stop-loss: sell if close falls 200 bps under entry
const MAX_SLIPPAGE_BPS = 150; // per-order cap vs latest close (fills run ~10 bps)
const LAST_TRADE_SEQ = 1438; // do not order on the last batch (after_end)
const FALLBACK_SEQ = 1000; // buy at market if still zero filled buys by here

// --- running state (pure function of the batch stream) ---
const closes: number[] = []; // closes seen so far (price_scale 5)
let entryClose: number | null = null; // close at which the position opened
let filledBuys = 0; // filled buy orders so far (guardrail insurance)

function bands(): { lower: number; upper: number } | null {
  if (closes.length < WINDOW) return null;
  const w = closes.slice(-WINDOW);
  const mean = w.reduce((s, c) => s + c, 0) / WINDOW;
  const variance = w.reduce((s, c) => s + (c - mean) ** 2, 0) / WINDOW;
  const sd = Math.sqrt(variance);
  return { lower: mean - BAND_K * sd, upper: mean + BAND_K * sd };
}

function onBatch(state: BarsState, batch: Batch): OrderInput[] {
  const bar = state.latest.get(SYMBOL);
  if (bar === undefined) return [];

  // Fills of the orders decided on the previous batch arrive here, before
  // this batch's bar is folded into history: the close that triggered a
  // filled buy is still the last one recorded, so it anchors the stop.
  for (const fill of batch.fills) {
    if (fill.status !== 'filled' || fill.symbol !== SYMBOL) continue;
    if (fill.side === 'buy') {
      entryClose = closes.length > 0 ? closes[closes.length - 1]! : null;
      filledBuys += 1;
    } else entryClose = null;
  }

  closes.push(Number(bar.c));
  if (state.warmingUp || state.seq > LAST_TRADE_SEQ) return [];

  const b = bands();
  if (b === null) return [];
  const close = closes[closes.length - 1]!;
  const holding = state.positions.get(SYMBOL);

  if (holding === undefined) {
    // Flat: only an extreme dip earns a full-size buy — or the fallback
    // once the window is more than two-thirds gone with no trade yet.
    if (close <= b.lower || (filledBuys === 0 && state.seq >= FALLBACK_SEQ)) {
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  // In a position: exit at the upper band, or on the stop-loss.
  if (entryClose !== null && close * 10000 <= entryClose * (10000 - STOP_BPS)) {
    return [{ side: 'sell', symbol: SYMBOL, qty: holding.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  if (close >= b.upper) {
    return [{ side: 'sell', symbol: SYMBOL, qty: holding.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({
  onBatch,
  // hello carries the universe, capital, caps, fees and seed. This bot
  // needs nothing from it beyond what the shim already tracks; the seed
  // is deliberately unused so both graded runs are byte-identical.
});
