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
        'name',
        'close',
        'RSI',
        'RSI7',
        'P.SAR',
        'ChaikinMoneyFlow',
        'HullMA9',
        'open',
        'Stoch.RSI.K',
        'Stoch.RSI.D',
        'Ichimoku.KijunSen',
        'Pivot.D.Classic.Pivot'
      ],
      // ⚠️ ADIM 1: Filtreleri geçici olarak sadeleştiriyoruz.
      // Eğer bu şekilde çalışırsa, arayüzdeki diğer katı filtreleri sırayla ekleyerek hangisinin sıfırladığını bulacağız.
      filter: [
        { left: 'RSI', operation: 'in_range', right: [45, 65] },
        { left: 'close', operation: 'greater', right: 'open' }
      ],
      sort: { sortBy: 'name', sortOrder: 'asc' },
      range: [0, 1000]
    }

    console.log("🔄 TradingView API'sine istek atılıyor...")
    const res = await axios.post(url, payload, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
      },
      timeout: 15000
    })

    if (!res.data || !res.data.data) {
      console.log("⚠️ TradingView boş data döndü.")
      return []
    }

    console.log(`📊 Ham filtreleme sonucu ${res.data.data.length} hisse döndü. Kod içi süzgeçler uygulanıyor...`)

    // Gelen verileri harita out et ve null kontrollerini logla
    const sonuclar = res.data.data.map(h => {
      if (!h.d || h.d[0] === null || h.d[1] === null) return null

      const hisse = {
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

      // ⚠️ ADIM 2: Kod içinde manuel kontrol simülasyonu yapıyoruz (Katı filtre koruması)
      // TradingView'ın "below" veya "greater" çalıştırırken hata yapma ihtimaline karşı filtreyi JS tarafında denetliyoruz.
      // Eğer bu kriterlerden biri uymuyorsa, hangisinde elendiğini konsola yazdırabilirsin.
      
      const rsi7Gecti   = hisse.rsi7 !== null && hisse.rsi7 <= 70
      const sarGecti    = hisse.sar !== null && hisse.sar < hisse.fiyat
      const cmfGecti    = hisse.cmf !== null && hisse.cmf >= -0.2 && hisse.cmf <= 0.3
      const hmaGecti    = hisse.hma !== null && hisse.hma < hisse.fiyat
      const stochGecti  = hisse.stochK !== null && hisse.stochD !== null && hisse.stochK > hisse.stochD
      const kijunGecti  = hisse.kijun !== null && hisse.kijun < hisse.fiyat
      const pivotGecti  = hisse.pivot !== null && hisse.pivot < hisse.fiyat

      // Debug için: Tüm ağır filtreleri burada tek tek süzüyoruz
      if (rsi7Gecti && sarGecti && cmfGecti && hmaGecti && stochGecti && kijunGecti && pivotGecti) {
        return hisse
      }

      return null
    }).filter(x => x !== null)

    return sonuclar

  } catch (err) {
    console.error('TradingView tarama hatası:', err.message)
    return []
  }
}
