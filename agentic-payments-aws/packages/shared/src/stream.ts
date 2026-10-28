// Uma linha de NDJSON no stream de POST /chat. Mesmo formato que o ollama-chat já lia,
// mais a linha `session` no começo.
export type StreamLine =
  | { session: { id: string } }
  | { message: { role: 'assistant'; content: string } }
  | { tool: { name: string; arguments: unknown; result: unknown } }
  | { done: true }
  | { error: string; done: true }
