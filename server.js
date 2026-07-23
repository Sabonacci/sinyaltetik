const axios   = require('axios')
const express = require('express')
const fs      = require('fs')
const app     = express()

// Telegram'dan gelen Webhook isteklerini (JSON) okuyabilmek için şarttır
app.use(express.json())

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js'
const TELEGRAM_CHAT_ID = '5756145019

// Sadece istenen 3 hisse
const HISSELER = [
  'EREGL.IS', 'ARFYE.IS', 'ARDYZ.IS'
]

const DOSYA = '/tmp/islemler.json'

function islemleriYukle() {
  try {
    if (fs.existsSync(DOSYA)) return JSON.parse(fs.readFileSync(DOSYA, 'utf8'))
  } catch(e) {}
  return []
}

function islemleriKaydet() {
  try { fs.writeFileSync(DOSYA, JSON.stringify(gunlukIslemler)) } catch(e) {}
}

var gunlukIslemler = islemleriYukle()

const durum = {}
HISSELER.forEach(h => {
  durum[h] = {
    lastSignalTime: 0
  }
})

// ── İndikatör Hesaplamaları ──────────────────────────────────────────────────

function rsiArr(closes, period) {
  if (closes.length < period + 1) return []
  const rsi = new Array(closes.length).fill(null)
  let gains = 0, losses = 0

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses += Math.abs(diff)
  }

  let avgGain = gains / period
  let avgLoss = losses / period
  rsi[period] = 100 - (100 / (1 + (avgGain / (avgLoss || 1))))

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    rsi[i] = 100 - (100 / (1 + rs))
  }
  return rsi
}

function wmaArr(arr, len) {
  const result = new Array(arr.length).fill(null)
  const norm = (len * (len + 1)) / 2
  for (let i = len - 1; i < arr.length; i++) {
    let sum = 0
    let hasNull = false
    for (let j = 0; j < len; j++) {
      if (arr[i - j] === null || arr[i - j] === undefined) {
        hasNull = true
        break
      }
      sum += arr[i - j] * (len - j)
    }
    result[i] = hasNull ? null : sum / norm
  }
  return result
}

function hmaArr(arr, len) {
  const halfLen = Math.floor(len / 2)
  const sqrtLen = Math.round(Math.sqrt(len))
  
  const wmaHalf = wmaArr(arr, halfLen)
  const wmaFull = wmaArr(arr, len)
  
  const rawHma = arr.map((_, i) => {
    if (wmaHalf[i] === null || wmaFull[i] === null) return null
    return 2 * wmaHalf[i] - wmaFull[i]
  })

  return wmaArr(rawHma, sqrtLen)
}

function smaArr(arr, len) {
  const result = []
  for (let i = 0; i < arr.length; i++) {
    if (i < len - 1) { result.push(null); continue }
    const slice = arr.slice(i - len + 1, i + 1)
    if (slice.includes(null)) { result.push(null); continue }
    const sum = slice.reduce((a, b) => a + b, 0)
    result.push(sum / len)
  }
  return result
}

function stochRsiArr(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
  const rsi = rsiArr(closes, rsiPeriod)
  const stochRsi = new Array(closes.length).fill(null)

  for (let i = rsiPeriod + stochPeriod - 1; i < closes.length; i++) {
    const slice = rsi.slice(i - stochPeriod + 1, i + 1)
    const minRsi = Math.min(...slice)
    const maxRsi = Math.max(...slice)
    stochRsi[i] = maxRsi === minRsi ? 0 : ((rsi[i] - minRsi) / (maxRsi - minRsi)) * 100
  }

  const validStoch = stochRsi.filter(v => v !== null)
  const smaK = smaArr(validStoch, kSmooth)
  const smaD = smaArr(smaK.filter(v => v !== null), dSmooth)

  const K = new Array(closes.length).fill(null)
  const D = new Array(closes.length).fill(null)

  let idxK = 0, idxD = 0
  for (let i = 0; i < closes.length; i++) {
    if (stochRsi[i] !== null) {
      K[i] = smaK[idxK]
      idxK++
    }
  }
  for (let i = 0; i < closes.length; i++) {
    if (K[i] !== null && K[i] !== undefined) {
      D[i] = smaD[idxD]
      idxD++
    }
  }
  return { K, D }
}

function cmfArr(highs, lows, closes, volumes, period = 20) {
  const mfVolume = closes.map((c, i) => {
    const range = highs[i] - lows[i]
    if (range === 0) return 0
    return (((c - lows[i]) - (highs[i] - c)) / range) * volumes[i]
  })

  const cmf = new Array(closes.length).fill(null)
  for (let i = period - 1; i < closes.length; i++) {
    const sumMfv = mfVolume.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    const sumVol = volumes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    cmf[i] = sumVol === 0 ? 0 : sumMfv / sumVol
  }
  return cmf
}

function psarArr(highs, lows, closes, step = 0.02, maxStep = 0.2) {
  const n = closes.length
  const psar = new Array(n).fill(null)
  if (n < 2) return psar

  let isUp = closes[1] >= closes[0]
  let af = step
  let ep = isUp ? highs[0] : lows[0]
  psar[0] = isUp ? lows[0] : highs[0]

  for (let i = 1; i < n; i++) {
    psar[i] = psar[i - 1] + af * (ep - psar[i - 1])

    if (isUp) {
      if (i >= 2) psar[i] = Math.min(psar[i], lows[i - 1], lows[i - 2])
      else psar[i] = Math.min(psar[i], lows[i - 1])

      if (lows[i] < psar[i]) {
        isUp = false
        psar[i] = ep
        ep = lows[i]
        af = step
      } else {
        if (highs[i] > ep) {
          ep = highs[i]
          af = Math.min(af + step, maxStep)
        }
      }
    } else {
      if (i >= 2) psar[i] = Math.max(psar[i], highs[i - 1], highs[i - 2])
      else psar[i] = Math.max(psar[i], highs[i - 1])

      if (highs[i] > psar[i]) {
        isUp = true
        psar[i] = ep
        ep = highs[i]
        af = step
      } else {
        if (lows[i] < ep) {
          ep = lows[i]
          af = Math.min(af + step, maxStep)
        }
      }
    }
  }
  return psar
}

function ichimokuBaseLine(highs, lows, period = 26) {
  const baseLine = new Array(highs.length).fill(null)
  for (let i = period - 1; i < highs.length; i++) {
    const hSlice = highs.slice(i - period + 1, i + 1)
    const lSlice = lows.slice(i - period + 1, i + 1)
    baseLine[i] = (Math.max(...hSlice) + Math.min(...lSlice)) / 2
  }
  return baseLine
}

// ── Veri Çekme ───────────────────────────────────────────────────────────────

async function fetchYahooDaily(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const result = res.data.chart.result[0]
    const q = result.indicators.quote[0]
    
    const raw = q.close.map((c, i) => ({
      c: c, o: q.open[i], h: q.high[i], l: q.low[i], v: q.volume[i]
    })).filter(x => x.c != null && x.o != null && x.h != null && x.l != null && x.v != null)

    return {
      closes: raw.map(x => parseFloat(x.c.toFixed(4))),
      opens:  raw.map(x => parseFloat(x.o.toFixed(4))),
      highs:  raw.map(x => parseFloat(x.h.toFixed(4))),
      lows:   raw.map(x => parseFloat(x.l.toFixed(4))),
      vols:   raw.map(x => parseFloat(x.v))
    }
  } catch (err) {
    console.error(`${symbol} veri hatası: ${err.message}`)
    return null
  }
}

async function sendTelegram(msg, targetChatId = null) {
  try {
    const chatId = targetChatId || TELEGRAM_CHAT_ID
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId, text: msg, parse_mode: 'HTML'
    })
  } catch (err) { console.error('Telegram hatası:', err.message) }
}

// ── Analiz Verilerini Hesaplama ──────────────────────────────────────────────

async function hisseAnaliziGetir(sembol) {
  const veri = await fetchYahooDaily(sembol)
  if (!veri || veri.closes.length < 35) return null

  const { closes, opens, highs, lows, vols } = veri
  const n = closes.length - 1

  const f = closes[n]
  const o = opens[n]

  const rsi14 = rsiArr(closes, 14)[n]
  const rsi7  = rsiArr(closes, 7)[n]
  const sar   = psarArr(highs, lows, closes)[n]
  const cmf20 = cmfArr(highs, lows, closes, vols, 20)[n]
  const hma9  = hmaArr(closes, 9)[n]

  const stochRsi = stochRsiArr(closes, 14, 14, 3, 3)
  const kSon = stochRsi.K[n]
  const kPrev = stochRsi.K[n - 1]
  const dSon = stochRsi.D[n]
  const dPrev = stochRsi.D[n - 1]

  const baseLine = ichimokuBaseLine(highs, lows, 26)[n]

  const prevHigh = highs[n - 1]
  const prevLow  = lows[n - 1]
  const prevClose = closes[n - 1]
  const pivot = (prevHigh + prevLow + prevClose) / 3

  // Kontroller
  const c1 = rsi14 >= 45 && rsi14 <= 65
  const c2 = rsi7 <= 70
  const c3 = sar < f
  const c4 = cmf20 >= 0.01 && cmf20 <= 0.3
  const c5 = typeof hma9 === 'number' && hma9 < f
  const c6 = f > o
  const c7 = (kPrev <= dPrev) && (kSon > dSon)
  const c8 = baseLine < f
  const c9 = pivot < f

  return {
    sembol: sembol.replace('.IS',''),
    fiyat: f,
    acilis: o,
    rsi14: { val: rsi14, ok: c1 },
    rsi7:  { val: rsi7, ok: c2 },
    sar:   { val: sar, ok: c3 },
    cmf20: { val: cmf20, ok: c4 },
    hma9:  { val: hma9, ok: c5 },
    fiyatAcilis: { ok: c6 },
    stochRsi: { kSon, dSon, ok: c7 },
    baseLine: { val: baseLine, ok: c8 },
    pivot: { val: pivot, ok: c9 },
    hepsiTamam: c1 && c2 && c3 && c4 && c5 && c6 && c7 && c8 && c9
  }
}

// ── Sinyal Motoru ─────────────────────────────────────────────────────────────

async function sinyalKontrol(sembol) {
  const a = await hisseAnaliziGetir(sembol)
  if (!a) return

  if (a.hepsiTamam) {
    const simdi = Date.now()
    if (simdi - durum[sembol].lastSignalTime > 60 * 60 * 1000) {
      durum[sembol].lastSignalTime = simdi

      const msg = 
        `🚀 <b>STRATEJİ SİNYALİ VERDİ: ${a.sembol}</b>\n\n` +
        `💰 <b>Fiyat:</b> ${a.fiyat.toFixed(2)} ₺ (Açılış: ${a.acilis.toFixed(2)})\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ <b>RSI (14):</b> ${a.rsi14.val.toFixed(1)}\n` +
        `✅ <b>RSI (7):</b> ${a.rsi7.val.toFixed(1)}\n` +
        `✅ <b>Parabolic SAR:</b> ${a.sar.val.toFixed(2)} (< Fiyat)\n` +
        `✅ <b>CMF (20):</b> ${a.cmf20.val.toFixed(3)}\n` +
        `✅ <b>Hull MA (9):</b> ${typeof a.hma9.val === 'number' ? a.hma9.val.toFixed(2) : '-'}\n` +
        `✅ <b>Stoch RSI:</b> K (${a.stochRsi.kSon.toFixed(1)}) ▲ D (${a.stochRsi.dSon.toFixed(1)})\n` +
        `✅ <b>Ichimoku Base Line:</b> ${a.baseLine.val.toFixed(2)}\n` +
        `✅ <b>Pivot:</b> ${a.pivot.val.toFixed(2)}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🕐 ${new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})}`

      await sendTelegram(msg)
      console.log(`✅ SİNYAL GÖNDERİLDİ: ${a.sembol}`)
    }
  }
}

async function kontrolEt() {
  const saat = new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})
  console.log(`[${saat}] Kontrol başladı...`)

  for (const sembol of HISSELER) {
    await sinyalKontrol(sembol)
  }

  console.log(`[${new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})}] Kontrol bitti.`)
}

// ── Sunucu ve Telegram Webhook Rotası ────────────────────────────────────────

app.get('/', (req, res) => res.send('Teknik Analiz Botu Çalışıyor ✅'))

// 📩 TELEGRAM'DAN GELEN "test" MESAJLARINI DİNLEYEN SİSTEM
app.post('/webhook', async (req, res) => {
  try {
    const message = req.body?.message
    if (message && message.text) {
      const gelenMetin = message.text.trim().toLowerCase()
      const chatId = message.chat.id

      if (gelenMetin === 'test' || gelenMetin === '/test') {
        let rapor = `🔍 <b>TELEGRAM TEST RAPORU</b>\n🕐 ${new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})}\n\n`

        for (const sembol of HISSELER) {
          const a = await hisseAnaliziGetir(sembol)
          if (!a) continue

          rapor += `📌 <b>${a.sembol}</b> — Fiyat: ${a.fiyat.toFixed(2)} | Açılış: ${a.acilis.toFixed(2)}\n`
          rapor += `${a.rsi14.ok ? '🟢' : '🔴'} RSI(14): ${a.rsi14.val.toFixed(1)} (45-65)\n`
          rapor += `${a.rsi7.ok ? '🟢' : '🔴'} RSI(7): ${a.rsi7.val.toFixed(1)} (<=70)\n`
          rapor += `${a.sar.ok ? '🟢' : '🔴'} SAR: ${a.sar.val.toFixed(2)} (< Fiyat)\n`
          rapor += `${a.cmf20.ok ? '🟢' : '🔴'} CMF(20): ${a.cmf20.val.toFixed(3)} (0.01 - 0.30)\n`
          rapor += `${a.hma9.ok ? '🟢' : '🔴'} Hull MA(9): ${typeof a.hma9.val === 'number' ? a.hma9.val.toFixed(2) : '-'} (< Fiyat)\n`
          rapor += `${a.fiyatAcilis.ok ? '🟢' : '🔴'} Fiyat > Açılış\n`
          rapor += `${a.stochRsi.ok ? '🟢' : '🔴'} Stoch RSI: K(${a.stochRsi.kSon ? a.stochRsi.kSon.toFixed(1) : '-'}) / D(${a.stochRsi.dSon ? a.stochRsi.dSon.toFixed(1) : '-'})\n`
          rapor += `${a.baseLine.ok ? '🟢' : '🔴'} Base Line: ${a.baseLine.val.toFixed(2)} (< Fiyat)\n`
          rapor += `${a.pivot.ok ? '🟢' : '🔴'} Pivot: ${a.pivot.val.toFixed(2)} (< Fiyat)\n`
          rapor += `STATUS: ${a.hepsiTamam ? '🚀 AL SİNYALİ AKTİF' : '⏳ ŞARTLAR TAMAMLANMADI'}\n`
          rapor += `━━━━━━━━━━━━━━━━━━━━\n`
        }

        await sendTelegram(rapor, chatId)
      }
    }
  } catch (err) {
    console.error('Webhook işleme hatası:', err.message)
  }

  res.sendStatus(200)
})

app.listen(3000, () => {
  console.log('Sunucu başladı')
  kontrolEt()
  setInterval(kontrolEt, 60 * 1000)
})
