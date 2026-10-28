import type Anthropic from '@anthropic-ai/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Sha256 } from '@aws-crypto/sha256-js'
import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { SignatureV4, type SignatureV4Init } from '@smithy/signature-v4'

export type ToolResult = { result: unknown; isError: boolean }

export interface Tools {
  definitions: Anthropic.Tool[]
  call(name: string, input: unknown): Promise<ToolResult>
}

export const NO_TOOLS: Tools = {
  definitions: [],
  call: async () => ({ result: { error: 'no tool server' }, isError: true }),
}

// O Gateway publica cada ferramenta como `<target>___<tool>`. O modelo vê só o nome curto,
// que é o que o system prompt cita; o mapa guarda o nome completo para o callTool.
const SEP = '___'

export function shortName(name: string) {
  const at = name.indexOf(SEP)
  return at === -1 ? name : name.slice(at + SEP.length)
}

// Gateway com inbound auth AWS_IAM: toda requisição MCP vai assinada com SigV4.
export function sigv4Fetch(
  region: string,
  credentials: SignatureV4Init['credentials'] = defaultProvider(),
  send: FetchLike = fetch
): FetchLike {
  const signer = new SignatureV4({ service: 'bedrock-agentcore', region, credentials, sha256: Sha256 })
  return async (url, init = {}) => {
    const u = new URL(url)
    if (init.body != null && typeof init.body !== 'string') throw new Error('sigv4Fetch: only string bodies are signed')
    const signed = await signer.sign({
      method: init.method ?? 'GET',
      protocol: u.protocol,
      hostname: u.hostname,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      headers: { ...Object.fromEntries(new Headers(init.headers).entries()), host: u.host },
      body: init.body ?? undefined,
    })
    const { host: _, ...headers } = signed.headers
    return send(url, { ...init, headers })
  }
}

export async function connectGateway(url: string, fetch: FetchLike): Promise<Tools> {
  const client = new Client({ name: 'agentic-aws-chat', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch }))

  const fullNames = new Map<string, string>()
  const definitions: Anthropic.Tool[] = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor ? { cursor } : {})
    for (const t of page.tools) {
      const name = shortName(t.name)
      fullNames.set(name, t.name)
      definitions.push({
        name,
        description: t.description ?? '',
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })
    }
    cursor = page.nextCursor
  } while (cursor)

  return {
    definitions,
    async call(name, input) {
      const full = fullNames.get(name)
      if (!full) return { result: { error: `unknown tool: ${name}` }, isError: true }
      let out: Awaited<ReturnType<Client['callTool']>>
      try {
        out = await client.callTool({ name: full, arguments: (input ?? {}) as Record<string, unknown> })
      } catch (err) {
        console.error(JSON.stringify({ msg: 'gateway callTool failed', tool: name, err: String(err) }))
        resetGateway()
        return { result: { error: 'tool call failed' }, isError: true }
      }
      const text = Array.isArray(out.content) ? out.content.find((c) => c.type === 'text')?.text : undefined
      let result: unknown = text
      try {
        result = JSON.parse(text ?? 'null')
      } catch {}
      const reportsError = typeof result === 'object' && result !== null && 'error' in result
      return { result, isError: Boolean(out.isError) || reportsError }
    },
  }
}

// Uma conexão por container quente. Se cair, a próxima invocação tenta de novo.
let cached: Promise<Tools> | undefined

export async function gatewayTools(url: string, region: string): Promise<Tools> {
  cached ??= connectGateway(url, sigv4Fetch(region))
  try {
    return await cached
  } catch (err) {
    cached = undefined
    throw err
  }
}

export function resetGateway() {
  cached = undefined
}
