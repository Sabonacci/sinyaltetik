const axios = require('axios')
const express = require('express')

const {
  RSI,
  PSAR,
  StochasticRSI,
  WMA
} = require('technicalindicators')

const app = express()

// ─────────────────────────────
// ENV
// ─────────────────────────────

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js'
const TELEGRAM_CHAT_ID = '-1003975259428'

// ─────────────────────────────
// WATCHLIST
// ─────────────────────────────

const HISSELER = [
  'THYAO.IS','ASELS.IS','TUPRS.IS','SASA.IS','ASTOR.IS',
  'YEOTK.IS','GESAN.IS','EUPWR.IS','LOGO.IS'
]

const COINLER = [
  'BTC-USD','ETH-USD','SOL-USD','XRP-USD','ADA-USD'
]

// tekrar sinyal engeli
const lastSignalPrice = {}

// ─────────────────────────────
// TELEGRAM
// ─────────────────────────────

async function sendTelegram(msg) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: msg,
        parse_mode: 'HTML'
      }
    )
  } catch (e) {
    console.log("Telegram hata:", e.message)
  }
}

// ─────────────────────────────
// YAHOO 4H DATA
// ─────────────────────────────

async function fetchYahoo(symbol) {
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=4h&range=3mo`

    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })

    const r = res.data.chart.result?.[0]
    if (!r) return null

    const q = r.indicators.quote?.[0]
    if (!q) return null

    const data = q.close.map((c, i) => ({
      close: q.close[i],
      high: q.high[i],
      low: q.low[i],
      open: q.open[i],
      volume: q.volume?.[i] || 0
    })).filter(x =>
      x.close !== null &&
      x.high !== null &&
      x.low !== null &&
      x.open !== null
    )

    return {
      closes: data.map(x => Number(x.close)),
      highs: data.map(x => Number(x.high)),
      lows: data.map(x => Number(x.low)),
      opens: data.map(x => Number(x.open)),
      volumes: data.map(x => Number(x.volume))
    }

  } catch (e) {
    console.log(symbol, e.message)
    return null
  }
}

// ─────────────────────────────
// HULL MA
// ─────────────────────────────

function hullMA(values, period = 9) {
  const half = Math.floor(period / 2)
  const sqrt = Math.floor(Math.sqrt(period))

  const wmaHalf = WMA.calculate({ period: half, values })
  const wmaFull = WMA.calculate({ period, values })

  const diff = []

  const offset = wmaHalf.length - wmaFull.length

  for (let i = 0; i < wmaFull.length; i++) {
    diff.push(2 * wmaHalf[i + offset] - wmaFull[i])
  }

  return WMA.calculate({ period: sqrt, values: diff })
}

// ─────────────────────────────
// CMF
// ─────────────────────────────

function cmf(highs, lows, closes, volumes, period = 20) {
  const result = []

  for (let i = period; i < closes.length; i++) {
    let mfvSum = 0
    let volSum = 0

    for (let j = i - period; j < i; j++) {
      const high = highs[j]
      const low = lows[j]
      const close = closes[j]
      const vol = volumes[j]

      const mfm = ((close - low) - (high - close)) / (high - low || 1)
      const mfv = mfm * vol

      mfvSum += mfv
      volSum += vol
    }

    result.push(volSum === 0 ? 0 : mfvSum / volSum)
  }

  return result
}

// ─────────────────────────────
// ICHIMOKU BASE
// ─────────────────────────────

function ichimokuBase(highs, lows, period = 26) {
  const res = []

  for (let i = period; i < highs.length; i++) {
    const h = Math.max(...highs.slice(i - period, i))
    const l = Math.min(...lows.slice(i - period, i))
    res.push((h + l) / 2)
  }

  return res
}

// ─────────────────────────────
// PIVOT
// ─────────────────────────────

function pivot(high, low, close) {
  return (high + low + close) / 3
}

// ─────────────────────────────
// MAIN SIGNAL
// ─────────────────────────────

async function sinyal(symbol, data, para) {
  if (!data) return
  if (data.closes.length < 50) return

  const n = data.closes.length - 1

  const close = data.closes[n]
  const open = data.opens[n]
  const high = data.highs[n]
  const low = data.lows[n]

  // RSI
  const rsi14 = RSI.calculate({ values: data.closes, period: 14 }).at(-1)
  const rsi7  = RSI.calculate({ values: data.closes, period: 7 }).at(-1)

  // SAR
  const sar = PSAR.calculate({
    high: data.highs,
    low: data.lows,
    step: 0.02,
    max: 0.2
  }).at(-1)

  // CMF
  const cmfVal = cmf(
    data.highs,
    data.lows,
    data.closes,
    data.volumes,
    20
  ).at(-1)

  // Hull
  const hull = hullMA(data.closes, 9).at(-1)

  // Stoch RSI
  const stoch = StochasticRSI.calculate({
    values: data.closes,
    rsiPeriod: 14,
    stochasticPeriod: 14,
    kPeriod: 3,
    dPeriod: 3
  }).at(-1)

  const k = stoch?.k
  const d = stoch?.d

  // Ichimoku
  const kijun = ichimokuBase(data.highs, data.lows, 26).at(-1)

  // Pivot
  const pivotVal = pivot(
    data.highs[n - 1],
    data.lows[n - 1],
    data.closes[n - 1]
  )

  // ─────────────────────────────
  // ŞARTLAR
  // ─────────────────────────────

  const signal =
    rsi14 >= 45 && rsi14 <= 65 &&
    rsi7 <= 70 &&
    sar < close &&
    cmfVal >= -0.2 && cmfVal <= 0.3 &&
    hull < close &&
    close > open &&
    k > d &&
    kijun < close &&
    pivotVal < close

  if (!signal) return

  // tekrar sinyal engeli
  if (lastSignalPrice[symbol] === close) return
  lastSignalPrice[symbol] = close

  const name = symbol.replace('.IS', '').replace('-USD', '')

  const msg = `
🟢 <b>4H STRONG BUY</b>

📊 ${name}

💰 Fiyat: ${close.toFixed(4)} ${para}

📈 RSI14: ${rsi14.toFixed(2)}
⚡ RSI7: ${rsi7.toFixed(2)}
💵 CMF: ${cmfVal.toFixed(3)}

📊 Stoch RSI: K > D
☁️ Ichimoku: OK
📌 Pivot üstü
📉 Hull altı kırıldı
🟢 SAR destek

🕐 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}
`

  await sendTelegram(msg)

  console.log("AL:", name)
}

// ─────────────────────────────
// LOOP
// ─────────────────────────────

async function run() {
  console.log("tarama başladı")

  for (const s of HISSELER) {
    const d = await fetchYahoo(s)
    await sinyal(s, d, "₺")
  }

  for (const s of COINLER) {
    const d = await fetchYahoo(s)
    await sinyal(s, d, "$")
  }

  console.log("tarama bitti")
}

// ─────────────────────────────
// EXPRESS
// ─────────────────────────────

app.get("/", (req, res) => {
  res.send("Bot OK")
})

app.get("/test", async (req, res) => {
  await sendTelegram("TEST OK")
  res.send("ok")
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log("server başladı", PORT)

  run()
  setInterval(run, 15 * 60 * 1000)
})
