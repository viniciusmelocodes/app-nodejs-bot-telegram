# app-nodejs-bot-telegram

Serviço HTTP para enviar mensagens ao Telegram e consultar os registros recentes. O servidor usa `127.0.0.1` por padrão; se for publicado, exponha-o somente atrás de um proxy HTTPS.

Configure `TELEGRAM_BOT_TOKEN`, `SEND_ACCESS_TOKEN` e pelo menos um chat permitido. `TELEGRAM_ALLOWED_CHAT_IDS` aceita IDs separados por vírgula; se não for definido, `TELEGRAM_CHAT_ID` é usado como único destino permitido. Uma requisição pode omitir `chat_id` quando há um destino padrão.

```sh
curl -X POST http://127.0.0.1:3000/send \
  -H 'Authorization: Bearer <SEND_ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"<CHAT_ID>","text":"Mensagem enviada pelo serviço"}'
```

O envio aceita texto de 1 a 4096 caracteres, limita cada IP a 20 envios por minuto por processo e aplica timeout à chamada do Telegram. Em implantações com múltiplas instâncias, aplique rate limit compartilhado no proxy. O envio usa POST para que texto e chat ID não apareçam na URL.

Para consultar registros, configure `LOGS_ACCESS_TOKEN` e faça uma requisição `GET /logs` com `Authorization: Bearer <LOGS_ACCESS_TOKEN>`. O parâmetro opcional `limit` aceita de 1 a 500 entradas e usa 100 por padrão. O endpoint `GET /healthz` retorna o estado do processo.

Os registros são JSON Lines em `logs/telegram-messages.txt`; por padrão, não armazenam o conteúdo da mensagem. Defina `LOG_TELEGRAM_MESSAGE_CONTENT=true` apenas se precisar registrar o texto. O arquivo ativo é rotacionado ao atingir 5 MiB, mantendo no máximo um arquivo anterior. A pasta `logs/` não é versionada.

Use tokens distintos para envio e consulta e não exponha o serviço diretamente à internet sem HTTPS. Execute os testes com `npm test`.
