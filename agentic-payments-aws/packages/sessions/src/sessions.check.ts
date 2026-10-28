import assert from 'node:assert/strict'
import type Anthropic from '@anthropic-ai/sdk'
import type { APIGatewayProxyEvent } from 'aws-lambda'
import type { Session } from '@agentic-aws/store'
import { toDisplay } from './display.ts'
import { sessionsHandler, type SessionsStore } from './sessions.ts'

// --- projeção do histórico ------------------------------------------------------------------

// Formato real gravado pela Lambda de chat: thinking + texto + tool_use, depois tool_result.
const stored = [
  { role: 'user', content: 'Quanto custa o PS5?' },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Vou ver.', citations: null },
      { type: 'tool_use', id: 'tu1', name: 'list_items', input: { search: 'playstation' } },
      { type: 'tool_use', id: 'tu2', name: 'get_time', input: {} },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'tu1', content: '{"count":1}' },
      { type: 'tool_result', tool_use_id: 'tu2', content: [{ type: 'text', text: '{"error":"x"}' }], is_error: true },
    ],
  },
  { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'sig2' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'R$ 4.799,00', citations: null }] },
] as Anthropic.MessageParam[]

assert.deepEqual(toDisplay(stored), [
  { role: 'user', content: [{ type: 'text', text: 'Quanto custa o PS5?' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Vou ver.' },
      { type: 'tool_use', id: 'tu1', name: 'list_items', input: { search: 'playstation' } },
      { type: 'tool_use', id: 'tu2', name: 'get_time', input: {} },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', toolUseId: 'tu1', content: '{"count":1}', isError: false },
      { type: 'tool_result', toolUseId: 'tu2', content: '{"error":"x"}', isError: true },
    ],
  },
  // a mensagem só com thinking some
  { role: 'assistant', content: [{ type: 'text', text: 'R$ 4.799,00' }] },
])
assert.equal(JSON.stringify(toDisplay(stored)).includes('sig'), false)

// --- rotas ------------------------------------------------------------------------------------

function memoryStore() {
  const sessions = new Map<string, Session & { owner: string }>()
  const messages = new Map<string, Anthropic.MessageParam[]>()
  const add = (owner: string, id: string, updatedAt: string, history: Anthropic.MessageParam[] = []) => {
    sessions.set(id, { owner, id, title: `t-${id}`, createdAt: '2026-10-01T00:00:00.000Z', updatedAt, lastSeq: history.length, ttl: 0 })
    messages.set(id, history)
  }
  let failNext = false
  const fail = () => {
    if (failNext) throw new Error('dynamo down with internal details')
  }
  const store: SessionsStore = {
    async getSession(owner, id) {
      fail()
      const s = sessions.get(id)
      if (!s || s.owner !== owner) return undefined
      const { owner: _, ...session } = s
      return session
    },
    async listSessions(owner) {
      fail()
      return [...sessions.values()]
        .filter((s) => s.owner === owner)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
    },
    async deleteSession(owner, id) {
      fail()
      const s = sessions.get(id)
      if (!s || s.owner !== owner) return false
      sessions.delete(id)
      messages.delete(id)
      return true
    },
    async loadMessages(id) {
      fail()
      return messages.get(id) ?? []
    },
  }
  return { store, add, sessions, failNext: () => (failNext = true) }
}

const event = (httpMethod: string, resource: string, opts: { id?: string; sub?: string | null; origin?: string } = {}) =>
  ({
    httpMethod,
    resource,
    pathParameters: opts.id ? { id: opts.id } : null,
    headers: opts.origin ? { origin: opts.origin } : {},
    requestContext: { authorizer: opts.sub === null ? undefined : { claims: { sub: opts.sub ?? 'user-a' } } },
  }) as unknown as APIGatewayProxyEvent

function setup() {
  const mem = memoryStore()
  mem.add('user-a', 's1', '2026-10-02T00:00:00.000Z', stored)
  mem.add('user-a', 's2', '2026-10-05T00:00:00.000Z')
  mem.add('user-b', 's3', '2026-10-09T00:00:00.000Z')
  return { handler: sessionsHandler({ store: mem.store, allowedOrigins: ['https://chat.example.com'] }), mem }
}

const json = (body: string) => (body ? JSON.parse(body) : undefined)

{
  const { handler } = setup()
  const res = await handler(event('GET', '/sessions', { origin: 'https://chat.example.com' }))
  assert.equal(res.statusCode, 200)
  assert.deepEqual(json(res.body).sessions.map((s: { id: string }) => s.id), ['s2', 's1'])
  assert.equal(res.headers!['Access-Control-Allow-Origin'], 'https://chat.example.com')
  assert.equal(res.headers!['Cache-Control'], 'no-store')
}

{
  const { handler } = setup()
  const res = await handler(event('GET', '/sessions/{id}/messages', { id: 's1' }))
  assert.equal(res.statusCode, 200)
  const body = json(res.body)
  assert.deepEqual(body.session, { id: 's1', title: 't-s1', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' })
  assert.deepEqual(body.messages, toDisplay(stored))
  // Nada de lastSeq/ttl/owner vazando.
  assert.equal(JSON.stringify(body).includes('lastSeq'), false)
}

{
  const { handler, mem } = setup()
  // Sessão de outro usuário: 404 tanto para ler quanto para apagar, e nada é apagado.
  assert.equal((await handler(event('GET', '/sessions/{id}/messages', { id: 's3' }))).statusCode, 404)
  assert.equal((await handler(event('DELETE', '/sessions/{id}', { id: 's3' }))).statusCode, 404)
  assert.ok(mem.sessions.has('s3'))

  const del = await handler(event('DELETE', '/sessions/{id}', { id: 's1' }))
  assert.equal(del.statusCode, 204)
  assert.equal(del.body, '')
  assert.equal(mem.sessions.has('s1'), false)
  assert.equal((await handler(event('DELETE', '/sessions/{id}', { id: 's1' }))).statusCode, 404)
}

{
  const { handler } = setup()
  assert.equal((await handler(event('GET', '/sessions', { sub: null }))).statusCode, 401)
  assert.equal((await handler(event('GET', '/sessions/{id}/messages'))).statusCode, 400)
  assert.equal((await handler(event('POST', '/sessions'))).statusCode, 404)
  const evil = await handler(event('GET', '/sessions', { origin: 'https://evil.example.com' }))
  assert.equal(evil.headers!['Access-Control-Allow-Origin'], undefined)
}

{
  const { handler, mem } = setup()
  mem.failNext()
  const res = await handler(event('GET', '/sessions'))
  assert.equal(res.statusCode, 500)
  assert.deepEqual(json(res.body), { error: 'erro interno' })
}

console.log('sessions.ts ok')
