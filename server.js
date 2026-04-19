const express = require('express')
const axios   = require('axios')
const app     = express()
app.use(express.json())

const TOKEN   = 'BURAYA_BOT_TOKENINI_YAZ'
const CHAT_ID = '5756145019'

app.post('/webhook', async (req, res) => {
    try {
        const msg = req.body.message || 'Sinyal geldi'
        await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text:    msg,
            parse_mode: 'HTML'
        })
        res.sendStatus(200)
    } catch (err) {
        console.error(err)
        res.sendStatus(500)
    }
})

app.get('/', (req, res) => res.send('Sunucu çalışıyor'))

app.listen(3000, () => console.log('Sunucu 3000 portunda'))