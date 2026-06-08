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
        'name',               // d[0]
        'close',              // d[1]
        'RSI',                // d[2]
        'RSI7',               // d[3]
        'P.SAR',              // d[4]
        'ChaikinMoneyFlow',   // d[5]
        'HullMA9',            // d[6]
        'open',               // d[7]
        'Stoch.RSI.K',        // d[8]
        'Stoch.RSI.D',        // d[9]
        'Ichimoku.BLine',     // d[10]
        'Pivot.M.Classic.Pivot' // d[11] -> Günlük ana pivot seviyesi
      ],
      filter: [
        { left: 'RSI', operation: 'in_range', right: [45, 65] },
        { left: 'RSI7', operation: 'less_or_equal', right: 70 },
        { left: 'P.SAR', operation: 'below', right: 'close' },
        { left: 'ChaikinMoneyFlow', operation: 'in_range', right: [-0.2, 0.3] },
        { left: 'HullMA9', operation: 'below', right: 'close' },
        { left: 'close', operation: 'greater', right: 'open' },
        { left: 'Stoch.RSI.K', operation: 'greater', right: 'Stoch.RSI.D' },
        { left: 'Ichimoku.BLine', operation: 'below', right: 'close' },
        { left: 'Pivot.M.Classic.Pivot', operation: 'below', right: 'close' } // Pivot < Fiyat filtresini TV sunucusuna taşıdık
      ],
      sort: { sortBy: 'name', sortOrder: 'asc' },
      range: [0, 1000] // Garanti olsun diye BIST'teki tüm hisse ve endeksleri (1000 limit) kapsama alıyoruz
    }

    const res = await axios.post(url, payload, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    })

    if (!res.data || !res.data.data) return []

    // Gelen veriyi eşleme
    return res.data.data.map(h => {
      // Eğer zorunlu alanlardan biri boş geldiyse bu hisseyi atla (Çökmeyi önler)
      if (h.d[1] === null || h.d[2] === null) return null;

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
