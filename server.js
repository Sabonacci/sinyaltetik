const axios   = require('axios')
const express = require('express')
const app     = express()

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js'
const TELEGRAM_CHAT_ID = '5756145019'

const HISSELER = [
  'THYAO.IS','GLRMK.IS','ALBRK.IS','TUPRS.IS','ASTOR.IS',
  'ASELS.IS','SASA.IS','TRENJ.IS','LMKDC.IS','EUPWR.IS',
  'GESAN.IS','SAYAS.IS','YEOTK.IS','ARASE.IS','KATMR.IS',
  'ATATP.IS','FORTE.IS','EMPAE.IS','YUNSA.IS','DESA.IS',
  'KRSTL.IS','ORGE.IS','TCKRC.IS','LYDHO.IS','DUNYH.IS',
  'BIGTK.IS','TGSAS.IS','BINHO.IS','TEHOL.IS','TRHOL.IS',
  'MANAS.IS','FMIZP.IS','PSDTC.IS','AKSGY.IS','IHAAS.IS',
  'AHGAZ.IS','CEMZY.IS','ATATR.IS','FRMPL.IS','ARDYZ.IS',
  'EUREN.IS','BOSSA.IS','SILVR.IS','TRGYO.IS'
  
]

// ── Yardımcı: bekleme (rate-limit koruması) ───────────────────────────────────

const bekle = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── EMA (SMA tabanlı başlangıç) ───────────────────────────────────────────────
// Düzeltme: ilk değer olarak arr[0] yerine ilk `len` barın SMA'sı kullanılıyor.

function emaArr(arr, len) {
  if (arr.length < len) return new Array(arr.length).fill(NaN)
  const k      = 2 / (len + 1)
  const result = new Array(len - 1).fill(NaN)
  // Başlangıç: ilk `len` elemanın ortalaması
  const seed = arr.slice(0, len).reduce((a, b) => a + b, 0) / len
  result.push(seed)
  for (let i = len; i < arr.length; i++) {
    result.push(arr[i] * k + result[result.length - 1] * (1 - k))
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
  const rsi   = new Array(period).fill(NaN)
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    rsi.push(100 - 100 / (1 + rs))
  }
  return rsi
}

// ── Stochastic RSI ────────────────────────────────────────────────────────────
// Düzeltme: NaN'lar filter() ile kaldırılmıyordu — bu index kaymasına yol açıyordu.
// Artık NaN'lar dizide tutulur, smaArr içinde atlanır.

function smaArrNaN(arr, len) {
  // NaN toleranslı SMA: NaN'lı pozisyonlar NaN döner, asla index kaymaz
  const result = []
  for (let i = 0; i < arr.length; i++) {
    if (i < len - 1) { result.push(NaN); continue }
    const slice = arr.slice(i - len + 1, i + 1)
    if (slice.some(v => isNaN(v))) { result.push(NaN); continue }
    result.push(slice.reduce((a, b) => a + b, 0) / len)
  }
  return result
}

function calcStochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
  const rsi = calcRSI(closes, rsiPeriod)
  const k   = []

  for (let i = 0; i < rsi.length; i++) {
    if (i < stochPeriod - 1 || isNaN(rsi[i])) { k.push(NaN); continue }
    const slice = rsi.slice(i - stochPeriod + 1, i + 1)
    if (slice.some(v => isNaN(v)))            { k.push(NaN); continue }
    const minRSI = Math.min(...slice)
    const maxRSI = Math.max(...slice)
    k.push(maxRSI === minRSI ? 0 : (rsi[i] - minRSI) / (maxRSI - minRSI) * 100)
  }

  const kSmoothed = smaArrNaN(k, kSmooth)
  const dSmoothed = smaArrNaN(kSmoothed, dSmooth)

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
        bull = false; sarNew = ep; ep = lows[i]; af = step
      } else {
        if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + step, max) }
      }
    } else {
      sarNew = Math.max(sarNew, highs[i - 1], i > 1 ? highs[i - 2] : highs[i - 1])
      if (highs[i] > sarNew) {
        bull = true; sarNew = ep; ep = highs[i]; af = step
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

function calcHullMA(closes, period = 9) {
  const half = Math.floor(period / 2)
  const sqrt = Math.round(Math.sqrt(period))
  const wma1 = calcWMA(closes, half)
  const wma2 = calcWMA(closes, period)
  const diff = wma1.map((v, i) => isNaN(wma2[i]) ? NaN : 2 * v - wma2[i])
  return calcWMA(diff, sqrt)
}

// ── İchimoku Kijun-sen ────────────────────────────────────────────────────────

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
// Düzeltme: Artık sadece bir önceki günün H/L/C'si kullanılıyor.
// Önceki kod 3 aylık tüm veriyi kullanıyordu — pivot çok baskın çıkıyordu.

function calcPivot(highs, lows, closes) {
  const n = closes.length
  if (n < 2) return NaN
  const i = n - 2  // bir önceki (tamamlanmış) bar
  return (highs[i] + lows[i] + closes[i]) / 3
}

// ── Yahoo Finance ─────────────────────────────────────────────────────────────

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
    const raw    = q.close.map((c, i) => ({
      c: c, h: q.high[i], l: q.low[i], o: q.open[i], v: vol[i] || 0
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
  const n      = closes.length - 1
  const fiyat  = closes[n]
  const acilis = opens[n]
  const ad     = sembol.replace('.IS', '')

  const sonuclar = {}

  // 1. RSI(14) → 45-65 aralığı
  const rsi14    = calcRSI(closes, 14)
  const rsi14Son = rsi14[rsi14.length - 1]
  sonuclar.rsi14 = {
    deger: rsi14Son,
    gecti: !isNaN(rsi14Son) && rsi14Son >= 45 && rsi14Son <= 65,
    etiket: `RSI14: ${isNaN(rsi14Son) ? '-' : rsi14Son.toFixed(1)}`
  }

  // 2. RSI(7) → max 70
  const rsi7    = calcRSI(closes, 7)
  const rsi7Son = rsi7[rsi7.length - 1]
  sonuclar.rsi7 = {
    deger: rsi7Son,
    gecti: !isNaN(rsi7Son) && rsi7Son <= 70,
    etiket: `RSI7: ${isNaN(rsi7Son) ? '-' : rsi7Son.toFixed(1)}`
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
  //    YILDIZ EKLENTİSİ: CMF 0 ile 0.3 arasında ise "güçlü sinyal"
  const cmf    = calcCMF(highs, lows, closes, volumes, 20)
  const cmfSon = cmf[n]
  const cmfGecti = !isNaN(cmfSon) && cmfSon > -0.2 && cmfSon < 0.3
  const cmfYildiz = !isNaN(cmfSon) && cmfSon >= 0 && cmfSon < 0.3
  sonuclar.cmf = {
    deger: cmfSon,
    gecti: cmfGecti,
    yildiz: cmfYildiz,
    etiket: `CMF: ${isNaN(cmfSon) ? '-' : cmfSon.toFixed(3)}`
  }

  // 5. Hull MA(9) → fiyatın altında
  const hma    = calcHullMA(closes, 9)
  const hmaSon = hma[hma.length - 1]
  sonuclar.hma = {
    deger: hmaSon,
    gecti: !isNaN(hmaSon) && hmaSon < fiyat,
    etiket: `HMA: ${isNaN(hmaSon) ? '-' : hmaSon.toFixed(4)}`
  }

  // 6. Fiyat > Açılış
  sonuclar.fiyatAcilis = {
    deger: fiyat - acilis,
    gecti: fiyat > acilis,
    etiket: `F:${fiyat.toFixed(4)} > A:${acilis.toFixed(4)}`
  }

  // 7. Stochastic RSI K > D
  //    YILDIZ EKLENTİSİ: önceki barda K < D iken şimdi K > D ise "kesişim barı"
  const stochRsi  = calcStochRSI(closes, 14, 14, 3, 3)
  const kSon      = stochRsi.k[stochRsi.k.length - 1]
  const dSon      = stochRsi.d[stochRsi.d.length - 1]
  const kOnceki   = stochRsi.k[stochRsi.k.length - 2]
  const dOnceki   = stochRsi.d[stochRsi.d.length - 2]
  const stochGecti = !isNaN(kSon) && !isNaN(dSon) && kSon > dSon
  // Yeni kesişim: bir önceki barda K < D iken şimdi K > D
  const stochYildiz = stochGecti &&
    !isNaN(kOnceki) && !isNaN(dOnceki) && kOnceki <= dOnceki
  sonuclar.stochRsi = {
    deger:  { k: kSon, d: dSon },
    gecti:  stochGecti,
    yildiz: stochYildiz,
    etiket: `StochK:${isNaN(kSon) ? '-' : kSon.toFixed(1)} D:${isNaN(dSon) ? '-' : dSon.toFixed(1)}`
  }

  // 8. İchimoku Kijun < Fiyat
  const kijun    = calcKijun(highs, lows, 26)
  const kijunSon = kijun[n]
  sonuclar.kijun = {
    deger: kijunSon,
    gecti: !isNaN(kijunSon) && kijunSon < fiyat,
    etiket: `Kijun: ${isNaN(kijunSon) ? '-' : kijunSon.toFixed(4)}`
  }

  // 9. Pivot < Fiyat (düzeltildi: artık sadece dün'ün H/L/C'si)
  const pivot = calcPivot(highs, lows, closes)
  sonuclar.pivot = {
    deger: pivot,
    gecti: !isNaN(pivot) && pivot < fiyat,
    etiket: `Pivot: ${isNaN(pivot) ? '-' : pivot.toFixed(4)}`
  }

  // ── Değerlendirme ──────────────────────────────────────────────────────────
  const kriterler  = Object.values(sonuclar)
  const tumunuGecti = kriterler.every(k => k.gecti)
  if (!tumunuGecti) return null

  // ÇİFT YILDIZ: hem StochRSI kesişim barı HEM CMF pozitif bölgede
  const yildizSayisi =
    (sonuclar.stochRsi.yildiz ? 1 : 0) +
    (sonuclar.cmf.yildiz      ? 1 : 0)

  return { sembol: ad, fiyat, acilis, sonuclar, yildizSayisi }
}

// ── Telegram Mesaj Formatlayıcı (Şık Panel) ───────────────────────────────────

function formatMesaj(bulunanlar, tarih, saat) {
  const cizgi  = '━━━━━━━━━━━━━━━━━━━━━━━'
  const ince   = '─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─'

  let msg = `\n`
  msg += `📊 <b>BIST TARAMA PANELİ</b>\n`
  msg += `${cizgi}\n`
  msg += `🗓 ${tarih}  🕐 ${saat}\n`
  msg += `📈 Periyot: Günlük (1D)  •  9 Kriter\n`
  msg += `${cizgi}\n\n`

  if (bulunanlar.length === 0) {
    msg += `❌  Tüm kriterleri karşılayan hisse bulunamadı.\n\n`
    msg += `${cizgi}`
    return msg
  }

  // Yıldızlıları öne al, sonra alfabetik
  bulunanlar.sort((a, b) => b.yildizSayisi - a.yildizSayisi || a.sembol.localeCompare(b.sembol))

  msg += `✅ <b>${bulunanlar.length} hisse</b> tüm kriterleri geçti\n\n`

  bulunanlar.forEach((h, idx) => {
    const s      = h.sonuclar
    const degisim = ((h.fiyat - h.acilis) / h.acilis * 100).toFixed(2)
    const yonIkon = h.fiyat >= h.acilis ? '▲' : '▼'

    // Yıldız rozeti
    let rozet = ''
    if (h.yildizSayisi === 2) rozet = ' ⭐⭐ <b>GÜÇLÜ</b>'
    else if (h.yildizSayisi === 1) rozet = ' ⭐ Sinyal+'

    msg += `${cizgi}\n`
    msg += `📌 <b>${h.sembol}</b>${rozet}\n`
    msg += `   💰 <b>${h.fiyat.toFixed(4)} ₺</b>  ${yonIkon} %${degisim}\n`
    msg += `${ince}\n`

    // Satır 1: RSI'lar
    msg += `   📉 ${s.rsi14.etiket}  │  ${s.rsi7.etiket}\n`

    // Satır 2: StochRSI (yıldızlıysa işaret)
    const stochIkon = s.stochRsi.yildiz ? '⭐' : '✅'
    msg += `   ${stochIkon} ${s.stochRsi.etiket}\n`

    // Satır 3: CMF (yıldızlıysa işaret)
    const cmfIkon = s.cmf.yildiz ? '⭐' : '✅'
    msg += `   ${cmfIkon} ${s.cmf.etiket}  │  ${s.hma.etiket}\n`

    // Satır 4: SAR + Kijun
    msg += `   ✅ ${s.sar.etiket}  │  ${s.kijun.etiket}\n`

    // Satır 5: Pivot
    msg += `   ✅ ${s.pivot.etiket}  │  Fiyat > Açılış ✓\n`

    if (idx < bulunanlar.length - 1) msg += `\n`
  })

  msg += `${cizgi}\n`
  msg += `<i>🤖 Otomatik tarama — sadece bilgi amaçlıdır</i>`

  return msg
}

// ── Tarama Çalıştır ───────────────────────────────────────────────────────────

async function taramaBaslat() {
  const simdi = new Date()
  const saat  = simdi.toLocaleTimeString('tr-TR',  { timeZone: 'Europe/Istanbul' })
  const tarih = simdi.toLocaleDateString('tr-TR',  { timeZone: 'Europe/Istanbul' })
  console.log(`[${saat}] Tarama başladı...`)

  const bulunanlar = []

  for (let i = 0; i < HISSELER.length; i++) {
    const sembol = HISSELER[i]
    try {
      const sonuc = await taramaYap(sembol)
      if (sonuc) bulunanlar.push(sonuc)
    } catch (err) {
      console.error(`${sembol} tarama hatası: ${err.message}`)
    }

    // Her hisse sonrası 400-800ms rastgele bekleme (ban koruması)
    const bekleme = 400 + Math.floor(Math.random() * 400)
    await bekle(bekleme)

    // Her 10 hissede bir 2 saniyelik ek nefes
    if ((i + 1) % 10 === 0) await bekle(2000)
  }

  const bitis = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })
  console.log(`[${bitis}] Tarama bitti. ${bulunanlar.length} hisse bulundu.`)

  const msg = formatMesaj(bulunanlar, tarih, saat)
  await sendTelegram(msg)
  console.log('📨 Telegram mesajı gönderildi.')
}

// ── Borsa Saati Kontrolü ──────────────────────────────────────────────────────
// Düzeltme: Kapanış 18:30 → 18:05 olarak güncellendi (BIST etkin kapanış)

function borsaAcikMi() {
  const simdi  = new Date()
  const tr     = new Date(simdi.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }))
  const gun    = tr.getDay()    // 0=Pazar, 6=Cumartesi
  const dakika = tr.getHours() * 60 + tr.getMinutes()

  if (gun === 0 || gun === 6) return false
  return dakika >= 9 * 60 + 30 && dakika <= 18 * 60 + 5
}

// ── Telegram Long Polling ─────────────────────────────────────────────────────

let lastUpdateId = 0

async function telegramDinle() {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`
    const res = await axios.get(url, { timeout: 35000 })

    if (res.data && res.data.result.length > 0) {
      for (const update of res.data.result) {
        lastUpdateId = update.update_id
        if (update.message && update.message.text) {
          const metin      = update.message.text.trim()
          const gelenChatId = update.message.chat.id.toString()
          if (metin === '/tara' && gelenChatId === TELEGRAM_CHAT_ID) {
            await sendTelegram('⏳ <b>Manuel tarama başlatıldı.</b>\nGünlük veriler analiz ediliyor...')
            await taramaBaslat()
          }
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ECONNABORTED') {
      console.error('Telegram dinleme hatası:', err.message)
    }
  }
  setTimeout(telegramDinle, 1000)
}

// ── Express + Başlatma ────────────────────────────────────────────────────────

app.get('/', (_req, res) => res.send('Tarama botu çalışıyor ✅'))

app.get('/test', async (_req, res) => {
  await sendTelegram('🧪 <b>Test</b> — Bot çalışıyor ✅')
  res.send('Test mesajı gönderildi')
})

app.get('/tara', async (_req, res) => {
  taramaBaslat()   // async olarak başlat, HTTP cevabını bekleme
  res.send('Tarama başlatıldı')
})

app.listen(3000, () => {
  console.log('Tarama botu başladı ✅')
  console.log('Kriterler: RSI14(45-65) | RSI7(≤70) | SAR↓ | CMF(-0.2/0.3) | HMA↓ | F>A | StochRSI K>D | Kijun↓ | Pivot↓')
  console.log('⭐ Yıldız: StochRSI yeni kesişim + CMF≥0')

  telegramDinle()

  if (borsaAcikMi()) taramaBaslat()

  // ── Her 1 saatte bir otomatik tarama (15 dk → 1 saat) ────────────────────
  setInterval(() => {
    if (borsaAcikMi()) {
      taramaBaslat()
    } else {
      const saat = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })
      console.log(`[${saat}] Borsa kapalı — tarama atlandı. (/tara komutu yine çalışır)`)
    }
  }, 60 * 60 * 1000)  // 1 saat
})
