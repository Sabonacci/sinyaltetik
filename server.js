const axios   = require('axios')
const express = require('express')
const fs      = require('fs')
const app     = express()

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js'
const TELEGRAM_CHAT_ID = '-1003975259428'

const HISSELER = [
  'ECILC.IS','NETCD.IS','PEKGY.IS','LMKDC.IS','TRENJ.IS',
  'GESAN.IS','EUPWR.IS','YEOTK.IS','ARTMS.IS','PCILT.IS'
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
    lastSignal:   0,
    alBar:        null,
    alPrice:      null,
    stokAltinda:  false,  // stokastik %k < 20 görüldü mü
    stokUstunde:  false   // stokastik %k > 80 görüldü mü
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

// Chebyshev filtreli RSI (önceki koddan)
function calcRSI(closes, rsiLen, smoothLen) {
  const alpha = 2.0 / (smoothLen + 1.0)

  // Cheby smooth
  const cheby = []
  let prev = closes[0]
  for (let i = 0; i < closes.length; i++) {
    prev = alpha * closes[i] + (1 - alpha) * prev
    cheby.push(prev)
  }

  const upRaw   = cheby.map((v, i) => i === 0 ? 0 : Math.max(v - cheby[i-1], 0))
  const downRaw = cheby.map((v, i) => i === 0 ? 0 : Math.max(cheby[i-1] - v, 0))

  // EMA smooth
  const upS   = emaArr(upRaw,   rsiLen)
  const downS = emaArr(downRaw, rsiLen)

  return upS.map((u, i) => {
    const d = downS[i]
    return d === 0 ? 100 : 100 - (100 / (1 + u / d))
  })
}

// Stokastik %K hesabı
function calcStoch(highs, lows, closes, kLen = 14, smoothK = 3) {
  const rawK = []
  for (let i = 0; i < closes.length; i++) {
    if (i < kLen - 1) { rawK.push(50); continue }
    const slice_h = highs.slice(i - kLen + 1, i + 1)
    const slice_l = lows.slice(i - kLen + 1,  i + 1)
    const hh = Math.max(...slice_h)
    const ll = Math.min(...slice_l)
    rawK.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100)
  }
  // %K smoothing
  const smoothed = emaArr(rawK, smoothK)
  return smoothed
}

// ── Yahoo Finance (BIST, 15dk) ────────────────────────────────────────────────

async function fetchYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=15m&range=5d`
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const q = res.data.chart.result[0].indicators.quote[0]
    const closes = q.close.map((c, i) => ({ c, h: q.high[i], l: q.low[i] }))
      .filter(x => x.c !== null && x.h !== null && x.l !== null)
    return {
      closes: closes.map(x => parseFloat(x.c.toFixed(4))),
      highs:  closes.map(x => parseFloat(x.h.toFixed(4))),
      lows:   closes.map(x => parseFloat(x.l.toFixed(4)))
    }
  } catch (err) {
    console.error(`${symbol} veri hatası: ${err.message}`)
    return null
  }
}

// ── Coinbase (15dk) ───────────────────────────────────────────────────────────

async function fetchCoinbase(symbol) {
  try {
    const coin = symbol.replace('USDT', '-USD')
    const url  = `https://api.exchange.coinbase.com/products/${coin}/candles?granularity=900`
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

  msg += `✅ <b>Tamamlanan: ${tamamlanan.length}</b>  `
  msg += `🟢 Kâr: ${karlilar.length} | 🔴 Zarar: ${zararlilar.length}\n`

  if (tamamlanan.length > 0) {
    msg += `💰 Toplam: %${toplamPct.toFixed(2)}\n\n`
    tamamlanan.forEach(i => {
      const ok = i.pct >= 0 ? '🟢 ▲' : '🔴 ▼'
      msg += `${ok} <b>${i.sembol}</b>  Al:${i.alFiyat} → Sat:${i.satFiyat}  %${i.pct.toFixed(2)}\n`
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
  if (simdi.startsWith('18:30')) gunlukRapor()
}

// ── Sinyal motoru ─────────────────────────────────────────────────────────────

async function sinyalKontrol(sembol, veri, para, xu100Yukseliyor = true) {
  if (!veri || veri.closes.length < 50) return

  const { closes, highs, lows } = veri
  const d   = durum[sembol]
  const n   = closes.length - 1
  const ad  = sembol.replace('.IS','').replace('USDT','')

  // RSI hesabı
  const rsiDizi  = calcRSI(closes, 14, 3)
  const rsiSon   = rsiDizi[n]

  // Stokastik %K hesabı
  const stokDizi = calcStoch(highs, lows, closes, 14, 3)
  const stokSon  = stokDizi[n]

  const closeSon = closes[n]
  const saat     = new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})

  // Stokastik eşik hafızası güncelle
  if (stokSon < 20) d.stokAltinda = true
  if (stokSon > 80) d.stokUstunde = true

  // AL şartı: stok < 20 görüldü VE rsi < 30 VE xu100 yükseliyor (sadece hisseler)
  const alSart = d.stokAltinda && rsiSon < 30 && xu100Yukseliyor

  // SAT şartı: stok > 80 görüldü VE rsi > 70
  const satSart = d.lastSignal === 1 && d.stokUstunde && rsiSon > 70

  // AL sinyali
  if (alSart && d.lastSignal !== 1) {
    d.lastSignal  = 1
    d.alBar       = n
    d.alPrice     = closeSon
    d.stokAltinda = false  // sıfırla

    gunlukIslemler.push({ sembol: ad, alFiyat: closeSon.toFixed(4), satFiyat: null, period: 0, pct: 0, para })
    islemleriKaydet()

    await sendTelegram(
      `🟢 <b>AL — ${ad}</b>\n` +
      `💰 Fiyat: ${closeSon.toFixed(4)} ${para}\n` +
      `📊 RSI: ${rsiSon.toFixed(1)} | Stok%K: ${stokSon.toFixed(1)}\n` +
      `🕐 ${saat}`
    )
    console.log(`✅ AL: ${sembol} @ ${closeSon} | RSI:${rsiSon.toFixed(1)} | Stok:${stokSon.toFixed(1)}`)
  }

  // SAT sinyali
  if (satSart && d.lastSignal !== -1) {
    const period = n - d.alBar
    const pct    = ((closeSon - d.alPrice) / d.alPrice * 100)
    const ok     = pct >= 0 ? '🟢 ▲ KAR' : '🔴 ▼ ZARAR'

    d.lastSignal  = -1
    d.stokUstunde = false  // sıfırla

    const idx = gunlukIslemler.findIndex(i => i.sembol === ad && i.satFiyat === null)
    if (idx !== -1) {
      gunlukIslemler[idx].satFiyat = closeSon.toFixed(4)
      gunlukIslemler[idx].period   = period
      gunlukIslemler[idx].pct      = pct
    }
    islemleriKaydet()

    await sendTelegram(
      `🔴 <b>SAT — ${ad}</b>\n` +
      `💰 Fiyat: ${closeSon.toFixed(4)} ${para}\n` +
      `📊 RSI: ${rsiSon.toFixed(1)} | Stok%K: ${stokSon.toFixed(1)}\n` +
      `⏱ Periyot: ${period} bar\n` +
      `${ok}: %${Math.abs(pct).toFixed(2)}\n` +
      `🕐 ${saat}`
    )
    console.log(`🔴 SAT: ${sembol} @ ${closeSon} | ${period} bar | %${pct.toFixed(2)}`)
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
  setInterval(kontrolEt, 15 * 60 * 1000)
})
