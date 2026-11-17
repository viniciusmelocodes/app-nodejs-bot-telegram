# app-nodejs-bot-telegram

As tentativas de envio ao Telegram são registradas em `logs/telegram-messages.txt`, uma entrada JSON por linha. O log inclui data e hora, chat, texto enviado e resposta do Telegram; falhas de conexão também são registradas. O arquivo pode conter mensagens privadas e a pasta `logs/` não é versionada.

Para consultar os registros mais recentes, configure `LOGS_ACCESS_TOKEN` e faça uma requisição `GET /logs` com o cabeçalho `Authorization: Bearer <LOGS_ACCESS_TOKEN>` por HTTPS. O parâmetro opcional `limit` aceita de 1 a 500 entradas e usa 100 por padrão.
