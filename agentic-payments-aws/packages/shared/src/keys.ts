// Uma tabela só. A sessão fica sob o dono, as mensagens sob a sessão:
//   USER#<sub>      / SESSION#<id>   → metadados da sessão
//   SESSION#<id>    / MSG#000001     → uma mensagem (blocos do Claude em JSON)

export const userKey = (sub: string) => `USER#${sub}`
export const sessionKey = (id: string) => `SESSION#${id}`
export const messageKey = (seq: number) => `MSG#${String(seq).padStart(6, '0')}`

export const SESSION_PREFIX = 'SESSION#'
export const MESSAGE_PREFIX = 'MSG#'

export type SessionItem = {
  PK: string
  SK: string
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  lastSeq: number
  ttl: number
}

export type MessageItem = {
  PK: string
  SK: string
  seq: number
  role: 'user' | 'assistant' | 'system'
  content: string
  ttl: number
}
