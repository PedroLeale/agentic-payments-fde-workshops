'use client'

import { useRef, useState } from 'react'
import Markdown from 'react-markdown'

type Role = 'system' | 'user' | 'assistant'
type Message = { role: Role; content: string }
type ToolRun = { name: string; arguments: Record<string, unknown>; result: unknown }
type Turn = Message & { sent?: Message[]; tools?: ToolRun[] }
type ChatId = 'stateless' | 'withHistory'

const SYSTEM: Message = {
  role: 'system',
  content:
    'Você é um vendedor de uma loja de eletrônicos. Responda SEMPRE em português brasileiro, de forma objetiva e educada. Nunca escreva em inglês. ' +
    'Fale apenas sobre a loja: produtos, preços, disponibilidade e horário. Se perguntarem outra coisa, diga que só pode ajudar com a loja. ' +
    'Você tem ferramentas: use get_time para qualquer pergunta sobre data ou hora atual, e list_items para qualquer pergunta sobre o que está à venda ou quanto custa. ' +
    'Nunca invente produtos nem preços — chame a ferramenta. Mostre os preços em reais, no formato R$ 1.234,56.',
}

const CHATS: { id: ChatId; label: string }[] = [
  { id: 'stateless', label: 'Sem memória (só a última mensagem)' },
  { id: 'withHistory', label: 'Histórico completo' },
]

export default function Page() {
  const [chats, setChats] = useState<Record<ChatId, Turn[]>>({
    stateless: [],
    withHistory: [],
  })
  const [active, setActive] = useState<ChatId>('stateless')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [peek, setPeek] = useState<number | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const messages = chats[active]

  function showPeek(i: number) {
    clearTimeout(closeTimer.current)
    setPeek(i)
  }
  function hidePeek() {
    closeTimer.current = setTimeout(() => setPeek(null), 400)
  }

  function setChat(id: ChatId, next: Turn[]) {
    setChats((prev) => ({ ...prev, [id]: next }))
  }

  async function send(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!input.trim() || busy) return

    const id = active
    const user: Message = { role: 'user', content: input }
    const history = chats[id].map(({ role, content }) => ({ role, content }))
    const payload: Message[] =
      id === 'withHistory' ? [SYSTEM, ...history, user] : [SYSTEM, user]

    const turn: Turn = { ...user, sent: payload }
    const next: Turn[] = [...chats[id], turn]
    setChat(id, [...next, { role: 'assistant', content: '' }])
    setInput('')
    setBusy(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payload }),
      })
      if (!res.ok || !res.body) throw new Error(await res.text())

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      let reply = ''

      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const chunk = JSON.parse(line)
          if (chunk.error) throw new Error(chunk.error)
          if (chunk.tool) {
            turn.tools = [...(turn.tools ?? []), chunk.tool]
            reply = ''
          }
          reply += chunk.message?.content ?? ''
          setChat(id, [...next, { role: 'assistant', content: reply }])
        }
      }
    } catch (err) {
      setChat(id, [...next, { role: 'assistant', content: `Erro: ${err}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex h-screen max-w-2xl flex-col gap-4 p-4">
      <div className="flex gap-2">
        {CHATS.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setActive(c.id)
              setPeek(null)
            }}
            className={
              c.id === active
                ? 'rounded bg-blue-600 px-3 py-2 text-sm text-white'
                : 'rounded border px-3 py-2 text-sm'
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-gray-500">
            {active === 'withHistory'
              ? 'Todas as mensagens anteriores vão junto em cada requisição.'
              : 'Só a sua última mensagem é enviada — o modelo não vê histórico.'}
          </p>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div
              key={i}
              onMouseEnter={() => showPeek(i)}
              onMouseLeave={hidePeek}
              className="ml-auto w-fit max-w-[80%] cursor-help whitespace-pre-wrap rounded bg-blue-600 px-3 py-2 text-white"
            >
              {m.content}
            </div>
          ) : (
            <div
              key={i}
              className="prose-chat w-fit max-w-[80%] rounded bg-gray-200 px-3 py-2 dark:bg-gray-800"
            >
              {m.content ? <Markdown>{m.content}</Markdown> : '…'}
            </div>
          )
        )}
      </div>

      <form onSubmit={send} className="flex gap-2">
        <input
          className="flex-1 rounded border px-3 py-2"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte alguma coisa…"
        />
        <button className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50" disabled={busy}>
          Enviar
        </button>
      </form>

      {peek !== null && messages[peek]?.sent && (
        <aside
          onMouseEnter={() => showPeek(peek)}
          onMouseLeave={hidePeek}
          className="fixed right-4 top-4 z-10 max-h-[calc(100vh-2rem)] w-80 overflow-y-auto rounded border border-gray-300 bg-white p-3 text-xs shadow-lg xl:w-96 dark:border-gray-700 dark:bg-gray-900"
        >
          <p className="mb-2 font-semibold">
            Enviado ao modelo ({messages[peek].sent.length}{' '}
            {messages[peek].sent.length === 1 ? 'mensagem' : 'mensagens'})
          </p>
          {messages[peek].tools?.map((t, j) => (
            <div key={`tool-${j}`} className="mb-2 rounded border border-amber-400 bg-amber-50 p-2 dark:bg-amber-950">
              <span className="font-mono uppercase text-amber-700 dark:text-amber-400">ferramenta · {t.name}</span>
              <p className="whitespace-pre-wrap font-mono">
                {JSON.stringify(t.arguments)} → {JSON.stringify(t.result)}
              </p>
            </div>
          ))}
          {messages[peek].sent.map((s, j) => (
            <div key={j} className="mb-2 last:mb-0">
              <span className="font-mono uppercase text-gray-500">{s.role}</span>
              <p className="whitespace-pre-wrap">{s.content}</p>
            </div>
          ))}
        </aside>
      )}
    </main>
  )
}
