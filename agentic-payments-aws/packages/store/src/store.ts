import type Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb'
import {
  MESSAGE_PREFIX,
  messageKey,
  SESSION_PREFIX,
  sessionKey,
  userKey,
  type MessageItem,
  type SessionItem,
  type SessionSummary,
} from '@agentic-aws/shared'

export type Session = SessionSummary & { lastSeq: number; ttl: number }

export interface Store {
  getSession(owner: string, id: string): Promise<Session | undefined>
  listSessions(owner: string): Promise<SessionSummary[]>
  createSession(owner: string, title: string): Promise<Session>
  deleteSession(owner: string, id: string): Promise<boolean>
  loadMessages(sessionId: string): Promise<Anthropic.MessageParam[]>
  appendMessages(owner: string, session: Session, messages: Anthropic.MessageParam[]): Promise<void>
}

// Outra requisição gravou na mesma sessão entre a leitura do histórico e a escrita deste turno.
export class ConcurrentTurn extends Error {}

const DAY = 24 * 60 * 60
const BATCH_WRITE_MAX = 25
const BATCH_RETRIES = 5

type Send = Pick<DynamoDBDocumentClient, 'send'>

function toSession(item: SessionItem): Session {
  return {
    id: item.sessionId,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastSeq: item.lastSeq,
    ttl: item.ttl,
  }
}

export function dynamoStore(
  table: string,
  ttlDays: number,
  db: Send = DynamoDBDocumentClient.from(new DynamoDBClient({}))
): Store {
  const now = () => Math.floor(Date.now() / 1000)

  // BatchWrite pode devolver parte dos itens como não processados (throttling); tenta de novo.
  async function deleteKeys(keys: { PK: string; SK: string }[]) {
    let pending = keys.map((Key) => ({ DeleteRequest: { Key } }))
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt === BATCH_RETRIES) {
        console.error(JSON.stringify({ msg: 'messages left for TTL cleanup', count: pending.length }))
        return
      }
      if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt))
      const out = await db.send(new BatchWriteCommand({ RequestItems: { [table]: pending } }))
      pending = (out.UnprocessedItems?.[table] ?? []) as typeof pending
    }
  }

  return {
    async getSession(owner, id) {
      const { Item } = await db.send(new GetCommand({ TableName: table, Key: { PK: userKey(owner), SK: sessionKey(id) } }))
      const item = Item as SessionItem | undefined
      // O TTL do DynamoDB pode levar dias para apagar; vencida é tratada como inexistente.
      if (!item || item.ttl <= now()) return undefined
      return toSession(item)
    },

    async listSessions(owner) {
      const sessions: SessionSummary[] = []
      let ExclusiveStartKey: Record<string, unknown> | undefined
      do {
        const page = await db.send(
          new QueryCommand({
            TableName: table,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :session)',
            ExpressionAttributeValues: { ':pk': userKey(owner), ':session': SESSION_PREFIX },
            ExclusiveStartKey,
          })
        )
        for (const item of (page.Items ?? []) as SessionItem[]) {
          if (item.ttl <= now()) continue
          const { id, title, createdAt, updatedAt } = toSession(item)
          sessions.push({ id, title, createdAt, updatedAt })
        }
        ExclusiveStartKey = page.LastEvaluatedKey
      } while (ExclusiveStartKey)
      // Mais recente primeiro. ISO 8601 em UTC ordena como texto.
      return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    // Apaga a sessão primeiro: a partir daí ninguém mais a lê e um turno em andamento falha
    // no lastSeq condicional. Se sobrar mensagem por causa de erro no meio, o TTL limpa.
    async deleteSession(owner, id) {
      try {
        await db.send(
          new DeleteCommand({
            TableName: table,
            Key: { PK: userKey(owner), SK: sessionKey(id) },
            ConditionExpression: 'attribute_exists(PK)',
          })
        )
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) return false
        throw err
      }

      let ExclusiveStartKey: Record<string, unknown> | undefined
      do {
        const page = await db.send(
          new QueryCommand({
            TableName: table,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :msg)',
            ExpressionAttributeValues: { ':pk': sessionKey(id), ':msg': MESSAGE_PREFIX },
            ProjectionExpression: 'PK, SK',
            ExclusiveStartKey,
          })
        )
        const keys = (page.Items ?? []) as { PK: string; SK: string }[]
        for (let i = 0; i < keys.length; i += BATCH_WRITE_MAX) {
          await deleteKeys(keys.slice(i, i + BATCH_WRITE_MAX))
        }
        ExclusiveStartKey = page.LastEvaluatedKey
      } while (ExclusiveStartKey)
      return true
    },

    async createSession(owner, title) {
      const id = randomUUID()
      const at = new Date().toISOString()
      // A sessão inteira (e todas as mensagens) vence junto, contando da criação. Assim o TTL
      // nunca apaga só o começo de uma conversa e deixa um tool_result órfão no histórico.
      const ttl = now() + ttlDays * DAY
      const item: SessionItem = {
        PK: userKey(owner),
        SK: sessionKey(id),
        sessionId: id,
        title,
        createdAt: at,
        updatedAt: at,
        lastSeq: 0,
        ttl,
      }
      await db.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(PK)' }))
      return toSession(item)
    },

    async loadMessages(sessionId) {
      const messages: Anthropic.MessageParam[] = []
      let ExclusiveStartKey: Record<string, unknown> | undefined
      do {
        const page = await db.send(
          new QueryCommand({
            TableName: table,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :msg)',
            ExpressionAttributeValues: { ':pk': sessionKey(sessionId), ':msg': MESSAGE_PREFIX },
            ExclusiveStartKey,
          })
        )
        for (const item of (page.Items ?? []) as MessageItem[]) {
          messages.push({ role: item.role, content: JSON.parse(item.content) })
        }
        ExclusiveStartKey = page.LastEvaluatedKey
      } while (ExclusiveStartKey)
      return messages
    },

    // Só acrescenta, nunca reescreve: os blocos do Claude (inclusive thinking) voltam
    // exatamente como vieram. O lastSeq condicional serializa turnos da mesma sessão.
    async appendMessages(owner, session, messages) {
      const next = session.lastSeq + messages.length
      const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [
        {
          Update: {
            TableName: table,
            Key: { PK: userKey(owner), SK: sessionKey(session.id) },
            UpdateExpression: 'SET lastSeq = :next, updatedAt = :at',
            ConditionExpression: 'lastSeq = :expected',
            ExpressionAttributeValues: { ':next': next, ':at': new Date().toISOString(), ':expected': session.lastSeq },
          },
        },
        ...messages.map((m, i) => {
          const seq = session.lastSeq + i + 1
          const item: MessageItem = {
            PK: sessionKey(session.id),
            SK: messageKey(seq),
            seq,
            role: m.role,
            content: JSON.stringify(m.content),
            ttl: session.ttl,
          }
          return { Put: { TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(PK)' } }
        }),
      ]
      try {
        await db.send(new TransactWriteCommand({ TransactItems: items }))
      } catch (err) {
        if (err instanceof TransactionCanceledException) throw new ConcurrentTurn('session changed during this turn')
        throw err
      }
    },
  }
}
