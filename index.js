import 'dotenv/config'
import { createServer } from 'node:http'
import { sendTelegramMessage } from './telegram.js'

const hostname = '0.0.0.0'
const port = process.env.PORT || 3000

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || hostname}`);
    
    if (url.pathname === '/send') {
        const chatId = url.searchParams.get('chat_id') || process.env.TELEGRAM_CHAT_ID;
        const text = url.searchParams.get('text') || 'Mensagem enviada do Node.js!';
        
        if (!chatId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('Erro: chat_id não fornecido. Passe na URL como /send?chat_id=SEU_CHAT_ID ou configure no .env');
            return;
        }

        try {
            const result = await sendTelegramMessage(chatId, text);
            res.statusCode = result.statusCode;
            res.setHeader('Content-Type', 'application/json');
            res.end(result.data);
        } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(`Erro ao enviar mensagem: ${e.message}`);
        }

    } else {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/plain')
        res.end('app-nodejs-bot-telegram v1.0.0')
    }
})

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`)
})