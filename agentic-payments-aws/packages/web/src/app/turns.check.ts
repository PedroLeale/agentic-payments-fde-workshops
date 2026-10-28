import assert from 'node:assert/strict'
import type { StreamLine } from '@agentic-aws/shared'
import { readNdjson } from './api.ts'
import { toTurns } from './turns.ts'

// --- histórico salvo → turnos da tela ----------------------------------------------------------

assert.deepEqual(
  toTurns([
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
        { type: 'tool_result', toolUseId: 'tu2', content: 'lambda crashed', isError: true },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: 'R$ 4.799,00' }] },
    { role: 'user', content: [{ type: 'text', text: 'Obrigado' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'De nada!' }] },
  ]),
  [
    {
      role: 'user',
      content: 'Quanto custa o PS5?',
      tools: [
        { name: 'list_items', arguments: { search: 'playstation' }, result: { count: 1 } },
        { name: 'get_time', arguments: {}, result: 'lambda crashed' },
      ],
    },
    // Como no streaming: o texto antes da ferramenta é substituído pela resposta final.
    { role: 'assistant', content: 'R$ 4.799,00' },
    { role: 'user', content: 'Obrigado' },
    { role: 'assistant', content: 'De nada!' },
  ]
)

// Teto de rodadas: termina em tool_result, sem texto final.
assert.deepEqual(
  toTurns([
    { role: 'user', content: [{ type: 'text', text: 'x' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'list_items', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 't', content: '{}', isError: false }] },
  ]),
  [
    { role: 'user', content: 'x', tools: [{ name: 'list_items', arguments: {}, result: {} }] },
    { role: 'assistant', content: '' },
  ]
)
assert.deepEqual(toTurns([]), [])

// --- NDJSON: linhas quebradas no meio de chunks e de caracteres UTF-8 ---------------------------

const text = [
  { session: { id: 's1' } },
  { message: { role: 'assistant', content: 'Olá, ' } },
  { message: { role: 'assistant', content: 'preço: R$ 4.799,00 — ok' } },
  { done: true },
]
  .map((l) => JSON.stringify(l) + '\n')
  .join('')
const bytes = new TextEncoder().encode(text)
// Fatias de 7 bytes cortam "—" e "é" (multibyte) ao meio.
const body = new ReadableStream<Uint8Array>({
  start(c) {
    for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7))
    c.close()
  },
})
const lines: StreamLine[] = []
await readNdjson(body, (l) => lines.push(l))
assert.deepEqual(lines, JSON.parse(`[${text.trim().split('\n').join(',')}]`))

// Última linha sem \n no final também é lida.
const tail: StreamLine[] = []
await readNdjson(new Response('{"done":true}').body!, (l) => tail.push(l))
assert.deepEqual(tail, [{ done: true }])

console.log('turns.ts ok')
