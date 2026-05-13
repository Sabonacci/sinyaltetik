const axios   = require('axios')
const express = require('express')
const fs      = require('fs')
const app     = express()

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js'
const TELEGRAM_CHAT_ID = '-1003975259428'

const HISSELER = [
  'THYAO.IS','GLRMK.IS','ALBRK.IS','TUPRS.IS','ASTOR.IS',
  'ASELS.IS','SASA.IS','TRENJ.IS','LMKDC.IS','EUPWR.IS',
  'GESAN.IS','SAYAS.IS','YEOTK.IS','ARASE.IS','KATMR.IS',
  'ATATP.IS','FORTE.IS','EMPAE.IS','YUNSA.IS','DESA.IS',
  'KRSTL.IS','ORGE.IS','TCKRC.IS','LYDHO.IS','DUNYH.IS',
  'BIGTK.IS','TGSAS.IS','BINHO.IS','TEHOL.IS','TRHOL.IS',
  'MANAS.IS','FMIZP.IS','PSDTC.IS','HUBVC.IS','IHAAS.IS',
  'EUREN.IS','TNZTP.IS','ARDYZ.IS','LOGO.IS','LINK.IS'
]

const COINLER = [
  'BTCUSDT','XRPUSDT','DASHUSDT','SOLUSDT',
  'ETHUSDT','ETHFIUSDT','MATICUSDT'
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
;[...HISSELER, ...COINLER].forEach(h => {
  durum[h] = {
    lastSignal: 0,
    alBar:      null,
    alPrice:    null,
    tpLevel:    null
  }
})

// ── Yardımcı fonksiyonlar ─────────────────────────────────────────────────────

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
    if (i < len - 1) { result.push(arr[i]); continue }
    const sum = arr.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0)
    result.push(sum / len)
  }
  return result
}

function atrArr(highs, lows, closes, len) {
  const tr = closes.map((c, i) => {
    if (i === 0) return highs[i] - lows[i]
    return Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1])
    )
  })
  return emaArr(tr, len)
}

// Supertrend hesabı
function calcSupertrend(highs, lows, closes, period, multiplier) {
  const hl2   = closes.map((_, i) => (highs[i] + lows[i]) / 2)
  const atr   = atrArr(highs, lows, closes, period)
  const n     = closes.length

  const up    = new Array(n).fill(0)
  const dn    = new Array(n).fill(0)
  const trend = new Array(n).fill(1)

  up[0] = hl2[0] - multiplier * atr[0]
  dn[0] = hl2[0] + multiplier * atr[0]

  for (let i = 1; i < n; i++) {
    const rawUp = hl2[i] - multiplier * atr[i]
    const rawDn = hl2[i] + multiplier * atr[i]

    up[i] = closes[i - 1] > up[i - 1] ? Math.max(rawUp, up[i - 1]) : rawUp
    dn[i] = closes[i - 1] < dn[i - 1] ? Math.min(rawDn, dn[i - 1]) : rawDn

    if (trend[i - 1] === -1 && closes[i] > dn[i - 1]) trend[i] = 1
    else if (trend[i - 1] === 1 && closes[i] < up[i - 1]) trend[i] = -1
    else trend[i] = trend[i - 1]
  }

  return { up, dn, trend }
}

// WaveTrend hesabı
function calcWaveTrend(highs, lows, closes, n1 = 10, n2 = 21) {
  const hlc3 = closes.map((c, i) => (highs[i] + lows[i] + c) / 3)
  const esa  = emaArr(hlc3, n1)
  const d    = emaArr(hlc3.map((v, i) => Math.abs(v - esa[i])), n1)
  const ci   = hlc3.map((v, i) => d[i] === 0 ? 0 : (v - esa[i]) / (0.015 * d[i]))
  const wt1  = emaArr(ci, n2)
  const wt2  = smaArr(wt1, 4)
  return { wt1, wt2 }
}

// ── Yahoo Finance (1dk) ───────────────────────────────────────────────────────

async function fetchYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const q   = res.data.chart.result[0].indicators.quote[0]
    const raw = q.close.map((c, i) => ({
      c: c, h: q.high[i], l: q.low[i]
    })).filter(x => x.c !== null && x.h !== null && x.l !== null)
    return {
      closes: raw.map(x => parseFloat(x.c.toFixed(4))),
      highs:  raw.map(x => parseFloat(x.h.toFixed(4))),
      lows:   raw.map(x => parseFloat(x.l.toFixed(4)))
    }
  } catch (err) {
    console.error(`${symbol} veri hatası: ${err.message}`)
    return null
  }
}

// ── Coinbase (1dk) ────────────────────────────────────────────────────────────

async function fetchCoinbase(symbol) {
  try {
    const coin = symbol.replace('USDT', '-USD')
    const url  = `https://api.exchange.coinbase.com/products/${coin}/candles?granularity=60`
    const res  = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const data = res.data.reverse()
    return {
      closes: data.map(k => parseFloat(k[4])),
      highs:  data.map(k => parseFloat(k[2])),
      lows:   data.map(k => parseFloat(k[1]))
    }
  } catch (err) {
    console.error(`${symbol} veri hatası: ${err.message}`)
    return null
  }
}

// ── Telegram ─────────────────────────────────────────────────────────────────

async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML'
    })
  } catch (err) { console.error('Telegram hatası:', err.message) }
}

// ── Günlük rapor ──────────────────────────────────────────────────────────────

async function gunlukRapor() {
  const saat  = new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})
  const tarih = new Date().toLocaleDateString('tr-TR', {timeZone: 'Europe/Istanbul'})

  let msg = `📊 <b>GÜNLÜK RAPOR — ${tarih}</b>\n🕐 ${saat}\n━━━━━━━━━━━━━━━━━━━━\n\n`

  const tamamlanan = gunlukIslemler.filter(i => i.satFiyat !== null)
  const karlilar   = tamamlanan.filter(i => i.pct >= 0)
  const zararlilar = tamamlanan.filter(i => i.pct < 0)
  const toplamPct  = tamamlanan.reduce((acc, i) => acc + i.pct, 0)

  msg += `✅ <b>Tamamlanan: ${tamamlanan.length}</b>  🟢 Kâr: ${karlilar.length} | 🔴 Zarar: ${zararlilar.length}\n`

  if (tamamlanan.length > 0) {
    msg += `💰 Toplam: %${toplamPct.toFixed(2)}\n\n`
    tamamlanan.forEach(i => {
      const ok = i.pct >= 0 ? '🟢 ▲' : '🔴 ▼'
      msg += `${ok} <b>${i.sembol}</b>  Al:${i.alFiyat} → Sat:${i.satFiyat}  %${Math.abs(i.pct).toFixed(2)}\n`
    })
  }

  const devamEden = Object.entries(durum).filter(([_, d]) => d.lastSignal === 1)
  msg += `\n━━━━━━━━━━━━━━━━━━━━\n⏳ <b>Devam Eden: ${devamEden.length}</b>\n\n`
  devamEden.forEach(([sembol, d]) => {
    const ad = sembol.replace('.IS','').replace('USDT','')
    msg += `🔵 <b>${ad}</b>  Al: ${d.alPrice ? d.alPrice.toFixed(4) : '-'}\n`
  })
  msg += `\n━━━━━━━━━━━━━━━━━━━━`

  await sendTelegram(msg)
  console.log('📊 Günlük rapor gönderildi.')
  gunlukIslemler = []
  islemleriKaydet()
}

function saatKontrol() {
  const simdi = new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})
  
  if (simdi.startsWith('09:30')) {
    const tarih = new Date().toLocaleDateString('tr-TR', {timeZone: 'Europe/Istanbul'})
    sendTelegram(
      `🔔 <b>Allah CC işinizi gücünüzü rast getirsin</b>\n` +
      `📅 ${tarih}\n` +
      `🕐 09:30\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 Takip edilen hisse: 10\n` +
      `🪙 Takip edilen coin: 7\n` +
      `✅ Sinyal botu aktif`
    )
  }

  if (simdi.startsWith('18:15')) {
    const tarih = new Date().toLocaleDateString('tr-TR', {timeZone: 'Europe/Istanbul'})
    sendTelegram(
      `🔔 <b>Rızkı veren Hüda dır kula minnet eylemem</b>\n` +
      `📅 ${tarih}\n` +
      `🕐 18:15\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 Günlük rapor 18:30'da gönderilecek`
    )
  }

  if (simdi.startsWith('18:30')) gunlukRapor()
}

// ── Sinyal motoru ─────────────────────────────────────────────────────────────

async function sinyalKontrol(sembol, veri, para, xu100Yukseliyor = true) {
  if (!veri || veri.closes.length < 30) return

  const { closes, highs, lows } = veri
  const d        = durum[sembol]
  const n        = closes.length - 1
  const ad       = sembol.replace('.IS','').replace('USDT','')
  const closeSon = closes[n]
  const saat     = new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})
  const tpPerc   = 0.007 // %0.5 kar hedefi

  // Supertrend 1: sinyal bandı (10, 2.7)
  const st1 = calcSupertrend(highs, lows, closes, 10, 2.7)
  // Supertrend 2: trend bandı (13, 5.0)
  const st2 = calcSupertrend(highs, lows, closes, 13, 5.0)

  // WaveTrend
  const { wt1, wt2 } = calcWaveTrend(highs, lows, closes, 10, 21)

  const trend1Son  = st1.trend[n]
  const trend1Prev = st1.trend[n - 1]
  const trend2Son  = st2.trend[n]

  // Buy sinyali: trend1 -1'den 1'e döndü
  const buySignal = trend1Son === 1 && trend1Prev === -1

  // Son 7 periyotta wt1 wt2'yi yukarı kesti VE kesişim anında wt1 < -30
  let wtCrossedRecently = false
  for (let i = 0; i <= 6; i++) {
    const idx = n - i
    if (idx < 1) break
    const cross = wt1[idx] > wt2[idx] && wt1[idx - 1] <= wt2[idx - 1]
    if (cross && wt1[idx] < -30) {
      wtCrossedRecently = true
      break
    }
  }

  // Kesin AL: buySignal + wtCrossedRecently + trend2 == 1 + xu100 yükseliyor
  const kesinAl = buySignal && wtCrossedRecently && trend2Son === 1 && xu100Yukseliyor

  // Kesin SAT: pozisyon açık + fiyat TP seviyesine ulaştı
  const kesinSat = d.lastSignal === 1 && d.tpLevel !== null && closeSon >= d.tpLevel

  // AL sinyali
  if (kesinAl && d.lastSignal !== 1) {
    d.lastSignal = 1
    d.alBar      = n
    d.alPrice    = closeSon
    d.tpLevel    = parseFloat((closeSon * (1 + tpPerc)).toFixed(4))

    gunlukIslemler.push({
      sembol:   ad,
      alFiyat:  closeSon.toFixed(4),
      satFiyat: null,
      period:   0,
      pct:      0,
      para
    })
    islemleriKaydet()

    await sendTelegram(
      `🟢 <b>KESİN AL — ${ad}</b>\n` +
      `💰 Fiyat: ${closeSon.toFixed(4)} ${para}\n` +
      `🎯 Hedef: ${d.tpLevel} ${para} (+%0.5)\n` +
      `📊 WT1: ${wt1[n].toFixed(1)} | Trend2: ${trend2Son === 1 ? '▲' : '▼'}\n` +
      `🕐 ${saat}`
    )
    console.log(`✅ KESİN AL: ${sembol} @ ${closeSon} | TP: ${d.tpLevel}`)
  }

  // SAT sinyali
  if (kesinSat && d.lastSignal !== -1) {
    const period = n - d.alBar
    const pct    = ((closeSon - d.alPrice) / d.alPrice * 100)
    const ok     = pct >= 0 ? '🟢 ▲ KAR' : '🔴 ▼ ZARAR'

    d.lastSignal = -1
    d.tpLevel = null

    const idx = gunlukIslemler.findIndex(i => i.sembol === ad && i.satFiyat === null)
    if (idx !== -1) {
      gunlukIslemler[idx].satFiyat = closeSon.toFixed(4)
      gunlukIslemler[idx].period   = period
      gunlukIslemler[idx].pct      = pct
    }
    islemleriKaydet()

    await sendTelegram(
      `🔴 <b>KESİN SAT — ${ad}</b>\n` +
      `💰 Fiyat: ${closeSon.toFixed(4)} ${para}\n` +
      `⏱ Periyot: ${period} bar\n` +
      `${ok}: %${Math.abs(pct).toFixed(2)}\n` +
      `🕐 ${saat}`
    )
    console.log(`🔴 KESİN SAT: ${sembol} @ ${closeSon} | ${period} bar | %${pct.toFixed(2)}`)
  }
}

// ── Ana döngü ─────────────────────────────────────────────────────────────────

async function kontrolEt() {
  const saat = new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})
  console.log(`[${saat}] Kontrol başladı...`)

  saatKontrol()

  // XU100 endeks kontrolü
  const xu100 = await fetchYahoo('XU100.IS')
  const xu100Yukseliyor = xu100 && xu100.closes.length >= 2
    ? xu100.closes[xu100.closes.length - 1] > xu100.closes[xu100.closes.length - 2]
    : false

  for (const sembol of HISSELER) {
    const veri = await fetchYahoo(sembol)
    await sinyalKontrol(sembol, veri, '₺', xu100Yukseliyor)
  }

  for (const sembol of COINLER) {
    const veri = await fetchCoinbase(sembol)
    await sinyalKontrol(sembol, veri, '$')
  }

  console.log(`[${new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})}] Kontrol bitti.`)
}

// ── Sunucu ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.send('Sinyal botu çalışıyor ✅'))

app.get('/test', async (req, res) => {
  await sendTelegram('🧪 <b>Test mesajı</b>\nBot çalışıyor ✅')
  res.send('Telegram mesajı gönderildi')
})

app.get('/rapor', async (req, res) => {
  await gunlukRapor()
  res.send('Rapor gönderildi')
})

app.listen(3000, () => {
  console.log('Sunucu başladı')
  kontrolEt()
  setInterval(kontrolEt, 60 * 1000) // her 1 dakika
})
