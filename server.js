const axios   = require('axios')
const express = require('express')
const fs      = require('fs')
const app     = express()

// Telegram'dan gelen Webhook isteklerini (JSON) okuyabilmek için şarttır
app.use(express.json())

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js'
const TELEGRAM_CHAT_ID = '5756145019'

const HISSELER = [
  'EREGL.IS', 'ARFYE.IS', 'ARDYZ.IS', 'ORCAY.IS', 'OBAMS.IS', 'CIMSA.IS',
  'THYAO.IS', 'ASELS.IS', 'SISE.IS', 'ENJSA.IS', 'GESAN.IS', 'TRMET.IS', 'TRENJ.IS', 'TRALT.IS'
]

const DOSYA = '/tmp/islemler.json'
const DURUM_DOSYASI = '/tmp/durum.json'

function islemleriYukle() {
  try {
    if (fs.existsSync(DOSYA)) return JSON.parse(fs.readFileSync(DOSYA, 'utf8'))
  } catch(e) {}
  return []
}

function islemleriKaydet() {
  try { fs.writeFileSync(DOSYA, JSON.stringify(gunlukIslemler)) } catch(e) {}
}

// ── Sinyal Durumu Kaydetme ve Yükleme Fonksiyonları ─────────────────────────

function durumYukle() {
  try {
    if (fs.existsSync(DURUM_DOSYASI)) {
      return JSON.parse(fs.readFileSync(DURUM_DOSYASI, 'utf8'))
    }
  } catch(e) {
    console.error('Durum yükleme hatası:', e.message)
  }
  return {}
}

function durumKaydet() {
  try {
    fs.writeFileSync(DURUM_DOSYASI, JSON.stringify(durum))
  } catch(e) {
    console.error('Durum kaydetme hatası:', e.message)
  }
}

var gunlukIslemler = islemleriYukle()

// Kalıcı durum objesini yüklüyoruz
const durum = durumYukle()
HISSELER.forEach(h => {
  if (!durum[h]) durum[h] = { lastSignalBarTime: null }
})

// ── İndikatör Hesaplama Fonksiyonları ───────────────────────────────────────

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

function hmaArr(closes, len = 9) {
  if (!closes || closes.length < len) return new Array(closes ? closes.length : 0).fill(null)

  const halfLen = Math.floor(len / 2)
  const sqrtLen = Math.round(Math.sqrt(len))

  const wmaHalf = wmaArr(closes, halfLen)
  const wmaFull = wmaArr(closes, len)

  const diffArr = closes.map((_, i) => {
    if (wmaHalf[i] === null || wmaFull[i] === null) return null
    return 2 * wmaHalf[i] - wmaFull[i]
  })

  const validIndices = []
  const validDiffs = []
  diffArr.forEach((v, i) => {
    if (v !== null) {
      validIndices.push(i)
      validDiffs.push(v)
    }
  })

  const hmaValid = wmaArr(validDiffs, sqrtLen)
  const result = new Array(closes.length).fill(null)

  hmaValid.forEach((v, i) => {
    if (v !== null) {
      result[validIndices[i]] = v
    }
  })

  return result
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

function stochArr(highs, lows, closes, period = 14, kSmooth = 1, dSmooth = 3) {
  const kRaw = new Array(closes.length).fill(null)
  
  for (let i = period - 1; i < closes.length; i++) {
    const hSlice = highs.slice(i - period + 1, i + 1)
    const lSlice = lows.slice(i - period + 1, i + 1)
    const maxH = Math.max(...hSlice)
    const minL = Math.min(...lSlice)
    
    kRaw[i] = maxH === minL ? 50 : ((closes[i] - minL) / (maxH - minL)) * 100
  }

  const validK = kRaw.filter(v => v !== null)
  const smaK = smaArr(validK, kSmooth)
  const smaD = smaArr(smaK.filter(v => v !== null), dSmooth)

  const K = new Array(closes.length).fill(null)
  const D = new Array(closes.length).fill(null)

  let idxK = 0, idxD = 0
  for (let i = 0; i < closes.length; i++) {
    if (kRaw[i] !== null) {
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

// ── Veri Çekme Fonksiyonu ───────────────────────────────────────────────────

async function fetchYahooDaily(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`
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

  const stoch = stochArr(highs, lows, closes, 14, 1, 3)
  const kSon = stoch.K[n]
  const dSon = stoch.D[n]

  const baseLine = ichimokuBaseLine(highs, lows, 26)[n]

  const prevHigh = highs[n - 1]
  const prevLow  = lows[n - 1]
  const prevClose = closes[n - 1]
  const pivot = (prevHigh + prevLow + prevClose) / 3

  const c1 = rsi14 >= 45 && rsi14 <= 65
  const c2 = rsi7 <= 70
  const c3 = sar < f
  const c4 = cmf20 >= 0.01 && cmf20 <= 0.3
  const c5 = typeof hma9 === 'number' && hma9 < f
  const c6 = f > o
  const c7 = (stoch.K[n - 1] <= stoch.D[n - 1]) && (kSon > dSon)
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

// ── Panel Tarzı Rapor Kartı Oluşturucu ────────────────────────────────────────

function raporKartiOlustur(a) {
  const kriterler = [
    { no: 1, ad: 'RSI (14)', val: `${a.rsi14.val ? a.rsi14.val.toFixed(1) : '-'} (45-65)`, ok: a.rsi14.ok },
    { no: 2, ad: 'RSI (7)', val: `${a.rsi7.val ? a.rsi7.val.toFixed(1) : '-'} (&lt;=70)`, ok: a.rsi7.ok },
    { no: 3, ad: 'Parabolic SAR', val: `${a.sar.val ? a.sar.val.toFixed(2) : '-'} (&lt; Fiyat)`, ok: a.sar.ok },
    { no: 4, ad: 'CMF (20)', val: `${a.cmf20.val ? a.cmf20.val.toFixed(3) : '-'} (0.01-0.30)`, ok: a.cmf20.ok },
    { no: 5, ad: 'Hull MA (9)', val: `${a.hma9.val !== null && a.hma9.val !== undefined ? a.hma9.val.toFixed(2) : '-'} (&lt; Fiyat)`, ok: a.hma9.ok },
    { no: 6, ad: 'Fiyat/Açılış', val: `${a.fiyat.toFixed(2)} &gt; ${a.acilis.toFixed(2)}`, ok: a.fiyatAcilis.ok },
    { no: 7, ad: 'Stokastik K/D', val: `K:${a.stochRsi.kSon !== null ? a.stochRsi.kSon.toFixed(1) : '-'} / D:${a.stochRsi.dSon !== null ? a.stochRsi.dSon.toFixed(1) : '-'}`, ok: a.stochRsi.ok },
    { no: 8, ad: 'Base Line', val: `${a.baseLine.val ? a.baseLine.val.toFixed(2) : '-'} (&lt; Fiyat)`, ok: a.baseLine.ok },
    { no: 9, ad: 'Pivot Noktası', val: `${a.pivot.val ? a.pivot.val.toFixed(2) : '-'} (&lt; Fiyat)`, ok: a.pivot.ok }
  ]

  const basariliSayi = kriterler.filter(k => k.ok).length
  const yuzde = Math.round((basariliSayi / 9) * 100)

  const dijitKutulari = '🟩'.repeat(basariliSayi) + '🟥'.repeat(9 - basariliSayi)

  const toplamBar = 10
  const doluBar = Math.round((basariliSayi / 9) * toplamBar)
  const ilerlemeBari = '█'.repeat(doluBar) + '░'.repeat(toplamBar - doluBar)

  let r = `🎛️ <b>PANEL ANALİZİ: ${a.sembol}</b>\n`
  r += `━━━━━━━━━━━━━━━━━━━━\n`
  r += `📊 <b>SKOR :</b> [${dijitKutulari}] <b>${basariliSayi} / 9</b>\n`
  r += `📈 <b>BARS :</b> <code>[${ilerlemeBari}] %${yuzde}</code>\n`
  r += `💰 <b>FİYAT:</b> <b>${a.fiyat.toFixed(2)} ₺</b> (Açılış: ${a.acilis.toFixed(2)} ₺)\n`
  r += `━━━━━━━━━━━━━━━━━━━━\n`

  kriterler.forEach(k => {
    const ikon = k.ok ? '🟢' : '🔴'
    r += `[${k.no}] ${ikon} <b>${k.ad}:</b> <code>${k.val}</code>\n`
  })

  r += `━━━━━━━━━━━━━━━━━━━━\n`
  
  if (a.hepsiTamam) {
    r += `STATUS: 🚀 <b>9/9 MÜKEMMEL AL SİNYALİ</b>\n`
  } else {
    r += `STATUS: ⏳ <b>${basariliSayi}/9 KOŞUL SAĞLANDI</b>\n`
  }

  return r
}

// ── Düzeltilmiş Sinyal Motoru ───────────────────────────────────────────────

async function sinyalKontrol(sembol) {
  const a = await hisseAnaliziGetir(sembol)
  if (!a) return

  // Bugünün tarihini alıyoruz (Örn: "2026-03-30")
  const bugun = new Date().toISOString().split('T')[0]

  if (a.hepsiTamam) {
    if (!durum[sembol]) durum[sembol] = { lastSignalBarTime: null }
    
    // Eğer bugünün barı için zaten sinyal gönderildiyse pas geç
    if (durum[sembol].lastSignalBarTime === bugun) {
      return
    }

    // Sinyal gününü güncelle ve dosyaya kaydet
    durum[sembol].lastSignalBarTime = bugun
    durumKaydet()

    const dijitKutulari = '🟩'.repeat(9)

    const msg = 
      `🚀 <b>STRATEJİ SİNYALİ VERDİ: ${a.sembol}</b>\n\n` +
      `📊 <b>SKOR :</b> [${dijitKutulari}] <b>9 / 9</b>\n` +
      `💰 <b>Fiyat:</b> <b>${a.fiyat.toFixed(2)} ₺</b> (Açılış: ${a.acilis.toFixed(2)} ₺)\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ <b>RSI (14):</b> ${a.rsi14.val ? a.rsi14.val.toFixed(1) : '-'}\n` +
      `✅ <b>RSI (7):</b> ${a.rsi7.val ? a.rsi7.val.toFixed(1) : '-'}\n` +
      `✅ <b>Parabolic SAR:</b> ${a.sar.val ? a.sar.val.toFixed(2) : '-'} (&lt; Fiyat)\n` +
      `✅ <b>CMF (20):</b> ${a.cmf20.val ? a.cmf20.val.toFixed(3) : '-'}\n` +
      `✅ <b>Hull MA (9):</b> ${a.hma9.val !== null && a.hma9.val !== undefined ? a.hma9.val.toFixed(2) : '-'} (&lt; Fiyat)\n` +
      `✅ <b>Fiyat &gt; Açılış:</b> ${a.fiyat.toFixed(2)} &gt; ${a.acilis.toFixed(2)}\n` +
      `✅ <b>Stokastik:</b> K (${a.stochRsi.kSon ? a.stochRsi.kSon.toFixed(1) : '-'}) ▲ D (${a.stochRsi.dSon ? a.stochRsi.dSon.toFixed(1) : '-'})\n` +
      `✅ <b>Ichimoku Base Line:</b> ${a.baseLine.val ? a.baseLine.val.toFixed(2) : '-'} (&lt; Fiyat)\n` +
      `✅ <b>Pivot:</b> ${a.pivot.val ? a.pivot.val.toFixed(2) : '-'} (&lt; Fiyat)\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🕐 ${new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})}`

    await sendTelegram(msg)
    console.log(`✅ SİNYAL GÖNDERİLDİ: ${a.sembol}`)
  }
}

async function kontrolEt() {
  for (const sembol of HISSELER) {
    await sinyalKontrol(sembol)
  }
}

// ── Express Sunucu ve Webhook Rotası ─────────────────────────────────────────

app.get('/', (req, res) => res.send('Teknik Analiz Botu Çalışıyor ✅'))

app.post('/webhook', async (req, res) => {
  // 1. Telegram'a ANINDA cevap ver ki zaman aşımına (Timeout) uğramasın!
  res.sendStatus(200)

  try {
    const message = req.body?.message
    if (message && message.text) {
      let gelenMetin = message.text.trim().toUpperCase()
      const chatId = message.chat.id

      // 1. Tümü İçin Test Raporu Komutu (/test veya test)
      if (gelenMetin === 'TEST' || gelenMetin === '/TEST') {
        await sendTelegram(`⏳ <b>Sistem Taraması Başlatıldı...</b>\nTakipteki ${HISSELER.length} hisse paralel olarak analiz ediliyor.`, chatId)

        // Hisseleri sırayla çekmek yerine PARALEL olarak aynı anda çekiyoruz (Çok daha hızlı)
        const analizSözleri = HISSELER.map(sembol => hisseAnaliziGetir(sembol))
        const sonuçlar = await Promise.all(analizSözleri)

        // Hatalı veya veri gelmeyen hisseleri eliyoruz
        const geçerliAnalizler = sonuçlar.filter(a => a !== null)

        let mesajParcasi = `🔍 <b>TELEGRAM TEST RAPORU</b>\n🕐 ${new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})}\n\n`

        for (const a of geçerliAnalizler) {
          const kart = raporKartiOlustur(a)

          // Telegram 4096 karakter sınırını aşmamak için parça parça gönderim
          if ((mesajParcasi + kart).length > 3800) {
            await sendTelegram(mesajParcasi, chatId)
            mesajParcasi = `🔍 <b>TEST RAPORU (Devam)</b>\n\n` + kart
          } else {
            mesajParcasi += kart
          }
        }

        if (mesajParcasi.length > 0) {
          await sendTelegram(mesajParcasi, chatId)
        }
      } 
      // 2. Özel Hisse Sorgulama
      else {
        let sembol = gelenMetin.replace('/HISSE', '').trim()
        
        if (sembol.length > 0 && !sembol.startsWith('/')) {
          if (!sembol.endsWith('.IS')) {
            sembol = `${sembol}.IS`
          }

          await sendTelegram(`⏳ <b>${sembol.replace('.IS', '')}</b> verileri çekiliyor...`, chatId)

          const a = await hisseAnaliziGetir(sembol)

          if (!a) {
            await sendTelegram(`❌ <b>Hata:</b> <code>${sembol.replace('.IS', '')}</code> sembolü için veri bulunamadı veya yetersiz geçmiş veri var. Lütfen hisse kodunu kontrol edin.`, chatId)
          } else {
            const mesaj = `🔍 <b>ÖZEL HİSSE ANALİZİ: ${a.sembol}</b>\n🕐 ${new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})}\n\n` + raporKartiOlustur(a)
            await sendTelegram(mesaj, chatId)
          }
        }
      }
    }
  } catch (err) {
    console.error('Webhook işleme hatası:', err.message)
  }
})
