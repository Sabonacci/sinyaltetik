const axios = require('axios')
const express = require('express')
const app = express()

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js'
const TELEGRAM_CHAT_ID = '-1003975259428'

const HISSELER = [
  'ECILC.IS','SUWEN.IS','PEKGY.IS','LMKDC.IS','TRENJ.IS',
  'GESAN.IS','EUPWR.IS','MAKIM.IS','ARENA.IS','PATEK.IS'
]

const COINLER = [
  'BTCUSDT','XRPUSDT','DASHUSDT','SOLUSDT',
  'ETHUSDT','ETHFIUSDT','POLUSDT'
]

const durum = {}
;[...HISSELER, ...COINLER].forEach(h => {
  durum[h] = {
    lastSignal: 0,
    alBar:      null,
    alPrice:    null
  }
})

// ── Yardımcı fonksiyonlar ─────────────────────────────────────────────────────

function wma(arr, len) {
  if (arr.length < len) return null
  const slice = arr.slice(-len)
  let num = 0, den = 0
  for (let i = 0; i < len; i++) {
    num += slice[i] * (i + 1)
    den += (i + 1)
  }
  return num / den
}

function emaArr(arr, len) {
  if (arr.length === 0) return []
  const k = 2 / (len + 1)
  const result = [arr[0]]
  for (let i = 1; i < arr.length; i++) {
    result.push(arr[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

function calcMAVW(closes, fmal, smal) {
  const tmal  = fmal + smal
  const Fmal  = smal + tmal
  const Ftmal = tmal + Fmal
  const Smal  = Fmal + Ftmal

  const wmaStep = (arr, len) => {
    const out = []
    for (let i = 0; i < arr.length; i++) {
      const slice = arr.slice(0, i + 1)
      const w = wma(slice, len)
      out.push(w !== null ? w : arr[i])
    }
    return out
  }

  let m = closes
  m = wmaStep(m, fmal)
  m = wmaStep(m, smal)
  m = wmaStep(m, tmal)
  m = wmaStep(m, Fmal)
  m = wmaStep(m, Ftmal)
  m = wmaStep(m, Smal)
  return m
}

function calcT3(closes, period, b) {
  const c1 = -b*b*b
  const c2 =  3*b*b + 3*b*b*b
  const c3 = -6*b*b - 3*b - 3*b*b*b
  const c4 =  1 + 3*b + b*b*b + 3*b*b

  const e1 = emaArr(closes, period)
  const e2 = emaArr(e1, period)
  const e3 = emaArr(e2, period)
  const e4 = emaArr(e3, period)
  const e5 = emaArr(e4, period)
  const e6 = emaArr(e5, period)

  return e6.map((_, i) =>
    c1*e6[i] + c2*e5[i] + c3*e4[i] + c4*e3[i]
  )
}

// ── Yahoo Finance veri çek (BIST) ─────────────────────────────────────────────

async function fetchYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=5d`
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const closes = res.data.chart.result[0].indicators.quote[0].close
    return closes.filter(c => c !== null && c !== undefined).map(c => parseFloat(c.toFixed(4)))
  } catch (err) {
    console.error(`${symbol} veri hatası: ${err.message}`)
    return null
  }
}

// ── Binance veri çek (Coin) ───────────────────────────────────────────────────

async function fetchBinance(symbol) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=200`
    const res = await axios.get(url)
    return res.data.map(k => parseFloat(k[4])) // kapanış fiyatı
  } catch (err) {
    console.error(`${symbol} veri hatası: ${err.message}`)
    return null
  }
}

// ── Telegram mesaj gönder ─────────────────────────────────────────────────────

async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id:    TELEGRAM_CHAT_ID,
      text:       msg,
      parse_mode: 'HTML'
    })
  } catch (err) {
    console.error('Telegram hatası:', err.message)
  }
}

// ── Sinyal motoru (ortak) ─────────────────────────────────────────────────────

async function sinyalKontrol(sembol, closes, para) {
  if (!closes || closes.length < 50) {
    console.log(`${sembol} | Yetersiz veri`)
    return
  }

  const d      = durum[sembol]
  const mavw   = calcMAVW(closes, 3, 5)
  const t3     = calcT3(closes, 7, 0.7)
  const n      = closes.length - 1

  const t3Son    = t3[n]
  const t3Prev   = t3[n - 1]
  const t3Prev2  = t3[n - 2]
  const mavwSon  = mavw[n]
  const mavwPrev = mavw[n - 1]
  const closeSon = closes[n]

  const mavwKirmizi = mavwSon < mavwPrev
  const t3K2Y = t3Son > t3Prev && t3Prev <= t3Prev2
  const t3Y2K = t3Son < t3Prev && t3Prev >= t3Prev2

  const ema5Val  = emaArr(closes, 5)[n]
  const ema7Val  = emaArr(closes, 7)[n]
  const ema10Val = emaArr(closes, 10)[n]
  const ema13Val = emaArr(closes, 13)[n]

  const alSart = t3K2Y && t3Son < mavwSon && mavwKirmizi

  let activeEma = null
  if (d.lastSignal === 1 && d.alBar !== null) {
    const barsFromAl = n - d.alBar
    if      (barsFromAl === 1) activeEma = ema5Val
    else if (barsFromAl === 2) activeEma = ema7Val
    else if (barsFromAl === 3) activeEma = ema7Val
    else if (barsFromAl === 4) activeEma = ema10Val
    else                       activeEma = ema13Val
  }

  const satSart = d.lastSignal === 1 && activeEma !== null && closeSon < activeEma

  const saat = new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})
  const ad   = sembol.replace('.IS', '').replace('USDT', '')

  // AL sinyali
  if (alSart && d.lastSignal !== 1) {
    d.lastSignal = 1
    d.alBar      = n
    d.alPrice    = closeSon

    await sendTelegram(
      `🟢 <b>AL — ${ad}</b>\n` +
      `💰 Fiyat: ${closeSon.toFixed(4)} ${para}\n` +
      `📊 T3: ${t3Son.toFixed(4)} | MAVW: ${mavwSon.toFixed(4)}\n` +
      `🕐 ${saat}`
    )
    console.log(`✅ AL: ${sembol} @ ${closeSon}`)
  }

  // SAT sinyali
  if (satSart && d.lastSignal !== -1) {
    const period = n - d.alBar
    const pct    = ((closeSon - d.alPrice) / d.alPrice * 100).toFixed(2)
    const emoji  = parseFloat(pct) >= 0 ? '📈' : '📉'

    d.lastSignal = -1

    await sendTelegram(
      `🔴 <b>SAT — ${ad}</b>\n` +
      `💰 Fiyat: ${closeSon.toFixed(4)} ${para}\n` +
      `⏱ Periyot: ${period} bar\n` +
      `${emoji} Kar/Zarar: %${pct}\n` +
      `🕐 ${saat}`
    )
    console.log(`🔴 SAT: ${sembol} @ ${closeSon} | ${period} bar | %${pct}`)
  }
}

// ── Ana kontrol döngüsü ───────────────────────────────────────────────────────

async function kontrolEt() {
  const saat = new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})
  console.log(`[${saat}] Kontrol başladı...`)

  // BIST hisseleri
  for (const sembol of HISSELER) {
    const closes = await fetchYahoo(sembol)
    await sinyalKontrol(sembol, closes, '₺')
  }

  // Coinler
  for (const sembol of COINLER) {
    const closes = await fetchBinance(sembol)
    await sinyalKontrol(sembol, '$')
  }

  console.log(`[${new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})}] Kontrol bitti.`)
}

// ── Sunucu ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.send('Sinyal botu çalışıyor ✅'))

app.get('/test', async (req, res) => {
  await sendTelegram('🧪 <b>Test mesajı</b>\nBot çalışıyor ✅')
  res.send('Telegram mesajı gönderildi')
})

app.listen(3000, () => {
  console.log('Sunucu başladı')
  kontrolEt()
  setInterval(kontrolEt, 5 * 60 * 1000)
})
