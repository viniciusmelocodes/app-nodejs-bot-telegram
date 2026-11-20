import { appendFile, mkdir, open, rename, rm, stat } from 'node:fs/promises'

const logDirectory = new URL('./logs/', import.meta.url)
const logFile = new URL('./logs/telegram-messages.txt', import.meta.url)
const rotatedLogFile = new URL('./logs/telegram-messages.txt.1', import.meta.url)
const maxLogFileBytes = 5 * 1024 * 1024
const requestTimeoutMs = 10_000
let logWriteQueue = Promise.resolve()

async function logTelegramMessage(entry) {
    const write = async () => {
        await mkdir(logDirectory, { recursive: true })

        let currentSize = 0
        try {
            currentSize = (await stat(logFile)).size
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error
            }
        }

        const line = `${JSON.stringify(entry)}\n`
        if (currentSize > 0 && currentSize + Buffer.byteLength(line) > maxLogFileBytes) {
            await rm(rotatedLogFile, { force: true })
            await rename(logFile, rotatedLogFile)
        }

        await appendFile(logFile, line, 'utf8')
    }

    const pendingWrite = logWriteQueue.then(write, write)
    logWriteQueue = pendingWrite.catch(() => {})

    try {
        await pendingWrite
    } catch (error) {
        console.error('Não foi possível registrar o log do Telegram:', error)
    }
}

async function readRecentLogFile(file, limit) {
    let logHandle

    try {
        logHandle = await open(file, 'r')
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

export async function getRecentTelegramLogs(limit = 100) {
    const currentEntries = await readRecentLogFile(logFile, limit)
    if (currentEntries.length >= limit) {
        return currentEntries
    }

    const previousEntries = await readRecentLogFile(rotatedLogFile, limit - currentEntries.length)
    return [...currentEntries, ...previousEntries]
}

export async function sendTelegramMessage(chatId, text, {
    env = process.env,
    fetchImpl = fetch,
    logMessage = logTelegramMessage,
    timeoutMs = requestTimeoutMs,
} = {}) {
    const botToken = env.TELEGRAM_BOT_TOKEN

    if (!botToken) {
        throw new Error('TELEGRAM_BOT_TOKEN não configurado.')
    }

    const timestamp = new Date().toISOString()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let statusCode
    let responseText

    try {
        const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text }),
            signal: controller.signal,
        })

        statusCode = response.status
        responseText = await response.text()
        const payload = JSON.parse(responseText)

        if (!response.ok || payload.ok !== true) {
            throw new Error(payload.description || `Telegram respondeu com HTTP ${statusCode}.`)
        }

        const logEntry = {
            timestamp,
            chatId,
            statusCode,
            telegramMessageId: payload.result?.message_id,
        }
        if (env.LOG_TELEGRAM_MESSAGE_CONTENT === 'true') {
            logEntry.text = text
        }
        await logMessage(logEntry)

        return { statusCode, data: responseText }
    } catch (error) {
        await logMessage({
            timestamp,
            chatId,
            ...(env.LOG_TELEGRAM_MESSAGE_CONTENT === 'true' ? { text } : {}),
            statusCode,
            error: error.message,
            ...(statusCode ? { response: responseText?.slice(0, 1000) } : {}),
        })
        throw error
    } finally {
        clearTimeout(timeout)
    }
}
