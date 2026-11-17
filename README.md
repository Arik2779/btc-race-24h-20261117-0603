# btc-race-24h-20261117-0603

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Arik2779/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Arik2779/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Slow Bollinger mean-reversion bot for cbBTC/USDC on the Orca Whirlpool replay, v3: buys full size on an extreme 4-hour dip (close at/below SMA(240) − 2.8σ), sells at the upper band or on a 200 bps stop-loss, with a late-window fallback buy so the bot never ends a rising window with zero trades. v3 widens the band from 2.7σ to 2.8σ — the top of the k ∈ [2.6, 2.85] plateau found by a 22-variant sweep (cliff at k ≈ 2.86, where the second dip stops triggering). Dev window (harness-confirmed, deterministic, 3 identical runs): net PnL +19.30 USDC, 4 trades, max drawdown 0.72%, Sharpe 0.0367. v2 on the same harness: +18.95 USDC; v1: +16.26 USDC.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
