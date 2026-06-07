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
  'EUREN.IS','TNZTP.IS','ARDYZ.IS','LOGO.IS','LINK.IS'
]

const COINLER = [
  'BTCUSDT'
]

/* =========================
   DURUM
========================= */

const durum = {}

;[...HISSELER, ...COINLER].forEach(s=>{
  durum[s]={
    lastSignal:0,
    alPrice:null,
    tp:null,
    sl:null,
    trail:null,
    peak:null
  }
})

/* =========================
   XU100 RETURN
========================= */

function xuReturn(x){
  if(!x || x.closes.length<2) return 0
  const c=x.closes
  return (c.at(-1)-c.at(-2))/c.at(-2)*100
}

/* =========================
   MARKET BREADTH
========================= */

function breadth(returns){
  const pos = returns.filter(r=>r>0).length
  return pos / returns.length
}

/* =========================
   CRASH FILTER
========================= */

function crash(xu,breadth){
  return xu < -1.2 && breadth < 0.35
}

/* =========================
   DATA
========================= */

async function yahoo(s){
  try{
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1m&range=1d`
    const r=await axios.get(url,{headers:{'User-Agent':'Mozilla'}})
    const q=r.data.chart.result[0].indicators.quote[0]
    return {
      closes:q.close,
      highs:q.high,
      lows:q.low
    }
  }catch{return null}
}

async function coin(s){
  try{
    const c=s.replace('USDT','-USD')
    const url=`https://api.exchange.coinbase.com/products/${c}/candles?granularity=60`
    const r=await axios.get(url)
    const d=r.data.reverse()
    return {
      closes:d.map(x=>x[4]),
      highs:d.map(x=>x[2]),
      lows:d.map(x=>x[1])
    }
  }catch{return null}
}

/* =========================
   TELEGRAM
========================= */

async function send(msg){
  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {chat_id:TELEGRAM_CHAT_ID,text:msg}
  )
}

/* =========================
   SİNYAL MOTORU
========================= */

async function signal(symbol,data,xuOk,riskOff){

  if(!data || data.closes.length<20) return

  const d=durum[symbol]
  const c=data.closes
  const n=c.length-1
  const price=c[n]

  /* =====================
     RISK OFF MODE
  ===================== */
  if(riskOff){
    if(d.lastSignal===1){
      d.lastSignal=0
      await send(`⚠️ RISK OFF EXIT ${symbol}`)
    }
    return
  }

  /* =====================
     BUY SIGNAL
  ===================== */

  const buy =
    c[n] > c[n-1] &&
    xuOk

  if(buy && d.lastSignal!==1){

    d.lastSignal=1
    d.alPrice=price
    d.tp=price*1.007
    d.sl=price*0.993
    d.peak=price
    d.trail=price*0.993

    await send(`🟢 AL ${symbol} ${price}`)
  }

  /* =====================
     TRAILING STOP
  ===================== */

  if(d.lastSignal===1){
    if(price > d.peak){
      d.peak = price
      d.trail = price*0.993
    }
  }

  /* =====================
     EXIT RULES
  ===================== */

  const sell =
    d.lastSignal===1 &&
    (
      price >= d.tp ||
      price <= d.sl ||
      price <= d.trail
    )

  if(sell){
    d.lastSignal=0
    await send(`🔴 SAT ${symbol} ${price}`)
  }
}

/* =========================
   LOOP
========================= */

async function loop(){

  const xu = await yahoo('XU100.IS')

  const xuR = xuReturn(xu)

  const data = await Promise.all(HISSELER.map(yahoo))

  const rets = data.map(d=>{
    if(!d) return 0
    const c=d.closes
    return (c.at(-1)-c.at(-2))/c.at(-2)*100
  })

  const br = breadth(rets)

  const riskOff = crash(xuR, br)

  const xuOk = xuR > -0.5 && !riskOff

  await Promise.all(
    HISSELER.map((s,i)=>signal(s,data[i],xuOk,riskOff))
  )

  console.log({
    xuR,
    br,
    riskOff
  })
}

/* =========================
   SERVER
========================= */

app.get('/',(_,r)=>r.send('OK'))

app.get('/test',async(_,r)=>{
  await send('bot aktif')
  r.send('ok')
})

app.listen(3000,()=>{
  console.log('RUNNING')
  setInterval(loop,60000)
})
