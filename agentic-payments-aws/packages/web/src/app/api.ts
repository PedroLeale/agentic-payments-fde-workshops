import type { SessionHistory, SessionSummary, StreamLine } from '@agentic-aws/shared'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// `token` devolve o ID token do Cognito; é o que o authorizer do API Gateway valida.
export function apiClient(apiUrl: string, token: () => Promise<string>) {
  async function request(path: string, init: RequestInit = {}) {
    const res = await fetch(new URL(path, apiUrl), {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await token()}` },
    })
    if (!res.ok) {
      const body = await res.text()
      let message = body || `HTTP ${res.status}`
      try {
        message = JSON.parse(body).error ?? message
      } catch {}
      throw new ApiError(res.status, message)
    }
    return res
  }

  return {
    async listSessions(): Promise<SessionSummary[]> {
      return (await (await request('sessions')).json()).sessions
    },
    async history(id: string): Promise<SessionHistory> {
      return (await request(`sessions/${encodeURIComponent(id)}/messages`)).json()
    },
    async deleteSession(id: string) {
      await request(`sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    async chat(body: { sessionId?: string; message: string }, onLine: (line: StreamLine) => void) {
      const res = await request('chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.body) throw new Error('resposta sem corpo')
      await readNdjson(res.body, onLine)
    },
  }
}

export async function readNdjson(body: ReadableStream<Uint8Array>, onLine: (line: StreamLine) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = done ? '' : (lines.pop() ?? '')
    for (const line of lines) if (line.trim()) onLine(JSON.parse(line))
    if (done) return
  }
}
