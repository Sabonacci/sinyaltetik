const axios = require('axios')
const express = require('express')
const app = express()

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js'
const TELEGRAM_CHAT_ID = '5756145019'


// ── TradingView Tarayıcı Motoru ──────────────────────────────────────────────

async function tradingViewTarama() {
  try {
    const url = 'https://scanner.tradingview.com/turkey/scan'
    
    // TradingView'a gönderilecek filtre ve indikatör talebi paketi
    const payload = {
      markets: ['turkey'],
      symbols: { query: { types: [] }, tickers: [] },
      options: { lang: 'tr' },
      // Çıktı olarak almak istediğimiz sütunlar (kodun içindeki h.d[X] sıralamasıdır)
      columns: [
        'name',           // d[0] - Kısa Kod (Örn: THYAO)
        'close',          // d[1] - Son Canlı Fiyat
        'RSI',            // d[2] - RSI (14)
        'RSI7',           // d[3] - RSI (7)
        'P.SAR',          // d[4] - Parabolic SAR
        'ChaikinMoneyFlow',// d[5] - CMF (20)
        'HullMA9',        // d[6] - HMA (9)
        'open',           // d[7] - Günlük Açılış Fiyatı
        'Stoch.RSI.K',    // d[8] - Stoch RSI K
        'Stoch.RSI.D',    // d[9] - Stoch RSI D
        'Ichimoku.BLine', // d[10] - Ichimoku Kijun-sen
        'Pivot.M.Classic.S3' // d[11] - Pivot hesabı için örnek baz veri (Aşağıda filtreleniyor)
      ],
      // SENİN KRİTERLERİN: Filtreleri TradingView sunucusunda yapıyoruz
      filter: [
        { left: 'RSI', operation: 'in_range', right: [45, 65] }, // RSI14 45-65 arası
        { left: 'RSI7', operation: 'less_or_equal', right: 70 }, // RSI7 <= 70
        { left: 'P.SAR', operation: 'below', right: 'close' },   // SAR fiyatın altında
        { left: 'ChaikinMoneyFlow', operation: 'in_range', right: [-0.2, 0.3] }, // CMF -0.2 ile 0.3 arası
        { left: 'HullMA9', operation: 'below', right: 'close' }, // HMA9 fiyatın altında
        { left: 'close', operation: 'greater', right: 'open' },  // Canlı Fiyat > Açılış
        { left: 'Stoch.RSI.K', operation: 'greater', right: 'Stoch.RSI.D' }, // Stoch K > D
        { left: 'Ichimoku.BLine', operation: 'below', right: 'close' } // Kijun-sen fiyatın altında
      ],
      sort: { sortBy: 'name', sortOrder: 'asc' },
      range: [0, 500] // Tek seferde BIST'teki ilk 500 hisseyi tara
    }

    const res = await axios.post(url, payload, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    })

    if (!res.data || !res.data.data) return []

    // Gelen ham veriyi anlamlı bir nesne dizisine dönüştürüyoruz
    const bulunanlar = res.data.data.map(h => {
      // Klasik günlük pivot formülü: (Dünün En Yüksek + Dünün En Düşük + Dünün Kapanış) / 3
      // TradingView pivot değerini doğrudan vermediğinde canlı fiyata göre basit bir pivot süzgeci ekliyoruz
      const fiyat = h.d[1]
      const pivot = h.d[11] // Pivot referans noktası
      
      // Pivot < Fiyat ek kontrolü (Eğer Pivot verisi yoksa es geçmesi için true kabul edilir)
      const pivotGecti = !pivot || pivot < fiyat

      if (!pivotGecti) return null

      return {
        sembol: h.d[0],
        fiyat: fiyat,
        rsi14: h.d[2],
        rsi7: h.d[3],
        cmf: h.d[5],
        sar: h.d[4],
        hma: h.d[6],
        stochK: h.d[8],
        stochD: h.d[9],
        kijun: h.d[10],
        pivot: pivot || 0
      }
    }).filter(x => x !== null)

    return bulunanlar

  } catch (err) {
    console.error('TradingView tarama hatası:', err.message)
    return []
  }
}

// ── Telegram Bildirim Motoru ──────────────────────────────────────────────────

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

// ── Tarama Yürütücü Ana Fonksiyon ─────────────────────────────────────────────

async function taramaBaslat() {
  const saat  = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })
  const tarih = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
  console.log(`[${saat}] TradingView üzerinden 500+ BIST hissesinin taranması başladı...`)

  const bulunanlar = await tradingViewTarama()

  console.log(`[${new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })}] Tarama bitti. ${bulunanlar.length} hisse kriterleri sağladı.`)

  if (bulunanlar.length === 0) {
    await sendTelegram(`🔍 <b>TARAMA SONUCU — ${tarih}</b>\n🕐 ${saat} | Günlük (1D)\n━━━━━━━━━━━━━━━━━━━━\n❌ 500+ BIST hissesi arasından kriterleri karşılayan hiçbir şirket bulunamadı.`)
    return
  }

  // Telegram karakter sınırına (4096) takılmamak için sonuçları chunk (parça) halinde gönderiyoruz
  const chunkSize = 8 // Her mesajda en fazla 8 hisse raporla
  for (let i = 0; i < bulunanlar.length; i += chunkSize) {
    const chunk = bulunanlar.slice(i, i + chunkSize)
    
    let msg = `🔍 <b>TV BIST TARAMASI — ${tarih} (${i + 1}-${Math.min(i + chunkSize, bulunanlar.length)})</b>\n`
    msg    += `🕐 ${saat} | Günlük (1D) Canlı Veri\n`
    msg    += `━━━━━━━━━━━━━━━━━━━━\n`
    msg    += `✅ <b>Toplam ${bulunanlar.length} hisse tüm kriterleri geçti</b>\n\n`

    chunk.forEach(h => {
      msg += `📌 <b>${h.sembol}</b> — ${h.fiyat.toFixed(2)} ₺\n`
      msg += `   ✅ RSI14: ${h.rsi14 ? h.rsi14.toFixed(1) : '-'} | RSI7: ${h.rsi7 ? h.rsi7.toFixed(1) : '-'} | CMF: ${h.cmf ? h.cmf.toFixed(3) : '-'}\n`
      msg += `   ✅ SAR: ${h.sar ? h.sar.toFixed(2) : '-'} | HMA: ${h.hma ? h.hma.toFixed(2) : '-'}\n`
      msg += `   ✅ StochK: ${h.stochK ? h.stochK.toFixed(1) : '-'} > D: ${h.stochD ? h.stochD.toFixed(1) : '-'} | Kijun: ${h.kijun ? h.kijun.toFixed(2) : '-'}\n`
      msg += `   ✅ Fiyat > Açılış ✓\n\n`
    })

    msg += `━━━━━━━━━━━━━━━━━━━━`
    await sendTelegram(msg)
    // Telegram API'yi spamlememek için mesaj aralarında hafif bekleme
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  console.log('📨 Tüm tarama raporları parça halinde Telegram\'a iletildi.')
}

// ── Çalışma Saatleri Kontrolü (09:30–18:30) ───────────────────────────────────

function borsaAcikMi() {
  const simdi = new Date()
  const tr = new Date(simdi.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }))
  const gun  = tr.getDay()
  const dakika = tr.getHours() * 60 + tr.getMinutes()

  if (gun === 0 || gun === 6) return false
  return dakika >= 9 * 60 + 30 && dakika <= 18 * 60 + 30
}

// ── Telegram Canlı Komut Dinleyicisi (Long Polling) ──────────────────────────

let lastUpdateId = 0
async function telegramDinle() {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`
    const res = await axios.get(url, { timeout: 35000 })
    
    if (res.data && res.data.result.length > 0) {
      for (const update of res.data.result) {
        lastUpdateId = update.update_id

        if (update.message && update.message.text) {
          const mesajMetni = update.message.text.trim()
          const gelenChatId = update.message.chat.id.toString()

          if (mesajMetni === '/tara' && gelenChatId === TELEGRAM_CHAT_ID) {
            await sendTelegram('⏳ <b>TradingView entegrasyonu devrede.</b> 500+ BIST hissesi tek bir saniyede taranıyor, lütfen bekleyin...');
            await taramaBaslat()
          }
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ECONNABORTED') console.error('Telegram hatası:', err.message)
  }
  setTimeout(telegramDinle, 1000)
}

// ── Sunucu Kurulumu ───────────────────────────────────────────────────────────

app.get('/', (req, res) => res.send('TradingView Canlı Tarama Botu Aktif ✅'))
app.get('/tara', async (req, res) => { await taramaBaslat(); res.send('Manuel tarama tetiklendi.') })

app.listen(3000, () => {
  console.log('🚀 TradingView Akıllı Tarama Botu Başlatıldı!')
  telegramDinle()

  if (borsaAcikMi()) taramaBaslat()

  setInterval(() => {
    if (borsaAcikMi()) {
      taramaBaslat()
    } else {
      console.log(`[${new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })}] Borsa kapalı, otomatik tarama pas geçildi.`)
    }
  }, 15 * 60 * 1000)
})
