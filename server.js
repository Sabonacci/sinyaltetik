const axios = require('axios');
const express = require('express');
const app = express();

const TELEGRAM_TOKEN   = '8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js';      // Kendi tokeninizle değiştirin
const TELEGRAM_CHAT_ID = '-1003975259428';        // Kendi chat ID'nizle değiştirin

// Takip edilecek hisseler ve coinler
const HISSELER = [
  'ECILC.IS', 'SUWEN.IS', 'PEKGY.IS', 'LMKDC.IS', 'TRENJ.IS',
  'GESAN.IS', 'EUPWR.IS', 'MAKIM.IS', 'ARENA.IS', 'PATEK.IS'
];

const COINLER = [
  'BTCUSDT', 'XRPUSDT', 'DASHUSDT', 'SOLUSDT',
  'ETHUSDT', 'ETHFIUSDT', 'POLUSDT'
];

// Durum takibi: her sembol için son sinyal tipi (1: AL, -1: SAT, 0: bekliyor) ve alış fiyatı
const durum = {};
[...HISSELER, ...COINLER].forEach(sembol => {
  durum[sembol] = {
    lastSignal: 0,   // 0: sinyal yok, 1: alış pozisyonu açık, -1: satış pozisyonu açık (veya bekleme)
    alPrice: null
  };
});

// ------------------- YARDIMCI FONKSİYONLAR -------------------
function emaArr(closes, period) {
  if (!closes || closes.length === 0) return [];
  const k = 2 / (period + 1);
  const ema = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

// ------------------- VERİ ÇEKME -------------------
// Yahoo Finance (BIST hisseleri) - 5 dakikalık, son 5 gün
async function fetchYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=5d`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const closes = res.data.chart.result[0].indicators.quote[0].close;
    return closes.filter(c => c !== null && c !== undefined).map(c => parseFloat(c.toFixed(4)));
  } catch (err) {
    console.error(`${symbol} Yahoo hatası: ${err.message}`);
    return null;
  }
}

// Binance (coinler) - son 200 adet 5 dakikalık kapanış
async function fetchBinance(symbol) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=200`;
    const res = await axios.get(url);
    return res.data.map(k => parseFloat(k[4])); // kapanış fiyatı
  } catch (err) {
    console.error(`${symbol} Binance hatası: ${err.message}`);
    return null;
  }
}

// ------------------- TELEGRAM MESAJ -------------------
async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: msg,
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error('Telegram hatası:', err.message);
  }
}

// ------------------- HIZLI SİNYAL MANTIĞI (EMA 5/13) -------------------
async function sinyalKontrol(sembol, closes, paraBirimi) {
  if (!closes || closes.length < 20) {
    // Yeterli veri yoksa bekle
    return;
  }

  const d = durum[sembol];
  const n = closes.length - 1;

  // EMA hesaplamaları (sadece son 2 değer yeterli, ama emaArr tüm seriyi döndürür)
  const ema5Tum = emaArr(closes, 5);
  const ema13Tum = emaArr(closes, 13);
  const ema5 = ema5Tum[n];
  const ema13 = ema13Tum[n];
  const oncekiEma5 = ema5Tum[n - 1];
  const oncekiEma13 = ema13Tum[n - 1];

  // AL koşulu: EMA5 EMA13'ü yukarı kesmiş (önceki barda kesişme yoktu, şimdi var) VE fiyat EMA5'in üstünde
  const alSart = (oncekiEma5 <= oncekiEma13) && (ema5 > ema13) && (closes[n] > ema5);

  // SAT koşulu: Sadece AL sinyali alınmışsa (pozisyon açıksa) ve EMA5 EMA13'ü aşağı kesmiş
  const satSart = (d.lastSignal === 1) && (oncekiEma5 >= oncekiEma13) && (ema5 < ema13) && (closes[n] < ema5);

  const saat = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const ad = sembol.replace('.IS', '').replace('USDT', '');

  // AL sinyali
  if (alSart && d.lastSignal !== 1) {
    d.lastSignal = 1;
    d.alPrice = closes[n];

    const mesaj = `🟢 <b>AL — ${ad}</b>\n` +
                  `💰 Fiyat: ${closes[n].toFixed(4)} ${paraBirimi}\n` +
                  `📈 EMA5: ${ema5.toFixed(4)} | EMA13: ${ema13.toFixed(4)}\n` +
                  `🕐 ${saat}`;
    await sendTelegram(mesaj);
    console.log(`✅ AL: ${sembol} @ ${closes[n]}`);
  }

  // SAT sinyali
  if (satSart && d.lastSignal !== -1) {
    const pct = ((closes[n] - d.alPrice) / d.alPrice * 100).toFixed(2);
    const emoji = parseFloat(pct) >= 0 ? '📈' : '📉';
    const mesaj = `🔴 <b>SAT — ${ad}</b>\n` +
                  `💰 Fiyat: ${closes[n].toFixed(4)} ${paraBirimi}\n` +
                  `${emoji} Kar/Zarar: %${pct}\n` +
                  `🕐 ${saat}`;
    await sendTelegram(mesaj);
    console.log(`🔴 SAT: ${sembol} @ ${closes[n]} | %${pct}`);
    d.lastSignal = -1;  // Pozisyon kapandı
  }
}

// ------------------- ANA KONTROL DÖNGÜSÜ -------------------
async function kontrolEt() {
  const baslangic = Date.now();
  const saat = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' });
  console.log(`[${saat}] Kontrol başladı...`);

  // Hisse senetleri
  for (const sembol of HISSELER) {
    const closes = await fetchYahoo(sembol);
    if (closes) await sinyalKontrol(sembol, closes, '₺');
    // Rate limiting: her hisse arasında küçük bir bekleme (isteğe bağlı)
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Coinler
  for (const sembol of COINLER) {
    const closes = await fetchBinance(sembol);
    if (closes) await sinyalKontrol(sembol, closes, '$');
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const sure = ((Date.now() - baslangic) / 1000).toFixed(1);
  console.log(`[${new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul'})}] Kontrol bitti. (${sure} sn)`);
}

// ------------------- WEB SUNUCU -------------------
app.get('/', (req, res) => res.send('Sinyal botu çalışıyor ✅ (hızlı EMA stratejisi)'));

app.get('/test', async (req, res) => {
  await sendTelegram('🧪 <b>Test mesajı</b>\nBot aktif ve hızlı sinyal mantığı ile çalışıyor ✅');
  res.send('Telegram mesajı gönderildi');
});

app.listen(3000, () => {
  console.log('Sunucu 3000 portunda başladı');
  // İlk kontrolü hemen yap, sonra her 5 dakikada bir tekrarla
  kontrolEt();
  setInterval(kontrolEt, 5 * 60 * 1000);
});
