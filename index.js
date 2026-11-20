import 'dotenv/config'
import { createHttpServer } from './server.js'

const hostname = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3000)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um inteiro entre 1 e 65535.')
}

const server = createHttpServer()

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        server.close((error) => {
            if (error) {
                console.error('Não foi possível encerrar o servidor:', error)
                process.exitCode = 1
                return
            }

            console.log('Servidor encerrado.')
        })
    })
}
