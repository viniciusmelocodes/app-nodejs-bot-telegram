import 'dotenv/config'
import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { getRecentTelegramLogs, sendTelegramMessage } from './telegram.js'

const hostname = process.env.HOST || '0.0.0.0'
const port = process.env.PORT || 3000

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || hostname}`);

    if (url.pathname === '/logs') {
        res.setHeader('Cache-Control', 'no-store')

        if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('Allow', 'GET')
            res.end('Método não permitido.')
            return
        }

        const accessToken = process.env.LOGS_ACCESS_TOKEN
        if (!accessToken || accessToken.trim().length === 0) {
            res.statusCode = 503
            res.end('Endpoint de logs não configurado.')
            return
        }

        const expectedAuthorization = Buffer.from(`Bearer ${accessToken}`)
        const providedAuthorization = Buffer.from(req.headers.authorization || '')
        if (
            providedAuthorization.length !== expectedAuthorization.length
            || !timingSafeEqual(providedAuthorization, expectedAuthorization)
        ) {
            res.statusCode = 401
            res.setHeader('WWW-Authenticate', 'Bearer')
            res.end('Não autorizado.')
            return
        }

        const requestedLimit = url.searchParams.get('limit')
        const limit = requestedLimit === null ? 100 : Number(requestedLimit)
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
            res.statusCode = 400
            res.end('O parâmetro limit deve ser um inteiro entre 1 e 500.')
            return
        }

        try {
            const logs = await getRecentTelegramLogs(limit)
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(logs))
        } catch (error) {
            console.error('Não foi possível ler os logs do Telegram:', error)
            res.statusCode = 500
            res.end('Não foi possível ler os logs.')
        }
        return
    }

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