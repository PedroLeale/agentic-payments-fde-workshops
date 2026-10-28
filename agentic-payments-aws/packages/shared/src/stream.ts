export type StreamLine =
  | { session: { id: string } }
  | { message: { role: 'assistant'; content: string } }
  | { tool: { name: string; arguments: unknown; result: unknown } }
  | { done: true }
  | { error: string; done: true }
