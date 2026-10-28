import type Anthropic from '@anthropic-ai/sdk'
import type { StreamLine } from '@agentic-aws/shared'
import type { Tools } from './gateway.ts'
import { SYSTEM } from './prompt.ts'

// Sem teto o modelo pode ficar chamando ferramenta para sempre.
export const MAX_ROUNDS = 4

export interface ModelStream {
  on(event: 'text', listener: (delta: string) => void): unknown
  finalMessage(): Promise<Anthropic.Message>
}

export type Model = (params: Anthropic.MessageStreamParams) => ModelStream

// Falha que pode ser mostrada para o usuário como está.
export class TurnError extends Error {}

export type TurnInput = {
  model: Model
  modelId: string
  tools: Tools
  history: Anthropic.MessageParam[]
  userText: string
  emit: (line: StreamLine) => void
}

export type TurnOutput = {
  messages: Anthropic.MessageParam[]
  rounds: number
  usage: { input: number; output: number; cacheRead: number }
}

// Um turno: a mensagem do usuário e tudo que o modelo e as ferramentas produziram até ele
// parar de pedir ferramenta. Só é gravado se terminar sem erro.
export async function runTurn({ model, modelId, tools, history, userText, emit }: TurnInput): Promise<TurnOutput> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userText }]
  const usage = { input: 0, output: 0, cacheRead: 0 }

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const stream = model({
      model: modelId,
      // Teto do Haiku 4.5.
      max_tokens: 64000,
      system: SYSTEM,
      ...(tools.definitions.length > 0 && { tools: tools.definitions }),
      // Haiku 4.5: sem `effort` (dá 400) e sem `cache_control` no topo (a integração
      // bedrock-runtime recusa); o prompt fixo é pequeno demais para o cache de qualquer jeito.
      messages: [...history, ...messages],
    })
    stream.on('text', (delta) => emit({ message: { role: 'assistant', content: delta } }))
    const message = await stream.finalMessage()

    usage.input += message.usage.input_tokens
    usage.output += message.usage.output_tokens
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0

    // Recusa pode cortar um tool_use no meio; nada deste turno vale.
    if (message.stop_reason === 'refusal') throw new TurnError('o modelo recusou responder')

    const uses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (uses.length > 0 && message.stop_reason === 'max_tokens') throw new TurnError('resposta cortada no limite de tokens')

    messages.push({ role: 'assistant', content: message.content })
    if (uses.length === 0) return { messages, rounds: round, usage }

    const results = await Promise.all(
      uses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        const { result, isError } = await tools.call(use.name, use.input)
        emit({ tool: { name: use.name, arguments: use.input, result } })
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(result),
          ...(isError && { is_error: true }),
        }
      })
    )
    // Todos os resultados numa mensagem só, senão o modelo desaprende a chamar em paralelo.
    messages.push({ role: 'user', content: results })
  }

  return { messages, rounds: MAX_ROUNDS, usage }
}
