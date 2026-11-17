import { appendFile, mkdir, open } from 'node:fs/promises'
import { request } from 'node:https'

const logDirectory = new URL('./logs/', import.meta.url)
const logFile = new URL('./logs/telegram-messages.txt', import.meta.url)

async function logTelegramMessage(entry) {
    try {
        await mkdir(logDirectory, { recursive: true })
        await appendFile(logFile, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch (error) {
        console.error('Não foi possível registrar o log do Telegram:', error)
    }
}

export async function getRecentTelegramLogs(limit = 100) {
    let logHandle

    try {
        logHandle = await open(logFile, 'r')
    } catch (error) {
        if (error.code === 'ENOENT') {
            return []
        }
        throw error
    }

    try {
        let position = (await logHandle.stat()).size
        let remainder = Buffer.alloc(0)
        const entries = []
        const chunk = Buffer.alloc(64 * 1024)

        while (position > 0 && entries.length < limit) {
            const length = Math.min(position, chunk.length)
            position -= length
            const { bytesRead } = await logHandle.read(chunk, 0, length, position)
            const data = Buffer.concat([chunk.subarray(0, bytesRead), remainder])
            let lineEnd = data.length

            for (let i = data.length - 1; i >= 0 && entries.length < limit; i--) {
                if (data[i] === 0x0a) {
                    const line = data.subarray(i + 1, lineEnd)
                    if (line.length > 0) {
                        entries.push(JSON.parse(line.toString('utf8')))
                    }
                    lineEnd = i
                }
            }

            remainder = data.subarray(0, lineEnd)
        }

        if (position === 0 && remainder.length > 0 && entries.length < limit) {
            entries.push(JSON.parse(remainder.toString('utf8')))
        }

        return entries
    } finally {
        await logHandle.close()
    }
}

export async function sendTelegramMessage(chatId, text) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN

    if (!botToken) {
        throw new Error('TELEGRAM_BOT_TOKEN não configurado.')
    }

    const telegramUrl = new URL(`https://api.telegram.org/bot${botToken}/sendMessage`)
    telegramUrl.searchParams.append('chat_id', chatId)
    telegramUrl.searchParams.append('text', text)

    const timestamp = new Date().toISOString()
    let result

    try {
        result = await new Promise((resolve, reject) => {
            const tgReq = request(telegramUrl, (tgRes) => {
                let data = ''
                tgRes.on('data', chunk => { data += chunk })
                tgRes.on('end', () => {
                    resolve({ statusCode: tgRes.statusCode, data })
                })
                tgRes.on('error', reject)
            })

            tgReq.on('error', reject)
            tgReq.end()
        })
    } catch (error) {
        await logTelegramMessage({
            timestamp,
            chatId,
            text,
            error: error.message,
        })
        throw error
    }

    await logTelegramMessage({
        timestamp,
        chatId,
        text,
        statusCode: result.statusCode,
        response: result.data,
    })

    return result
}
