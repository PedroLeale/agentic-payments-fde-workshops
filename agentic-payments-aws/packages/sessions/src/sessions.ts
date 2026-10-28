import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { corsHeaders, type SessionHistory, type SessionSummary } from '@agentic-aws/shared'
import type { Store } from '@agentic-aws/store'
import { toDisplay } from './display.ts'

export type SessionsStore = Pick<Store, 'getSession' | 'listSessions' | 'deleteSession' | 'loadMessages'>

export type SessionsDeps = { store: SessionsStore; allowedOrigins: string[] }

export function sessionsHandler({ store, allowedOrigins }: SessionsDeps) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers?.origin ?? event.headers?.Origin
    const reply = (statusCode: number, body?: unknown): APIGatewayProxyResult => ({
      statusCode,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin, allowedOrigins) },
      body: body === undefined ? '' : JSON.stringify(body),
    })

    // O authorizer do Cognito já validou o JWT; só se vê e apaga o que é do próprio `sub`.
    const owner = event.requestContext.authorizer?.claims?.sub as string | undefined
    if (!owner) return reply(401, { error: 'unauthorized' })
    const id = event.pathParameters?.id

    try {
      switch (`${event.httpMethod} ${event.resource}`) {
        case 'GET /sessions':
          return reply(200, { sessions: await store.listSessions(owner) })

        case 'GET /sessions/{id}/messages': {
          if (!id) return reply(400, { error: 'missing session id' })
          // Sessão de outro usuário responde igual a inexistente.
          const session = await store.getSession(owner, id)
          if (!session) return reply(404, { error: 'session not found' })
          const { title, createdAt, updatedAt } = session
          const summary: SessionSummary = { id: session.id, title, createdAt, updatedAt }
          const body: SessionHistory = { session: summary, messages: toDisplay(await store.loadMessages(id)) }
          return reply(200, body)
        }

        case 'DELETE /sessions/{id}':
          if (!id) return reply(400, { error: 'missing session id' })
          return (await store.deleteSession(owner, id)) ? reply(204) : reply(404, { error: 'session not found' })

        default:
          return reply(404, { error: 'not found' })
      }
    } catch (err) {
      console.error(JSON.stringify({ msg: 'sessions failed', route: `${event.httpMethod} ${event.resource}`, err: err instanceof Error ? err.constructor.name : 'unknown' }))
      return reply(500, { error: 'erro interno' })
    }
  }
}
