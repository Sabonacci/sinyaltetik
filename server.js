const axios = require('axios')
const express = require('express')
const app = express()

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js'
const TELEGRAM_CHAT_ID = '5756145019'

const HISSELER = [
  'THYAO.IS','GLRMK.IS','ALBRK.IS','TUPRS.IS','ASTOR.IS',
  'ASELS.IS','SASA.IS','TRENJ.IS','LMKDC.IS','EUPWR.IS',
  'GESAN.IS','SAYAS.IS','YEOTK.IS','ARASE.IS','KATMR.IS',
  'ATATP.IS','FORTE.IS','EMPAE.IS','YUNSA.IS','DESA.IS',
  'KRSTL.IS','ORGE.IS','TCKRC.IS','LYDHO.IS','DUNYH.IS',
  'BIGTK.IS','TGSAS.IS','BINHO.IS','TEHOL.IS','TRHOL.IS',
  'MANAS.IS','FMIZP.IS','PSDTC.IS','HUBVC.IS','IHAAS.IS',
  'AHGAZ.IS','ATATR.IS','FRMPL.IS','BESTE','ULUSE.IS',
  'EUREN.IS','TNZTP.IS','ARDYZ.IS','LOGO.IS','LINK.IS'
]

// ── Yardımcı hesap fonksiyonları ──────────────────────────────────────────────

function emaArr(arr, len) {
  if (arr.length === 0) return []
  const k = 2 / (len + 1)
  const result = [arr[0]]
  for (let i = 1; i < arr.length; i++) {
    result.push(arr[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

function smaArr(arr, len) {
  const result = []
  for (let i = 0; i < arr.length; i++) {
    if (i < len - 1) { result.push(NaN); continue }
    const sum = arr.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0)
    result.push(sum / len)
  }
  return result
}

// ── RSI ───────────────────────────────────────────────────────────────────────

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return []
  const gains = [], losses = []
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    gains.push(diff > 0 ? diff : 0)
    losses.push(diff < 0 ? Math.abs(diff) : 0)
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period

  const rsi = new Array(period).fill(NaN)

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    rsi.push(100 - 100 / (1 + rs))
  }

  return rsi
}

// ── Stochastic RSI ────────────────────────────────────────────────────────────

function calcStochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
  const rsi = calcRSI(closes, rsiPeriod)
  const k = []
  for (let i = 0; i < rsi.length; i++) {
    if (i < stochPeriod - 1) { k.push(NaN); continue }
    const slice = rsi.slice(i - stochPeriod + 1, i + 1).filter(v => !isNaN(v))
    if (slice.length < stochPeriod) { k.push(NaN); continue }
    const minRSI = Math.min(...slice)
    const maxRSI = Math.max(...slice)
    k.push(maxRSI === minRSI ? 0 : (rsi[i] - minRSI) / (maxRSI - minRSI) * 100)
  }
  const kSmoothed = smaArr(k.filter(v => !isNaN(v)), kSmooth)
  const dSmoothed = smaArr(kSmoothed, dSmooth)
  return { k: kSmoothed, d: dSmoothed }
}

// ── Parabolic SAR ─────────────────────────────────────────────────────────────

function calcParabolicSAR(highs, lows, closes, step = 0.02, max = 0.2) {
  const n   = closes.length
  const sar = new Array(n).fill(0)
  let bull  = true
  let af    = step
  let ep    = highs[0]
  sar[0]    = lows[0]

  for (let i = 1; i < n; i++) {
    let sarNew = sar[i - 1] + af * (ep - sar[i - 1])

    if (bull) {
      sarNew = Math.min(sarNew, lows[i - 1], i > 1 ? lows[i - 2] : lows[i - 1])
      if (lows[i] < sarNew) {
        bull   = false
        sarNew = ep
        ep     = lows[i]
        af     = step
      } else {
        if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + step, max) }
      }
    } else {
      sarNew = Math.max(sarNew, highs[i - 1], i > 1 ? highs[i - 2] : highs[i - 1])
      if (highs[i] > sarNew) {
        bull   = true
        sarNew = ep
        ep     = highs[i]
        af     = step
      } else {
        if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + step, max) }
      }
    }

    sar[i] = sarNew
  }

  return sar
}

// ── CMF (Chaikin Money Flow) ──────────────────────────────────────────────────

function calcCMF(highs, lows, closes, volumes, period = 20) {
  const mfv = closes.map((c, i) => {
    const hl = highs[i] - lows[i]
    if (hl === 0) return 0
    return ((c - lows[i] - (highs[i] - c)) / hl) * volumes[i]
  })

  const cmf = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { cmf.push(NaN); continue }
    const mfvSum = mfv.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    const volSum = volumes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    cmf.push(volSum === 0 ? 0 : mfvSum / volSum)
  }
  return cmf
}

// ── Hull MA ───────────────────────────────────────────────────────────────────

function calcHullMA(closes, period = 9) {
  const half  = Math.floor(period / 2)
  const sqrt  = Math.round(Math.sqrt(period))
  const wma1  = calcWMA(closes, half)
  const wma2  = calcWMA(closes, period)
  const diff  = wma1.map((v, i) => isNaN(wma2[i]) ? NaN : 2 * v - wma2[i])
  return calcWMA(diff, sqrt)
}

function calcWMA(arr, period) {
  const result = []
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(NaN); continue }
    let sum = 0, weightSum = 0
    for (let j = 0; j < period; j++) {
      const w = period - j
      sum       += arr[i - j] * w
      weightSum += w
    }
    result.push(sum / weightSum)
  }
  return result
}

// ── İchimoku Kijun-sen (Base Line) ───────────────────────────────────────────

function calcKijun(highs, lows, period = 26) {
  const result = []
  for (let i = 0; i < highs.length; i++) {
    if (i < period - 1) { result.push(NaN); continue }
    const maxH = Math.max(...highs.slice(i - period + 1, i + 1))
    const minL = Math.min(...lows.slice(i - period + 1, i + 1))
    result.push((maxH + minL) / 2)
  }
  return result
}

// ── Klasik Pivot Point ────────────────────────────────────────────────────────

function calcPivot(highs, lows, closes) {
  const n = closes.length
  if (n < 2) return NaN
  const h = Math.max(...highs.slice(0, n - 1))
  const l = Math.min(...lows.slice(0, n - 1))
  const c = closes[n - 2]
  return (h + l + c) / 3
}

// ── Yahoo Finance (Günlük Veri - Canlı) ───────────────────────────────────────

async function fetchYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    })
    const result = res.data.chart.result[0]
    const q      = result.indicators.quote[0]
    const vol    = q.volume || []

    const raw = q.close.map((c, i) => ({
      c: c, h: q.high[i], l: q.low[i],
      o: q.open[i], v: vol[i] || 0
    })).filter(x => x.c !== null && x.h !== null && x.l !== null && x.o !== null)

    return {
      closes:  raw.map(x => parseFloat(x.c.toFixed(4))),
      highs:   raw.map(x => parseFloat(x.h.toFixed(4))),
      lows:    raw.map(x => parseFloat(x.l.toFixed(4))),
      opens:   raw.map(x => parseFloat(x.o.toFixed(4))),
      volumes: raw.map(x => x.v)
    }
  } catch (err) {
    console.error(`${symbol} veri hatası: ${err.message}`)
    return null
  }
}

// ── Telegram Mesaj Gönderme ───────────────────────────────────────────────────

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

// ── Tarama Motoru ─────────────────────────────────────────────────────────────

async function taramaYap(sembol) {
  const veri = await fetchYahoo(sembol)
  if (!veri || veri.closes.length < 50) return null

  const { closes, highs, lows, opens, volumes } = veri
  const n    = closes.length - 1
  const fiyat = closes[n]
  const acilis = opens[n]
  const ad    = sembol.replace('.IS', '')

  const sonuclar = {}

  // 1. RSI(14) → 45-65 aralığı
  const rsi14 = calcRSI(closes, 14)
  const rsi14Son = rsi14[rsi14.length - 1]
  sonuclar.rsi14 = {
    deger: rsi14Son,
    gecti: !isNaN(rsi14Son) && rsi14Son >= 45 && rsi14Son <= 65,
    etiket: `RSI(14): ${isNaN(rsi14Son) ? '-' : rsi14Son.toFixed(1)}`
  }

  // 2. RSI(7) → max 70
  const rsi7  = calcRSI(closes, 7)
  const rsi7Son = rsi7[rsi7.length - 1]
  sonuclar.rsi7 = {
    deger: rsi7Son,
    gecti: !isNaN(rsi7Son) && rsi7Son <= 70,
    etiket: `RSI(7): ${isNaN(rsi7Son) ? '-' : rsi7Son.toFixed(1)}`
  }

  // 3. Parabolic SAR → fiyatın altında
  const sar    = calcParabolicSAR(highs, lows, closes)
  const sarSon = sar[n]
  sonuclar.sar = {
    deger: sarSon,
    gecti: sarSon < fiyat,
    etiket: `SAR: ${sarSon.toFixed(4)}`
  }

  // 4. CMF(20) → -0.2 ile 0.3 arasında
  const cmf    = calcCMF(highs, lows, closes, volumes, 20)
  const cmfSon = cmf[n]
  sonuclar.cmf = {
    deger: cmfSon,
    gecti: !isNaN(cmfSon) && cmfSon > -0.2 && cmfSon < 0.3,
    etiket: `CMF(20): ${isNaN(cmfSon) ? '-' : cmfSon.toFixed(3)}`
  }

  // 5. Hull MA(9) → fiyatın altında
  const hma    = calcHullMA(closes, 9)
  const hmaSon = hma[hma.length - 1]
  sonuclar.hma = {
    deger: hmaSon,
    gecti: !isNaN(hmaSon) && hmaSon < fiyat,
    etiket: `HMA(9): ${isNaN(hmaSon) ? '-' : hmaSon.toFixed(4)}`
  }

  // 6. Fiyat > Açılış
  sonuclar.fiyatAcilis = {
    deger: fiyat - acilis,
    gecti: fiyat > acilis,
    etiket: `Fiyat: ${fiyat.toFixed(4)} > Açılış: ${acilis.toFixed(4)}`
  }

  // 7. Stochastic RSI K > D
  const stochRsi = calcStochRSI(closes, 14, 14, 3, 3)
  const kSon = stochRsi.k[stochRsi.k.length - 1]
  const dSon = stochRsi.d[stochRsi.d.length - 1]
  sonuclar.stochRsi = {
    deger: { k: kSon, d: dSon },
    gecti: !isNaN(kSon) && !isNaN(dSon) && kSon > dSon,
    etiket: `StochRSI K: ${isNaN(kSon) ? '-' : kSon.toFixed(1)} / D: ${isNaN(dSon) ? '-' : dSon.toFixed(1)}`
  }

  // 8. İchimoku Base Line (Kijun) < Fiyat
  const kijun    = calcKijun(highs, lows, 26)
  const kijunSon = kijun[n]
  sonuclar.kijun = {
    deger: kijunSon,
    gecti: !isNaN(kijunSon) && kijunSon < fiyat,
    etiket: `Kijun: ${isNaN(kijunSon) ? '-' : kijunSon.toFixed(4)}`
  }

  // 9. Pivot < Fiyat
  const pivot = calcPivot(highs, lows, closes)
  sonuclar.pivot = {
    deger: pivot,
    gecti: !isNaN(pivot) && pivot < fiyat,
    etiket: `Pivot: ${isNaN(pivot) ? '-' : pivot.toFixed(4)}`
  }

  // ── Sonuç Değerlendirmesi ─────────────────────────────────────────────────
  const kriterler   = Object.values(sonuclar)
  const toplamKriter = kriterler.length
  const gecenKriter  = kriterler.filter(k => k.gecti).length

  const tumunuGecti  = kriterler.every(k => k.gecti)

  if (!tumunuGecti) return null

  return {
    sembol: ad,
    fiyat,
    gecenKriter,
    toplamKriter,
    sonuclar
  }
}

// ── Tarama Çalıştır ───────────────────────────────────────────────────────────

async function taramaBaslat() {
  const saat  = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })
  const tarih = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
  console.log(`[${saat}] Günlük (1D) periyot taraması başladı...`)

  const bulunanlar = []

  for (const sembol of HISSELER) {
    try {
      const sonuc = await taramaYap(sembol)
      if (sonuc) bulunanlar.push(sonuc)
    } catch (err) {
      console.error(`${sembol} tarama hatası: ${err.message}`)
    }
  }

  console.log(`[${new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })}] Tarama bitti. ${bulunanlar.length} hisse bulundu.`)

  if (bulunanlar.length === 0) {
    await sendTelegram(`🔍 <b>TARAMA SONUCU — ${tarih}</b>\n🕐 ${saat} | Günlük (1D)\n━━━━━━━━━━━━━━━━━━━━\n❌ Kriterleri karşılayan hiçbir hisse bulunamadı.`)
    return
  }

  // Mesajı oluştur ve gönder
  let msg = `🔍 <b>TARAMA SONUCU — ${tarih}</b>\n`
  msg    += `🕐 ${saat} | Günlük (1D) Grafik\n`
  msg    += `━━━━━━━━━━━━━━━━━━━━\n`
  msg    += `✅ <b>${bulunanlar.length} hisse tüm kriterleri geçti</b>\n\n`

  bulunanlar.forEach(h => {
    msg += `📌 <b>${h.sembol}</b> — ${h.fiyat.toFixed(4)} ₺\n`
    msg += `   ✅ RSI14: ${h.sonuclar.rsi14.deger.toFixed(1)}`
    msg += ` | RSI7: ${h.sonuclar.rsi7.deger.toFixed(1)}`
    msg += ` | CMF: ${h.sonuclar.cmf.deger.toFixed(3)}\n`
    msg += `   ✅ SAR: ${h.sonuclar.sar.deger.toFixed(4)}`
    msg += ` | HMA: ${h.sonuclar.hma.deger.toFixed(4)}\n`
    msg += `   ✅ StochK: ${h.sonuclar.stochRsi.deger.k.toFixed(1)}`
    msg += ` > D: ${h.sonuclar.stochRsi.deger.d.toFixed(1)}`
    msg += ` | Kijun: ${h.sonuclar.kijun.deger.toFixed(4)}\n`
    msg += `   ✅ Pivot: ${h.sonuclar.pivot.deger.toFixed(4)}`
    msg += ` | Fiyat > Açılış ✓\n\n`
  })

  msg += `━━━━━━━━━━━━━━━━━━━━`

  await sendTelegram(msg)
  console.log('📨 Tarama mesajı gönderildi.')
}

// ── Saat Kontrolü (Borsa saatleri 09:30–18:30) ───────────────────────────────

function borsaAcikMi() {
  const simdi = new Date()
  const tr = new Date(simdi.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }))
  const gun  = tr.getDay()   // 0=Pazar, 6=Cumartesi
  const saat = tr.getHours()
  const dak  = tr.getMinutes()
  const dakika = saat * 60 + dak

  if (gun === 0 || gun === 6) return false
  return dakika >= 9 * 60 + 30 && dakika <= 18 * 60 + 30
}

// ── Telegram'dan Gelen Komutları Dinleme (Long Polling) ──────────────────────

let lastUpdateId = 0;

async function telegramDinle() {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
    const res = await axios.get(url, { timeout: 35000 });
    
    if (res.data && res.data.result.length > 0) {
      for (const update of res.data.result) {
        lastUpdateId = update.update_id;

        if (update.message && update.message.text) {
          const mesajMetni = update.message.text.trim();
          const gelenChatId = update.message.chat.id.toString();

          // Sadece tanımladığın TELEGRAM_CHAT_ID üzerinden gelen komutu dinler
          if (mesajMetni === '/tara' && gelenChatId === TELEGRAM_CHAT_ID) {
            await sendTelegram('⏳ <b>Manuel tarama isteği alındı.</b> Günlük canlı veriler analiz ediliyor, lütfen bekleyin...');
            await taramaBaslat();
          }
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ECONNABORTED') {
      console.error('Telegram dinleme hatası:', err.message);
    }
  }
  
  // Sürekli dinleme döngüsü
  setTimeout(telegramDinle, 1000);
}

// ── Express Sunucu ve Zamanlayıcı Başlatma ────────────────────────────────────

app.get('/', (req, res) => res.send('Tarama botu çalışıyor ✅'))

app.get('/test', async (req, res) => {
  await sendTelegram('🧪 <b>Test mesajı</b>\nTarama botu çalışıyor ✅')
  res.send('Telegram test mesajı gönderildi')
})

app.get('/tara', async (req, res) => {
  await taramaBaslat()
  res.send('Manuel tarama tamamlandı')
})

app.listen(3000, () => {
  console.log('Tarama botu başladı ✅')
  console.log('Kriterler (1D): RSI14(45-65) | RSI7(≤70) | SAR(altında) | CMF(-0.2/0.3) | HMA(altında) | Fiyat>Açılış | StochRSI K>D | Kijun<Fiyat | Pivot<Fiyat')

  // Telegram bot komut dinleyicisini başlatıyoruz
  telegramDinle();

  // İlk açılışta borsa açıksa otomatik tarama yapar
  if (borsaAcikMi()) taramaBaslat()

  // Her 15 dakikada bir otomatik kontrol
  setInterval(() => {
    if (borsaAcikMi()) {
      taramaBaslat()
    } else {
      const saat = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })
      console.log(`[${saat}] Borsa kapalı, otomatik tarama atlandı. (Telegram /tara komutu yine de çalışır)`)
    }
  }, 15 * 60 * 1000)
})
