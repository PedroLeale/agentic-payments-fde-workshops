import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b'
const MCP_URL = process.env.MCP_URL ?? 'http://localhost:4000/mcp'
const HOLD_MS = 600
const MAX_ROUNDS = 4

type Message = { role: string; content: string; tool_calls?: ToolCall[] }
type ToolCall = { function: { name: string; arguments: Record<string, unknown> } }

async function connect() {
  const client = new Client({ name: 'ollama-chat', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)))
  return client
}

function toOllamaTools(mcpTools: { name: string; description?: string; inputSchema: unknown }[]) {
  return mcpTools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema },
  }))
}

async function runTool(client: Client, call: ToolCall) {
  try {
    const out = await client.callTool({ name: call.function.name, arguments: call.function.arguments ?? {} })
    const text = Array.isArray(out.content) ? out.content.find((c) => c.type === 'text')?.text : undefined
    if (out.isError) return { error: text ?? 'tool failed' }
    try {
      return JSON.parse(text ?? 'null')
    } catch {
      return text
    }
  } catch (err) {
    return { error: `mcp: ${err}` }
  }
}

export async function POST(request: Request) {
  const { messages } = await request.json()
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages must be a non-empty array' }, { status: 400 })
  }

  let client: Client | undefined
  let tools: unknown[] | undefined
  try {
    client = await connect()
    tools = toOllamaTools((await client.listTools()).tools)
  } catch {
    client = undefined
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const line = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      const convo: Message[] = [...messages]

      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const res = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODEL, messages: convo, tools, stream: true }),
            signal: request.signal,
          })
          if (!res.ok || !res.body) {
            line({ error: `ollama: ${res.status} ${await res.text()}`, done: true })
            break
          }

          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
          let buffer = ''
          let content = ''
          const calls: ToolCall[] = []
          let held = ''
          let live = false
          const started = Date.now()
          const flush = () => {
            if (held) line({ message: { role: 'assistant', content: held } })
            held = ''
            live = true
          }

          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += value
            const parts = buffer.split('\n')
            buffer = parts.pop() ?? ''
            for (const part of parts) {
              if (!part.trim()) continue
              const chunk = JSON.parse(part)
              const text = chunk.message?.content ?? ''
              if (text) {
                content += text
                if (live) line(chunk)
                else {
                  held += text
                  if (Date.now() - started > HOLD_MS) flush()
                }
              }
              if (chunk.message?.tool_calls) {
                calls.push(...chunk.message.tool_calls)
                held = ''
              }
            }
          }

          if (calls.length === 0) {
            flush()
            line({ done: true })
            break
          }

          convo.push({ role: 'assistant', content, tool_calls: calls })
          for (const call of calls) {
            const result = client ? await runTool(client, call) : { error: 'no tool server' }
            convo.push({ role: 'tool', content: JSON.stringify(result) })
            line({ tool: { name: call.function.name, arguments: call.function.arguments, result } })
          }
        }
      } catch (err) {
        line({ error: String(err), done: true })
      } finally {
        await client?.close()
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  })
}
