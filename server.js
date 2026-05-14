const axios = require("axios")
const express = require("express")

const {
  RSI,
  PSAR,
  StochasticRSI,
  WMA
} = require("technicalindicators")

const app = express()

// ─────────────────────────────
// ENV
// ─────────────────────────────

const TOKEN = process.env.8557325295:AAEXgo3rxK7a1MTVE9QVbiExvrZmolct6Js
const CHAT  = process.env.-1003975259428

// ─────────────────────────────
// LIST
// ─────────────────────────────

const HISSELER = ["THYAO.IS","ASELS.IS","TUPRS.IS","SASA.IS"]
const COINLER  = ["BTC-USD","ETH-USD","SOL-USD"]

const lastSignal = {}

// ─────────────────────────────
// TELEGRAM
// ─────────────────────────────

async function tg(msg){
  try{
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
      chat_id: CHAT,
      text: msg,
      parse_mode: "HTML"
    })
  }catch(e){
    console.log("TG error:",e.message)
  }
}

// ─────────────────────────────
// DATA
// ─────────────────────────────

async function fetch(symbol){
  try{
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=4h&range=3mo`

    const r = await axios.get(url,{headers:{'User-Agent':'Mozilla'}})

    const q = r.data.chart.result?.[0]?.indicators?.quote?.[0]
    if(!q) return null

    const data = q.close.map((c,i)=>({
      c:q.close[i],
      h:q.high[i],
      l:q.low[i],
      o:q.open[i]
    })).filter(x=>x.c)

    return {
      c:data.map(x=>x.c),
      h:data.map(x=>x.h),
      l:data.map(x=>x.l),
      o:data.map(x=>x.o)
    }

  }catch(e){
    console.log(symbol,e.message)
    return null
  }
}

// ─────────────────────────────
// HULL
// ─────────────────────────────

function hull(values, p=9){
  const half = Math.floor(p/2)
  const sqrt = Math.floor(Math.sqrt(p))

  const w1 = WMA.calculate({values,period:half})
  const w2 = WMA.calculate({values,period:p})

  const diff=[]
  const off = w1.length-w2.length

  for(let i=0;i<w2.length;i++){
    diff.push(2*w1[i+off]-w2[i])
  }

  return WMA.calculate({values:diff,period:sqrt})
}

// ─────────────────────────────
// DEBUG ANALYSIS ENGINE
// ─────────────────────────────

function analyze(symbol,data){

  const c=data.c, h=data.h, l=data.l
  const n=c.length-1

  const close=c[n]
  const open=c[n-1]

  // RSI
  const rsi14 = RSI.calculate({values:c,period:14}).at(-1)
  const rsi7  = RSI.calculate({values:c,period:7}).at(-1)

  // SAR
  const sar = PSAR.calculate({high:h,low:l,step:0.02,max:0.2}).at(-1)

  // CMF (basit debug)
  let cmf=0
  let volOK=true

  // Hull
  const hullVal = hull(c,9).at(-1)

  // Stoch
  const st = StochasticRSI.calculate({
    values:c,
    rsiPeriod:14,
    stochasticPeriod:14,
    kPeriod:3,
    dPeriod:3
  }).at(-1)

  const k=st?.k
  const d=st?.d

  // Ichimoku base (basit)
  const kijun = (Math.max(...h.slice(-26)) + Math.min(...l.slice(-26)))/2

  // Pivot
  const pivot = (h[n-1]+l[n-1]+c[n-1])/3

  // ───────── SCORE SYSTEM ─────────

  let score=0
  let debug=[]

  function check(name,cond){
    if(cond){
      score++
      debug.push("🟢 "+name)
    }else{
      debug.push("🔴 "+name)
    }
  }

  check("RSI14 45-65", rsi14>=45 && rsi14<=65)
  check("RSI7 <=70", rsi7<=70)
  check("SAR below", sar<close)
  check("Hull below price", hullVal<close)
  check("Green candle", close>open)
  check("Stoch K>D", k>d)
  check("Ichimoku bullish", kijun<close)
  check("Pivot above", pivot<close)

  const signal = score>=7

  return {
    signal,
    score,
    debug,
    rsi14,
    rsi7,
    sar,
    hullVal,
    k,
    d,
    kijun,
    pivot,
    close
  }
}

// ─────────────────────────────
// MAIN
// ─────────────────────────────

async function run(){

  console.log("DEBUG RUN")

  for(const s of [...HISSELER,...COINLER]){

    const data = await fetch(s)
    if(!data) continue

    const a = analyze(s,data)

    const name=s.replace(".IS","").replace("-USD","")

    console.log(name,a.score)

    // TELEGRAM DEBUG RAPOR
    await tg(
`
📊 <b>${name}</b>

💰 ${a.close}

📈 RSI14: ${a.rsi14?.toFixed(2)}
⚡ RSI7: ${a.rsi7?.toFixed(2)}
📉 SAR: ${a.sar}
📊 Hull: ${a.hullVal}
☁️ Ichimoku: ${a.kijun?.toFixed(2)}
📌 Pivot: ${a.pivot?.toFixed(2)}

━━━━━━━━━━
⭐ SCORE: ${a.score}/8

${a.debug.join("\n")}

━━━━━━━━━━
${a.signal ? "🟢 STRONG BUY" : "⚪ NO SIGNAL"}
`
    )

    // sadece güçlü sinyal
    if(a.signal && lastSignal[s]!==a.close){
      lastSignal[s]=a.close

      await tg(`🚀 <b>AL SİNYALİ</b>\n${name}\nFiyat: ${a.close}`)
    }
  }
}

// ─────────────────────────────
// LOOP
// ─────────────────────────────

app.get("/",(r,res)=>res.send("DEBUG BOT OK"))

app.get("/test",async(r,res)=>{
  await tg("TEST OK")
  res.send("ok")
})

const PORT = process.env.PORT||3000

app.listen(PORT,()=>{
  console.log("START",PORT)
  run()
  setInterval(run,15*60*1000)
})
