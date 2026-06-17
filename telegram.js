import { request } from 'node:https'

export function sendTelegramMessage(chatId, text) {
    return new Promise((resolve, reject) => {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        
        if (!botToken) {
            return reject(new Error('TELEGRAM_BOT_TOKEN não configurado.'));
        }

        const telegramUrl = new URL(`https://api.telegram.org/bot${botToken}/sendMessage`);
        telegramUrl.searchParams.append('chat_id', chatId);
        telegramUrl.searchParams.append('text', text);

        const tgReq = request(telegramUrl, (tgRes) => {
            let data = '';
            tgRes.on('data', chunk => { data += chunk; });
            tgRes.on('end', () => {
                resolve({ statusCode: tgRes.statusCode, data });
            });
        });

        tgReq.on('error', (e) => {
            reject(e);
        });

        tgReq.end();
    });
}
