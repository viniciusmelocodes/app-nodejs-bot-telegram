import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHttpServer } from '../server.js'
import { sendTelegramMessage } from '../telegram.js'

async function startServer(t, options) {
    const server = createHttpServer(options)
    await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })

    t.after(() => new Promise(resolve => server.close(resolve)))
    return `http://127.0.0.1:${server.address().port}`
}

test('protege o envio e restringe os chats permitidos', async (t) => {
    const sentMessages = []
    const baseUrl = await startServer(t, {
        env: {
            SEND_ACCESS_TOKEN: 'send-token',
            TELEGRAM_BOT_TOKEN: 'bot-token',
            TELEGRAM_CHAT_ID: '123',
            TELEGRAM_ALLOWED_CHAT_IDS: '123, 456',
        },
        sendMessage: async (chatId, text) => {
            sentMessages.push({ chatId, text })
            return { statusCode: 200, data: '{"ok":true}' }
        },
    })

    const unauthorized = await fetch(`${baseUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: '123', text: 'Oi' }),
    })
    assert.equal(unauthorized.status, 401)

    const forbidden = await fetch(`${baseUrl}/send`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer send-token',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chat_id: '999', text: 'Oi' }),
    })
    assert.equal(forbidden.status, 403)

    const sent = await fetch(`${baseUrl}/send`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer send-token',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chat_id: '456', text: 'Olá' }),
    })
    assert.equal(sent.status, 200)
    assert.deepEqual(await sent.json(), { ok: true })
    assert.deepEqual(sentMessages, [{ chatId: '456', text: 'Olá' }])
})

test('valida o método e o JSON do endpoint de envio', async (t) => {
    const baseUrl = await startServer(t, {
        env: {
            SEND_ACCESS_TOKEN: 'send-token',
            TELEGRAM_BOT_TOKEN: 'bot-token',
            TELEGRAM_CHAT_ID: '123',
        },
        sendMessage: async () => {
            throw new Error('Não deveria enviar mensagem.')
        },
    })

    const wrongMethod = await fetch(`${baseUrl}/send`, { method: 'GET' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get('allow'), 'POST')

    const invalidJson = await fetch(`${baseUrl}/send`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer send-token',
            'Content-Type': 'application/json',
        },
        body: '{',
    })
    assert.equal(invalidJson.status, 400)
})

test('exige autenticação e valida o limite ao consultar logs', async (t) => {
    const baseUrl = await startServer(t, {
        env: { LOGS_ACCESS_TOKEN: 'logs-token' },
        readLogs: async limit => [{ limit }],
    })

    const unauthorized = await fetch(`${baseUrl}/logs`)
    assert.equal(unauthorized.status, 401)

    const invalidLimit = await fetch(`${baseUrl}/logs?limit=501`, {
        headers: { Authorization: 'Bearer logs-token' },
    })
    assert.equal(invalidLimit.status, 400)

    const logs = await fetch(`${baseUrl}/logs?limit=7`, {
        headers: { Authorization: 'Bearer logs-token' },
    })
    assert.equal(logs.status, 200)
    assert.deepEqual(await logs.json(), [{ limit: 7 }])
})

test('limita envios por IP', async (t) => {
    let sendCount = 0
    const baseUrl = await startServer(t, {
        env: {
            SEND_ACCESS_TOKEN: 'send-token',
            TELEGRAM_BOT_TOKEN: 'bot-token',
            TELEGRAM_CHAT_ID: '123',
        },
        sendMessage: async () => {
            sendCount++
            return { statusCode: 200, data: '{"ok":true}' }
        },
    })

    let response
    for (let i = 0; i < 21; i++) {
        response = await fetch(`${baseUrl}/send`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer send-token',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: `Mensagem ${i}` }),
        })
    }

    assert.equal(response.status, 429)
    assert.ok(Number(response.headers.get('retry-after')) > 0)
    assert.equal(sendCount, 20)
})

test('envia a mensagem no corpo e não registra seu conteúdo por padrão', async () => {
    const logEntries = []
    let requestUrl
    let requestOptions

    const result = await sendTelegramMessage('123', 'texto privado', {
        env: { TELEGRAM_BOT_TOKEN: 'bot-token' },
        fetchImpl: async (url, options) => {
            requestUrl = url
            requestOptions = options
            return {
                ok: true,
                status: 200,
                text: async () => '{"ok":true,"result":{"message_id":7}}',
            }
        },
        logMessage: async entry => logEntries.push(entry),
    })

    assert.equal(new URL(requestUrl).pathname, '/botbot-token/sendMessage')
    assert.equal(requestOptions.method, 'POST')
    assert.deepEqual(JSON.parse(requestOptions.body), { chat_id: '123', text: 'texto privado' })
    assert.deepEqual(JSON.parse(result.data), { ok: true, result: { message_id: 7 } })
    assert.equal(logEntries[0].telegramMessageId, 7)
    assert.equal(Object.hasOwn(logEntries[0], 'text'), false)
})

test('trata respostas de erro do Telegram como falha de envio', async () => {
    const logEntries = []

    await assert.rejects(
        sendTelegramMessage('123', 'texto privado', {
            env: { TELEGRAM_BOT_TOKEN: 'bot-token' },
            fetchImpl: async () => ({
                ok: false,
                status: 403,
                text: async () => '{"ok":false,"description":"Forbidden"}',
            }),
            logMessage: async entry => logEntries.push(entry),
        }),
        /Forbidden/,
    )
    assert.equal(logEntries[0].statusCode, 403)
    assert.equal(logEntries[0].error, 'Forbidden')
    assert.equal(Object.hasOwn(logEntries[0], 'text'), false)
})

test('aceita exatamente 4096 caracteres e rejeita mensagens maiores', async (t) => {
    let sendCount = 0
    const baseUrl = await startServer(t, {
        env: {
            SEND_ACCESS_TOKEN: 'send-token',
            TELEGRAM_BOT_TOKEN: 'bot-token',
            TELEGRAM_CHAT_ID: '123',
        },
        sendMessage: async () => {
            sendCount++
            return { statusCode: 200, data: '{"ok":true}' }
        },
    })
    const headers = {
        Authorization: 'Bearer send-token',
        'Content-Type': 'application/json',
    }

    const valid = await fetch(`${baseUrl}/send`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: 'a'.repeat(4096) }),
    })
    assert.equal(valid.status, 200)

    const tooLong = await fetch(`${baseUrl}/send`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: 'a'.repeat(4097) }),
    })
    assert.equal(tooLong.status, 400)
    assert.equal(sendCount, 1)
})

test('aborta chamadas ao Telegram que excedem o timeout', async () => {
    const logEntries = []

    await assert.rejects(
        sendTelegramMessage('123', 'texto privado', {
            env: { TELEGRAM_BOT_TOKEN: 'bot-token' },
            timeoutMs: 5,
            fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(new Error('request timed out')), { once: true })
            }),
            logMessage: async entry => logEntries.push(entry),
        }),
        /request timed out/,
    )
    assert.equal(logEntries[0].error, 'request timed out')
})
