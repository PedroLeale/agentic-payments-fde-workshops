// API de pagamento do simulador: mesma cobrança exposta com e sem idempotência.
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

const PROCESSAMENTO_MS = Number(process.env.PROCESSAMENTO_MS ?? 1200) // tempo do "adquirente"

// ponytail: estado em memória. Em produção: tabela com UNIQUE(cliente, chave) + TTL (Stripe: >= 24h).
let cobrancas = []
const chaves = new Map() // chave -> { status: 'processando' | 'concluida', hash, resposta }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

async function lerPagamento(req) {
  let texto = ''
  for await (const parte of req) texto += parte
  const { pedido, valor } = JSON.parse(texto || '{}')
  if (typeof pedido !== 'string' || !pedido || !Number.isFinite(valor) || valor <= 0) throw new Error('payload inválido')
  return { pedido, valor }
}

async function cobrar(modo, { pedido, valor }, chave) {
  await sleep(PROCESSAMENTO_MS)
  const cobranca = { id: `ch_${randomUUID().slice(0, 8)}`, modo, pedido, valor, chave, em: new Date().toISOString() }
  cobrancas.push(cobranca)
  return cobranca
}

function enviar(res, status, corpo, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(corpo === undefined ? undefined : JSON.stringify(corpo))
}

export const servidor = createServer(async (req, res) => {
  // O front roda em outra porta (Vite); CORS direto em vez de proxy para a "resposta perdida" virar erro de rede real.
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE')
  res.setHeader('access-control-allow-headers', 'content-type, idempotency-key, x-simular-falha')
  res.setHeader('access-control-expose-headers', 'idempotent-replayed')
  if (req.method === 'OPTIONS') return enviar(res, 204)

  // Simula a falha do slide 2: a API processa, mas a resposta nunca chega inteira ao cliente.
  // Manda só o cabeçalho e corta: fechar sem enviar nada faz o Chrome reenviar o POST sozinho em conexões keep-alive.
  const perderResposta = req.headers['x-simular-falha'] === 'perder-resposta'
  const cortar = (status) => {
    res.writeHead(status)
    res.flushHeaders()
    res.socket.end()
  }
  const responder = (status, corpo, headers) => (perderResposta ? cortar(status) : enviar(res, status, corpo, headers))

  try {
    const { pathname } = new URL(req.url, 'http://localhost')

    if (pathname === '/api/estado' && req.method === 'GET') {
      const listaChaves = [...chaves].map(([chave, r]) => ({ chave, status: r.status, hash: r.hash.slice(0, 12), resposta: r.resposta?.status }))
      return enviar(res, 200, { cobrancas, chaves: listaChaves })
    }

    if (pathname === '/api/estado' && req.method === 'DELETE') {
      cobrancas = []
      chaves.clear()
      return enviar(res, 204)
    }

    if (pathname === '/api/sem-idempotencia/pagamentos' && req.method === 'POST') {
      const pagamento = await lerPagamento(req)
      return responder(201, await cobrar('sem', pagamento))
    }

    if (pathname === '/api/com-idempotencia/pagamentos' && req.method === 'POST') {
      const chave = req.headers['idempotency-key']
      if (!chave) return enviar(res, 400, { erro: 'Header Idempotency-Key obrigatório' })
      const pagamento = await lerPagamento(req)
      const hash = sha256(JSON.stringify([pagamento.pedido, pagamento.valor]))

      // Daqui até o set() não há await: no event loop do Node, verificar + reservar é atômico.
      const registro = chaves.get(chave)
      if (registro && registro.hash !== hash) return responder(422, { erro: 'Mesma Idempotency-Key com outro payload' })
      if (registro?.status === 'processando') return responder(409, { erro: 'Requisição com esta chave ainda em processamento' })
      if (registro) return responder(registro.resposta.status, registro.resposta.corpo, { 'idempotent-replayed': 'true' })

      chaves.set(chave, { status: 'processando', hash })
      const cobranca = await cobrar('com', pagamento, chave)
      chaves.set(chave, { status: 'concluida', hash, resposta: { status: 201, corpo: cobranca } })
      return responder(201, cobranca)
    }

    enviar(res, 404, { erro: 'rota não encontrada' })
  } catch (e) {
    enviar(res, 400, { erro: e.message })
  }
})

const porta = process.env.PORT ?? 3001
servidor.listen(porta, () => console.log(`API de pagamento em http://localhost:${servidor.address().port}`))
