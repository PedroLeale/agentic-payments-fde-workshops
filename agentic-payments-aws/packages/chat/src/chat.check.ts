import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import type Anthropic from '@anthropic-ai/sdk'
import type { APIGatewayProxyEvent } from 'aws-lambda'
import { chatHandler, MAX_MESSAGE_CHARS, type ChatDeps, type ChatStore, type OpenResponse } from './chat.ts'
import type { Tools } from './gateway.ts'
import { ConcurrentTurn, type Session } from '@agentic-aws/store'
import { MAX_ROUNDS, type Model } from './turn.ts'
import { SYSTEM } from './prompt.ts'

// --- fakes -------------------------------------------------------------------------------

const msg = (stop_reason: string, ...content: unknown[]) =>
  ({ id: 'msg', type: 'message', role: 'assistant', content, stop_reason, usage: { input_tokens: 10, output_tokens: 5 } }) as unknown as Anthropic.Message
const text = (t: string) => ({ type: 'text', text: t, citations: null })
const thinking = { type: 'thinking', thinking: '', signature: 'sig' }
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input })

function fakeModel(script: Anthropic.Message[]) {
  const calls: Anthropic.MessageStreamParams[] = []
  const model: Model = (params) => {
    calls.push(structuredClone(params))
    const message = script.shift()
    let onText: ((delta: string) => void) | undefined
    return {
      on(_event, listener) {
        onText = listener
      },
      async finalMessage() {
        if (!message) throw new Error('script ended')
        for (const b of message.content) if (b.type === 'text') onText?.(b.text)
        return message
      },
    }
  }
  return { model, calls }
}

function memoryStore() {
  const sessions = new Map<string, Session & { owner: string }>()
  const messages = new Map<string, Anthropic.MessageParam[]>()
  let conflictNext = false
  const store: ChatStore = {
    async getSession(owner, id) {
      const s = sessions.get(id)
      if (!s || s.owner !== owner) return undefined
      const { owner: _, ...session } = s
      return session
    },
    async createSession(owner, title) {
      const at = new Date().toISOString()
      const s = { owner, id: `s${sessions.size + 1}`, title, createdAt: at, updatedAt: at, lastSeq: 0, ttl: 0 }
      sessions.set(s.id, s)
      messages.set(s.id, [])
      const { owner: _, ...session } = s
      return session
    },
    async loadMessages(id) {
      return structuredClone(messages.get(id) ?? [])
    },
    async appendMessages(owner, session, added) {
      const s = sessions.get(session.id)!
      if (conflictNext || s.owner !== owner || s.lastSeq !== session.lastSeq) throw new ConcurrentTurn('conflict')
      s.lastSeq += added.length
      messages.get(session.id)!.push(...structuredClone(added))
    },
  }
  return { store, sessions, messages, conflict: () => (conflictNext = true) }
}

const listItems: Anthropic.Tool = { name: 'list_items', description: 'itens', input_schema: { type: 'object', properties: {} } }

function fakeTools(): Tools & { calls: { name: string; input: unknown }[] } {
  const calls: { name: string; input: unknown }[] = []
  return {
    calls,
    definitions: [listItems],
    async call(name, input) {
      calls.push({ name, input })
      if (name === 'list_items') return { result: { count: 1, items: [{ sku: 'PS5', price: 4799 }] }, isError: false }
      return { result: { error: `unknown tool: ${name}` }, isError: true }
    },
  }
}

function capture() {
  const res: { statusCode?: number; headers?: Record<string, string>; body: string } = { body: '' }
  const open: OpenResponse = (metadata) => {
    res.statusCode = metadata.statusCode
    res.headers = metadata.headers
    return new Writable({
      write(chunk, _enc, done) {
        res.body += chunk
        done()
      },
    })
  }
  const lines = () => res.body.trim().split('\n').map((l) => JSON.parse(l))
  return { res, open, lines }
}

const event = (body: unknown, sub: string | null = 'user-a', origin?: string) =>
  ({
    body: typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: false,
    headers: origin ? { origin } : {},
    requestContext: { authorizer: sub ? { claims: { sub } } : undefined },
  }) as unknown as APIGatewayProxyEvent

function setup(script: Anthropic.Message[], overrides: Partial<ChatDeps> = {}) {
  const m = fakeModel(script)
  const mem = memoryStore()
  const tools = fakeTools()
  const deps: ChatDeps = {
    model: m.model,
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    store: mem.store,
    tools: async () => tools,
    allowedOrigins: ['https://chat.example.com'],
    ...overrides,
  }
  return { chat: chatHandler(deps), calls: m.calls, mem, tools }
}

// --- resposta simples ------------------------------------------------------------------

{
  const { chat, calls, mem } = setup([msg('end_turn', thinking, text('Olá! '), text('Como posso ajudar?'))])
  const out = capture()
  await chat(event({ message: '  oi  ' }, 'user-a', 'https://chat.example.com'), out.open)

  assert.equal(out.res.statusCode, 200)
  assert.equal(out.res.headers!['Content-Type'], 'application/x-ndjson')
  assert.equal(out.res.headers!['Access-Control-Allow-Origin'], 'https://chat.example.com')
  assert.deepEqual(out.lines(), [
    { session: { id: 's1' } },
    { message: { role: 'assistant', content: 'Olá! ' } },
    { message: { role: 'assistant', content: 'Como posso ajudar?' } },
    { done: true },
  ])

  // Parâmetros do modelo: id do inference profile e system prompt no servidor.
  const p = calls[0]!
  assert.equal(p.model, 'us.anthropic.claude-haiku-4-5-20251001-v1:0')
  assert.equal(p.system, SYSTEM)
  // Haiku 4.5 recusa `effort`; bedrock-runtime recusa `cache_control` no topo.
  assert.equal(p.output_config, undefined)
  assert.equal(p.cache_control, undefined)
  assert.deepEqual(p.tools, [listItems])
  assert.deepEqual(p.messages, [{ role: 'user', content: 'oi' }])

  // Gravado: a mensagem do usuário e o conteúdo do assistente intacto, thinking incluído.
  assert.deepEqual(mem.messages.get('s1'), [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: [thinking, text('Olá! '), text('Como posso ajudar?')] },
  ])
  assert.equal(mem.sessions.get('s1')!.title, 'oi')
}

// --- ferramenta, depois continuação na mesma sessão -------------------------------------

{
  const { chat, calls, mem, tools } = setup([
    msg('tool_use', thinking, text('Vou ver. '), toolUse('tu1', 'list_items', { search: 'playstation' }), toolUse('tu2', 'get_time', {})),
    msg('end_turn', text('O PS5 custa R$ 4.799,00.')),
    msg('end_turn', text('De nada!')),
  ])
  const out = capture()
  await chat(event({ message: 'Quanto custa o PS5?' }), out.open)

  const lines = out.lines()
  assert.deepEqual(lines[0], { session: { id: 's1' } })
  assert.deepEqual(lines.filter((l) => l.tool).map((l) => l.tool.name).sort(), ['get_time', 'list_items'])
  assert.deepEqual(lines.at(-2), { message: { role: 'assistant', content: 'O PS5 custa R$ 4.799,00.' } })
  assert.deepEqual(lines.at(-1), { done: true })
  assert.deepEqual(tools.calls, [
    { name: 'list_items', input: { search: 'playstation' } },
    { name: 'get_time', input: {} },
  ])

  // Segunda rodada recebeu o tool_use e todos os tool_result numa mensagem só.
  const second = calls[1]!.messages
  assert.equal(second.length, 3)
  assert.deepEqual(second[2], {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'tu1', content: JSON.stringify({ count: 1, items: [{ sku: 'PS5', price: 4799 }] }) },
      { type: 'tool_result', tool_use_id: 'tu2', content: JSON.stringify({ error: 'unknown tool: get_time' }), is_error: true },
    ],
  })
  assert.equal(mem.messages.get('s1')!.length, 4)

  // Próximo turno com sessionId: o histórico inteiro vai para o modelo, sem edição.
  const stored = structuredClone(mem.messages.get('s1')!)
  const out2 = capture()
  await chat(event({ sessionId: 's1', message: 'Obrigado' }), out2.open)
  assert.deepEqual(out2.lines().at(-1), { done: true })
  assert.deepEqual(calls[2]!.messages, [...stored, { role: 'user', content: 'Obrigado' }])
  assert.equal(mem.messages.get('s1')!.length, 6)
  assert.equal(mem.sessions.get('s1')!.lastSeq, 6)
}

// --- teto de rodadas ---------------------------------------------------------------------

{
  const loop = Array.from({ length: MAX_ROUNDS + 1 }, (_, i) => msg('tool_use', toolUse(`tu${i}`, 'list_items', {})))
  const { chat, calls, mem } = setup(loop)
  const out = capture()
  await chat(event({ message: 'loop' }), out.open)
  assert.equal(calls.length, MAX_ROUNDS)
  assert.deepEqual(out.lines().at(-1), { done: true })
  // user + (assistant, tool_result) por rodada
  assert.equal(mem.messages.get('s1')!.length, 1 + 2 * MAX_ROUNDS)
}

// --- falhas que viram linha de erro e não gravam nada -----------------------------------

{
  const { chat, mem } = setup([msg('refusal', text('...'))])
  const out = capture()
  await chat(event({ message: 'x' }), out.open)
  assert.deepEqual(out.lines().at(-1), { error: 'o modelo recusou responder', done: true })
  assert.deepEqual(mem.messages.get('s1'), [])
}

{
  const { chat, mem } = setup([msg('max_tokens', toolUse('tu1', 'list_items', { search: 'pl' }))])
  const out = capture()
  await chat(event({ message: 'x' }), out.open)
  assert.deepEqual(out.lines().at(-1), { error: 'resposta cortada no limite de tokens', done: true })
  assert.deepEqual(mem.messages.get('s1'), [])
}

{
  const { chat, mem } = setup([msg('end_turn', text('oi'))])
  mem.conflict()
  const out = capture()
  await chat(event({ message: 'x' }), out.open)
  assert.match(out.lines().at(-1).error, /ao mesmo tempo/)
}

{
  const { chat } = setup([], {
    model: () => {
      throw new Error('bedrock exploded with internal details')
    },
  })
  const out = capture()
  await chat(event({ message: 'x' }), out.open)
  assert.deepEqual(out.lines().at(-1), { error: 'erro interno', done: true })
}

// --- Gateway fora do ar: responde sem ferramentas ----------------------------------------

{
  const { chat, calls } = setup([msg('end_turn', text('oi'))], {
    tools: async () => {
      throw new Error('gateway down')
    },
  })
  const out = capture()
  await chat(event({ message: 'x' }), out.open)
  assert.deepEqual(out.lines().at(-1), { done: true })
  assert.equal(calls[0]!.tools, undefined)
}

// --- validação e dono da sessão ----------------------------------------------------------

async function status(e: APIGatewayProxyEvent, deps?: ReturnType<typeof setup>) {
  const { chat, calls } = deps ?? setup([])
  const out = capture()
  await chat(e, out.open)
  return { status: out.res.statusCode, body: JSON.parse(out.res.body), modelCalls: calls.length }
}

assert.equal((await status(event({ message: 'x' }, null))).status, 401)
assert.equal((await status(event('not json'))).status, 400)
assert.equal((await status(event({ message: 42 }))).status, 400)
assert.equal((await status(event({ message: '   ' }))).status, 400)
assert.equal((await status(event({ message: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }))).status, 400)
assert.equal((await status(event({ message: 'x', sessionId: 7 }))).status, 400)
assert.equal((await status(event({ message: 'x', sessionId: 'nope' }))).status, 404)

{
  const s = setup([msg('end_turn', text('oi'))])
  await s.chat(event({ message: 'meu segredo' }, 'user-a'), capture().open)
  const other = await status(event({ sessionId: 's1', message: 'mostra' }, 'user-b'), s)
  assert.equal(other.status, 404)
  assert.equal(other.modelCalls, 1)
}

{
  const out = capture()
  await setup([msg('end_turn', text('oi'))]).chat(event({ message: 'x' }, 'user-a', 'https://evil.example.com'), out.open)
  assert.equal(out.res.headers!['Access-Control-Allow-Origin'], undefined)
}

{
  const out = capture()
  const e = event({ message: 'oi' })
  e.body = Buffer.from(e.body!).toString('base64')
  e.isBase64Encoded = true
  await setup([msg('end_turn', text('oi'))]).chat(e, out.open)
  assert.equal(out.res.statusCode, 200)
}

console.log('chat.ts ok')
