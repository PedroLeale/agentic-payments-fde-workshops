import type { DisplayMessage } from '@agentic-aws/shared'

export type ToolRun = { name: string; arguments: unknown; result: unknown }
export type Turn = { role: 'user' | 'assistant'; content: string; tools?: ToolRun[] }

// Histórico salvo → o que a tela mostra, igual ao que o streaming produziria: cada mensagem de
// texto do usuário abre um turno; as ferramentas ficam no turno do usuário (painel lateral);
// o texto do assistente é o da última mensagem com texto, já que o stream zera o texto
// quando uma ferramenta é chamada.
export function toTurns(messages: DisplayMessage[]): Turn[] {
  const turns: Turn[] = []
  const pending = new Map<string, ToolRun>()
  let user: Turn | undefined
  let assistant: Turn | undefined

  for (const m of messages) {
    if (m.role === 'user') {
      const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      if (text) {
        user = { role: 'user', content: text }
        assistant = { role: 'assistant', content: '' }
        turns.push(user, assistant)
      }
      for (const b of m.content) {
        if (b.type !== 'tool_result') continue
        const run = pending.get(b.toolUseId)
        if (run) run.result = parseJson(b.content)
      }
      continue
    }
    if (!user || !assistant) continue
    const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    if (text) assistant.content = text
    for (const b of m.content) {
      if (b.type !== 'tool_use') continue
      const run: ToolRun = { name: b.name, arguments: b.input, result: undefined }
      pending.set(b.id, run)
      user.tools = [...(user.tools ?? []), run]
    }
  }
  return turns
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
