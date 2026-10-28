import type Anthropic from '@anthropic-ai/sdk'
import type { DisplayBlock, DisplayMessage } from '@agentic-aws/shared'

// Do formato gravado (blocos do Claude) para o que a página mostra. Thinking e qualquer
// bloco que a página não sabe desenhar ficam de fora.
export function toDisplay(messages: Anthropic.MessageParam[]): DisplayMessage[] {
  const out: DisplayMessage[] = []
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const content = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content.flatMap(toBlock)
    if (content.length > 0) out.push({ role: m.role, content })
  }
  return out
}

function toBlock(block: Anthropic.ContentBlockParam): DisplayBlock[] {
  switch (block.type) {
    case 'text':
      return [{ type: 'text', text: block.text }]
    case 'tool_use':
      return [{ type: 'tool_use', id: block.id, name: block.name, input: block.input }]
    case 'tool_result':
      return [
        {
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          content: textOf(block.content),
          isError: block.is_error ?? false,
        },
      ]
    default:
      return []
  }
}

function textOf(content: Anthropic.ToolResultBlockParam['content']) {
  if (!content || typeof content === 'string') return content ?? ''
  return content.map((c) => (c.type === 'text' ? c.text : '')).join('')
}
