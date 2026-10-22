// Os 4 cenários do slide "Demo ao vivo", direto contra a API. Rode com: npm test
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'

process.env.PORT = '0'
process.env.PROCESSAMENTO_MS = '50'
const { servidor } = await import('./server.mjs')
if (!servidor.listening) await once(servidor, 'listening')
const base = `http://localhost:${servidor.address().port}/api`
after(() => {
  servidor.closeAllConnections()
  servidor.close()
})
beforeEach(() => fetch(`${base}/estado`, { method: 'DELETE' }))

const pedido = { pedido: 'A-101', valor: 100 }
const perder = { 'x-simular-falha': 'perder-resposta' }
const pagar = (modo, corpo, headers = {}) =>
  fetch(`${base}/${modo}-idempotencia/pagamentos`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corpo) })
const pagarPerdendo = (modo, corpo, headers = {}) => pagar(modo, corpo, { ...headers, ...perder }).then((r) => r.json())
const cobrancas = async () => (await (await fetch(`${base}/estado`)).json()).cobrancas

test('1. sem chave + timeout -> cobrança dupla', async () => {
  await assert.rejects(pagarPerdendo('sem', pedido))
  assert.equal((await pagar('sem', pedido)).status, 201)
  assert.equal((await cobrancas()).length, 2)
})

test('2. com chave + timeout -> 1 cobrança só, retry recebe a resposta salva', async () => {
  const chave = { 'idempotency-key': 'k-2' }
  await assert.rejects(pagarPerdendo('com', pedido, chave))
  const retry = await pagar('com', pedido, chave)
  assert.equal(retry.status, 201)
  assert.equal(retry.headers.get('idempotent-replayed'), 'true')
  assert.equal((await cobrancas()).length, 1)
})

test('3. clique duplo -> 409, nada duplicado', async () => {
  const chave = { 'idempotency-key': 'k-3' }
  const respostas = await Promise.all([pagar('com', pedido, chave), pagar('com', pedido, chave)])
  assert.deepEqual(respostas.map((r) => r.status).sort(), [201, 409])
  assert.equal((await cobrancas()).length, 1)
})

test('4. mesma chave, outro valor -> 422', async () => {
  const chave = { 'idempotency-key': 'k-4' }
  assert.equal((await pagar('com', pedido, chave)).status, 201)
  assert.equal((await pagar('com', { ...pedido, valor: 150 }, chave)).status, 422)
  assert.equal((await cobrancas()).length, 1)
})

test('sem Idempotency-Key ou payload inválido -> 400', async () => {
  assert.equal((await pagar('com', pedido)).status, 400)
  assert.equal((await pagar('sem', { pedido: 'A-1', valor: -5 })).status, 400)
})
