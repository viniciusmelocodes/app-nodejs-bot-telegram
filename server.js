import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { getRecentTelegramLogs, sendTelegramMessage } from './telegram.js'

const MAX_BODY_BYTES = 64 * 1024
const MAX_SENDS_PER_MINUTE = 20
const RATE_LIMIT_WINDOW_MS = 60 * 1000

class HttpError extends Error {
    constructor(statusCode, message) {
        super(message)
        this.statusCode = statusCode
    }
}

function sendJson(res, statusCode, body) {
    res.statusCode = statusCode
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(JSON.stringify(body))
}

function hasBearerToken(req, token) {
    if (!token || token.trim().length === 0) {
        return false
    }

    const expected = Buffer.from(`Bearer ${token}`)
    const provided = Buffer.from(req.headers.authorization || '')

    return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function configuredChatIds(env) {
    const allowedChatIds = (env.TELEGRAM_ALLOWED_CHAT_IDS || '')
        .split(',')
        .map(chatId => chatId.trim())
        .filter(Boolean)

    if (allowedChatIds.length > 0) {
        return [...new Set(allowedChatIds)]
    }

    const defaultChatId = (env.TELEGRAM_CHAT_ID || '').trim()
    return defaultChatId ? [defaultChatId] : []
}

async function readJsonBody(req) {
    const contentType = (req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
    if (contentType !== 'application/json') {
        req.resume()
        throw new HttpError(415, 'Content-Type deve ser application/json.')
    }

    const contentLength = Number(req.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        req.resume()
        throw new HttpError(413, 'Corpo da requisição excede o limite permitido.')
    }

    const chunks = []
    let size = 0
    let tooLarge = false

    await new Promise((resolve, reject) => {
        req.on('data', chunk => {
            size += chunk.length
            if (size > MAX_BODY_BYTES) {
                tooLarge = true
                chunks.length = 0
                return
            }

            if (!tooLarge) {
                chunks.push(chunk)
            }
        })
        req.on('end', resolve)
        req.on('error', reject)
    })

    if (tooLarge) {
        throw new HttpError(413, 'Corpo da requisição excede o limite permitido.')
    }

    let body
    try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
        throw new HttpError(400, 'O corpo da requisição deve conter JSON válido.')
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'O corpo da requisição deve ser um objeto JSON.')
    }

    return body
}

function isRateLimited(rateLimits, key, now) {
    for (const [client, window] of rateLimits) {
        if (window.resetAt <= now) {
            rateLimits.delete(client)
        }
    }

    let window = rateLimits.get(key)
    if (!window || window.resetAt <= now) {
        window = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
        rateLimits.set(key, window)
    }

    if (rateLimits.size > 10_000) {
        const oldestClient = rateLimits.keys().next().value
        rateLimits.delete(oldestClient)
    }

    if (window.count >= MAX_SENDS_PER_MINUTE) {
        return Math.max(1, Math.ceil((window.resetAt - now) / 1000))
    }

    window.count++
    return 0
}

function getRequestedChatId(value) {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
    }
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
        return String(value)
    }
    return null
}

export function createHttpServer({
    env = process.env,
    sendMessage = sendTelegramMessage,
    readLogs = getRecentTelegramLogs,
} = {}) {
    const rateLimits = new Map()
    const server = createServer(async (req, res) => {
        let url
        try {
            url = new URL(req.url || '/', 'http://localhost')
        } catch {
            sendJson(res, 400, { error: 'URL inválida.' })
            return
        }

        try {
            if (url.pathname === '/logs') {
                if (req.method !== 'GET') {
                    res.setHeader('Allow', 'GET')
                    sendJson(res, 405, { error: 'Método não permitido.' })
                    return
                }

                const accessToken = env.LOGS_ACCESS_TOKEN
                if (!accessToken || accessToken.trim().length === 0) {
                    sendJson(res, 503, { error: 'Endpoint de logs não configurado.' })
                    return
                }
                if (!hasBearerToken(req, accessToken)) {
                    res.setHeader('WWW-Authenticate', 'Bearer')
                    sendJson(res, 401, { error: 'Não autorizado.' })
                    return
                }

                const requestedLimit = url.searchParams.get('limit')
                const limit = requestedLimit === null ? 100 : Number(requestedLimit)
                if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
                    sendJson(res, 400, { error: 'O parâmetro limit deve ser um inteiro entre 1 e 500.' })
                    return
                }

                try {
                    sendJson(res, 200, await readLogs(limit))
                } catch (error) {
                    console.error('Não foi possível ler os logs do Telegram:', error)
                    throw new HttpError(500, 'Não foi possível ler os logs.')
                }
                return
            }

            if (url.pathname === '/send') {
                if (req.method !== 'POST') {
                    res.setHeader('Allow', 'POST')
                    sendJson(res, 405, { error: 'Método não permitido.' })
                    return
                }

                const accessToken = env.SEND_ACCESS_TOKEN
                if (!accessToken || accessToken.trim().length === 0) {
                    sendJson(res, 503, { error: 'Endpoint de envio não configurado.' })
                    return
                }
                if (!hasBearerToken(req, accessToken)) {
                    res.setHeader('WWW-Authenticate', 'Bearer')
                    sendJson(res, 401, { error: 'Não autorizado.' })
                    return
                }

                const retryAfter = isRateLimited(rateLimits, req.socket.remoteAddress || 'unknown', Date.now())
                if (retryAfter > 0) {
                    res.setHeader('Retry-After', String(retryAfter))
                    sendJson(res, 429, { error: 'Limite de envios excedido.' })
                    return
                }

                if (!env.TELEGRAM_BOT_TOKEN) {
                    sendJson(res, 503, { error: 'Bot do Telegram não configurado.' })
                    return
                }

                const body = await readJsonBody(req)
                const text = body.text
                if (typeof text !== 'string' || text.trim().length === 0 || Array.from(text).length > 4096) {
                    sendJson(res, 400, { error: 'text deve conter de 1 a 4096 caracteres.' })
                    return
                }

                const allowedChatIds = configuredChatIds(env)
                if (allowedChatIds.length === 0) {
                    sendJson(res, 503, { error: 'Nenhum chat permitido foi configurado.' })
                    return
                }

                const defaultChatId = env.TELEGRAM_CHAT_ID?.trim()
                    || (allowedChatIds.length === 1 ? allowedChatIds[0] : null)
                const chatId = getRequestedChatId(body.chat_id ?? defaultChatId)
                if (!chatId) {
                    sendJson(res, 400, { error: 'chat_id é obrigatório quando há mais de um chat permitido.' })
                    return
                }
                if (!allowedChatIds.includes(chatId)) {
                    sendJson(res, 403, { error: 'O chat solicitado não está permitido.' })
                    return
                }

                try {
                    const result = await sendMessage(chatId, text)
                    res.statusCode = result.statusCode
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.setHeader('Cache-Control', 'no-store')
                    res.setHeader('X-Content-Type-Options', 'nosniff')
                    res.end(result.data)
                } catch (error) {
                    console.error('Não foi possível enviar mensagem ao Telegram:', error)
                    throw new HttpError(502, 'Falha ao enviar mensagem ao Telegram.')
                }
                return
            }

            if (url.pathname === '/healthz' && req.method === 'GET') {
                sendJson(res, 200, { status: 'ok' })
                return
            }

            sendJson(res, 404, { error: 'Rota não encontrada.' })
        } catch (error) {
            if (res.headersSent || res.destroyed) {
                return
            }
            if (!(error instanceof HttpError)) {
                console.error('Erro ao processar requisição HTTP:', error)
            }
            sendJson(res, error.statusCode || 500, {
                error: error.statusCode ? error.message : 'Erro interno do servidor.',
            })
        }
    })

    server.requestTimeout = 30_000
    server.headersTimeout = 10_000
    server.keepAliveTimeout = 5_000
    return server
}
