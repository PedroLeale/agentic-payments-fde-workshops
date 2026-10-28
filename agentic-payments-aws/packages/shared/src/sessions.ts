export type SessionSummary = { id: string; title: string; createdAt: string; updatedAt: string }

// Os blocos de thinking ficam no banco (o modelo precisa deles de volta), mas não saem pela API.
export type DisplayBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }

export type DisplayMessage = { role: 'user' | 'assistant'; content: DisplayBlock[] }

export type SessionHistory = { session: SessionSummary; messages: DisplayMessage[] }
