import 'dotenv/config'
import { createServer } from 'node:http'

const hostname = '0.0.0.0'
const port = process.env.PORT || 3000

const server = createServer((req, res) => {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/plain')
    res.end('app-nodejs-bot-telegram v1.0.0')
})

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`)
})