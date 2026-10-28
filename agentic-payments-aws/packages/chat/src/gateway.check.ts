import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { connectGateway, shortName, sigv4Fetch } from './gateway.ts'

assert.equal(shortName('catalog___list_items'), 'list_items')
assert.equal(shortName('get_time'), 'get_time')
assert.equal(shortName('a___b___c'), 'b___c')

// SigV4: assina com o serviço do AgentCore, mantém corpo e headers, não manda Host à mão.
{
  const sent: { url: string; init: RequestInit }[] = []
  const signedFetch = sigv4Fetch(
    'us-east-1',
    { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', sessionToken: 'token' },
    async (url, init) => {
      sent.push({ url: String(url), init: init ?? {} })
      return new Response('{}')
    }
  )
  const url = 'https://gw-123.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp'
  await signedFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
  const { init } = sent[0]!
  const headers = init.headers as Record<string, string>
  assert.match(headers.authorization!, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/bedrock-agentcore\/aws4_request/)
  assert.ok(headers['x-amz-date'])
  assert.equal(headers['x-amz-security-token'], 'token')
  assert.equal(headers['content-type'], 'application/json')
  assert.equal(headers.host, undefined)
  assert.equal(init.body, '{"a":1}')
  await assert.rejects(signedFetch(url, { method: 'POST', body: new Uint8Array([1]) }), /only string bodies/)
}

// Cliente MCP contra um servidor MCP de verdade, com os nomes no formato do Gateway.
{
  const calls: { name: string; args: unknown }[] = []
  const http = createServer(async (req, res) => {
    const server = new Server({ name: 'fake-gateway', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'time___get_time', description: 'hora', inputSchema: { type: 'object', properties: { timezone: { type: 'string' } } } },
        { name: 'catalog___list_items', description: 'itens', inputSchema: { type: 'object', properties: { search: { type: 'string' } } } },
      ],
    }))
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      calls.push({ name: req.params.name, args: req.params.arguments })
      if (req.params.name === 'time___get_time') {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'unknown timezone: Mars/Olympus' }) }] }
      }
      if (req.params.arguments?.search === 'boom') return { content: [{ type: 'text', text: 'lambda crashed' }], isError: true }
      return { content: [{ type: 'text', text: JSON.stringify({ count: 1, items: [{ sku: 'PS5' }] }) }] }
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => transport.close())
    await server.connect(transport)
    await transport.handleRequest(req, res)
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo

  try {
    const tools = await connectGateway(`http://127.0.0.1:${port}/mcp`, fetch)
    assert.deepEqual(tools.definitions.map((d) => d.name), ['get_time', 'list_items'])
    assert.equal(tools.definitions[1]!.description, 'itens')
    assert.deepEqual(tools.definitions[1]!.input_schema, { type: 'object', properties: { search: { type: 'string' } } })

    assert.deepEqual(await tools.call('list_items', { search: 'play' }), { result: { count: 1, items: [{ sku: 'PS5' }] }, isError: false })
    assert.deepEqual(calls.at(-1), { name: 'catalog___list_items', args: { search: 'play' } })

    // A Lambda devolve { error } quando o argumento é ruim: vira is_error para o modelo.
    assert.deepEqual(await tools.call('get_time', { timezone: 'Mars/Olympus' }), {
      result: { error: 'unknown timezone: Mars/Olympus' },
      isError: true,
    })
    assert.deepEqual(await tools.call('list_items', { search: 'boom' }), { result: 'lambda crashed', isError: true })
    assert.deepEqual(await tools.call('nope', {}), { result: { error: 'unknown tool: nope' }, isError: true })
  } finally {
    http.closeAllConnections()
    http.close()
  }
}

console.log('gateway.ts ok')
