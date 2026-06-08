const axios = require('axios')
const express = require('express')
const app = express()

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js'
const TELEGRAM_CHAT_ID = '5756145019'


async function tradingViewTarama() {
  try {
    const url = 'https://scanner.tradingview.com/turkey/scan'
    
    const payload = {
      markets: ['turkey'],
      symbols: { query: { types: [] }, tickers: [] },
      options: { lang: 'tr' },
      columns: [
        'name',                  // d[0] -> Hisse Kodu
        'close',                 // d[1] -> Canlı Fiyat
        'RSI',                   // d[2] -> RSI (14)
        'RSI7',                  // d[3] -> RSI (7)
        'P.SAR',                 // d[4] -> Parabolic SAR
        'ChaikinMoneyFlow',      // d[5] -> CMF (20)
        'HullMA9',               // d[6] -> Hull HO (9)
        'open',                  // d[7] -> Açılış
        'Stoch.RSI.K',           // d[8] -> Stokastik RSI K
        'Stoch.RSI.D',           // d[9] -> Stokastik RSI D
        'Ichimoku.KijunSen',     // d[10] -> Ichimoku Base Line (Kijun-sen)
        'Pivot.D.Classic.Pivot'  // d[11] -> Klasik Günlük Pivot (P)
      ],
      filter: [
        { left: 'RSI', operation: 'in_range', right: [45, 65] },
        { left: 'RSI7', operation: 'less', right: 70 },
        { left: 'P.SAR', operation: 'below', right: 'close' },
        { left: 'ChaikinMoneyFlow', operation: 'in_range', right: [-0.2, 0.3] },
        { left: 'HullMA9', operation: 'below', right: 'close' },
        { left: 'close', operation: 'greater', right: 'open' },
        { left: 'Stoch.RSI.K', operation: 'greater', right: 'Stoch.RSI.D' },
        { left: 'Ichimoku.KijunSen', operation: 'below', right: 'close' },
        { left: 'Pivot.D.Classic.Pivot', operation: 'below', right: 'close' }
      ],
      sort: { sortBy: 'name', sortOrder: 'asc' },
      range: [0, 1000] // Tüm BIST hisselerini (BIST TÜM) kapsar
    }

    const res = await axios.post(url, payload, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
      },
      timeout: 15000
    })

    if (!res.data || !res.data.data) return []

    // Gelen verileri filtreleyerek objeye dönüştür
    return res.data.data.map(h => {
      // Temel fiyat veya isim verisi boşsa atla
      if (!h.d || h.d[0] === null || h.d[1] === null) return null

      return {
        sembol: h.d[0],
        fiyat: h.d[1],
        rsi14: h.d[2],
        rsi7: h.d[3],
        sar: h.d[4],
        cmf: h.d[5],
        hma: h.d[6],
        stochK: h.d[8],
        stochD: h.d[9],
        kijun: h.d[10],
        pivot: h.d[11]
      }
    }).filter(x => x !== null)

  } catch (err) {
    console.error('TradingView tarama hatası:', err.message)
    return []
  }
}
