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
   GLOBAL STATE
========================= */

const state = {
  logs: [],
  apiLatency: {},
  riskOff: false,
  activeSymbol: null,
  trades: []
}

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
   LOG SYSTEM
========================= */

function log(event){
  state.logs.push({
    time: new Date().toISOString(),
    ...event
  })

  if(state.logs.length > 200){
    state.logs.shift()
  }
}

/* =========================
   LATENCY WRAPPER
========================= */

async function timed(name, fn){
  const t0 = Date.now()
  const r = await fn()
  const t1 = Date.now()

  state.apiLatency[name] = t1 - t0
  return r
}

/* =========================
   XU RETURN
========================= */

function xuReturn(x){
  if(!x || x.closes.length<2) return 0
  const c=x.closes
  return (c.at(-1)-c.at(-2))/c.at(-2)*100
}

/* =========================
   MARKET BREADTH
========================= */

function breadth(arr){
  const pos = arr.filter(x=>x>0).length
  return pos / arr.length
}

/* =========================
   CRASH FILTER
========================= */

function crash(xu, br){
  return xu < -1.2 && br < 0.35
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
   WINRATE
========================= */

function winrate(){
  if(!state.trades.length) return 0
  const wins = state.trades.filter(t=>t.pct>0).length
  return (wins/state.trades.length)*100
}

/* =========================
   SİNYAL MOTORU
========================= */

async function signal(symbol,data,xuOk,riskOff){

  if(!data || data.closes.length<20) return

  const d = durum[symbol]
  const c = data.closes
  const n = c.length-1
  const price = c[n]

  state.activeSymbol = symbol

  /* =====================
     RISK OFF MODE
  ===================== */
  if(riskOff){
    state.riskOff = true

    if(d.lastSignal===1){
      d.lastSignal=0
      log({type:'risk_exit',symbol})
      await send(`⚠️ RISK OFF EXIT ${symbol}`)
    }
    return
  }

  state.riskOff = false

  /* =====================
     BUY
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

    log({type:'buy',symbol,price})

    await send(`🟢 AL ${symbol} ${price}`)
  }

  /* =====================
     TRAILING STOP
  ===================== */

  if(d.lastSignal===1){
    if(price>d.peak){
      d.peak=price
      d.trail=price*0.993
    }
  }

  /* =====================
     SELL
  ===================== */

  const sell =
    d.lastSignal===1 &&
    (
      price>=d.tp ||
      price<=d.sl ||
      price<=d.trail
    )

  if(sell){

    const pct = ((price-d.alPrice)/d.alPrice)*100

    state.trades.push({
      symbol,
      entry:d.alPrice,
      exit:price,
      pct
    })

    log({type:'sell',symbol,pct})

    d.lastSignal=0

    await send(`🔴 SAT ${symbol} %${pct.toFixed(2)}`)
  }
}

/* =========================
   LOOP
========================= */

async function loop(){

  const xu = await timed("yahoo_xu", ()=>yahoo('XU100.IS'))

  const xuR = xuReturn(xu)

  const data = await Promise.all(
    HISSELER.map(s => timed(`yahoo_${s}`, ()=>yahoo(s)))
  )

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

  log({type:'tick',xuR,br,riskOff})
}

/* =========================
   DASHBOARD API
========================= */

app.get('/dashboard',(req,res)=>{

  res.json({
    riskOff: state.riskOff,
    activeSymbol: state.activeSymbol,
    latency: state.apiLatency,
    winrate: winrate().toFixed(2),
    trades: state.trades.length,
    logs: state.logs.slice(-20)
  })
})

/* =========================
   UI PANEL
========================= */

app.get('/panel',(req,res)=>{

  res.send(`
  <html>
  <body style="background:#0d1117;color:white;font-family:Arial">
    <h2>🚀 Trading Dashboard</h2>

    <pre id="a"></pre>
    <pre id="b"></pre>

    <script>
      async function load(){
        const r = await fetch('/dashboard')
        const d = await r.json()

        document.getElementById('a').innerText =
        JSON.stringify({
          riskOff:d.riskOff,
          active:d.activeSymbol,
          winrate:d.winrate,
          trades:d.trades
        },null,2)

        document.getElementById('b').innerText =
        JSON.stringify(d.latency,null,2)
      }

      setInterval(load,2000)
      load()
    </script>
  </body>
  </html>
  `)
})

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
