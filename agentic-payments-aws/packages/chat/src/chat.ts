import type { Writable } from 'node:stream'
import type { APIGatewayProxyEvent } from 'aws-lambda'
import { corsHeaders, type StreamLine } from '@agentic-aws/shared'
import { ConcurrentTurn, type Store } from '@agentic-aws/store'
import { NO_TOOLS, type Tools } from './gateway.ts'
import { runTurn, TurnError, type Model } from './turn.ts'

export const MAX_MESSAGE_CHARS = 4000
const TITLE_CHARS = 60

export type ChatStore = Pick<Store, 'getSession' | 'createSession' | 'loadMessages' | 'appendMessages'>

export type ChatDeps = {
  model: Model
  modelId: string
  store: ChatStore
  tools: () => Promise<Tools>
  allowedOrigins: string[]
}

// Na Lambda é o HttpResponseStream.from: escreve os metadados e os 8 bytes nulos que o API Gateway exige.
export type OpenResponse = (metadata: { statusCode: number; headers: Record<string, string> }) => Writable

export function chatHandler(deps: ChatDeps) {
  return async (event: APIGatewayProxyEvent, open: OpenResponse) => {
    const origin = event.headers?.origin ?? event.headers?.Origin
    const headers = { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', ...corsHeaders(origin, deps.allowedOrigins) }
    const fail = (statusCode: number, error: string) => {
      const out = open({ statusCode, headers: { ...headers, 'Content-Type': 'application/json' } })
      out.end(JSON.stringify({ error }))
    }

    // O authorizer do Cognito já validou o JWT; o dono da sessão é o `sub` dele, nunca o corpo.
    const owner = event.requestContext.authorizer?.claims?.sub as string | undefined
    if (!owner) return fail(401, 'unauthorized')

    const body = parseBody(event)
    if (!body) return fail(400, 'body must be JSON: { "sessionId"?: string, "message": string }')
    const userText = body.message.trim()
    if (!userText || userText.length > MAX_MESSAGE_CHARS) return fail(400, `message must have 1 to ${MAX_MESSAGE_CHARS} characters`)

    const session = body.sessionId
      ? await deps.store.getSession(owner, body.sessionId)
      : await deps.store.createSession(owner, userText.replace(/\s+/g, ' ').slice(0, TITLE_CHARS))
    if (!session) return fail(404, 'session not found')

    const out = open({ statusCode: 200, headers })
    const emit = (line: StreamLine) => out.write(JSON.stringify(line) + '\n')
    emit({ session: { id: session.id } })

    try {
      const history = await deps.store.loadMessages(session.id)
      const tools = await deps.tools().catch((err) => {
        console.error(JSON.stringify({ msg: 'gateway unavailable', err: String(err) }))
        return NO_TOOLS
      })
      const turn = await runTurn({ model: deps.model, modelId: deps.modelId, tools, history, userText, emit })
      await deps.store.appendMessages(owner, session, turn.messages)
      // Só ids e contagens no log: o conteúdo da conversa pode ter dado pessoal (LGPD).
      console.log(JSON.stringify({ msg: 'turn', sessionId: session.id, rounds: turn.rounds, stored: turn.messages.length, usage: turn.usage }))
      emit({ done: true })
    } catch (err) {
      console.error(JSON.stringify({ msg: 'turn failed', sessionId: session.id, err: err instanceof Error ? err.constructor.name : 'unknown' }))
      emit({ error: publicMessage(err), done: true })
    } finally {
      out.end()
    }
  }
}

function publicMessage(err: unknown) {
  if (err instanceof TurnError) return err.message
  if (err instanceof ConcurrentTurn) return 'esta conversa recebeu outra mensagem ao mesmo tempo; tente de novo'
  return 'erro interno'
}

function parseBody(event: APIGatewayProxyEvent): { sessionId?: string; message: string } | undefined {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '')
    const body: unknown = JSON.parse(raw)
    if (typeof body !== 'object' || body === null) return undefined
    const { sessionId, message } = body as Record<string, unknown>
    if (typeof message !== 'string') return undefined
    if (sessionId !== undefined && typeof sessionId !== 'string') return undefined
    return { sessionId: sessionId || undefined, message }
  } catch {
    return undefined
  }
}
