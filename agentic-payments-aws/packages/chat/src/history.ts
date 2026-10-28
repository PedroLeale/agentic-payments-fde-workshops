import type Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import {
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
  sessionKey,
  userKey,
  type MessageItem,
  type SessionItem,
} from '@agentic-aws/shared'

export type Session = { id: string; title: string; lastSeq: number; ttl: number }

export interface Store {
  getSession(owner: string, id: string): Promise<Session | undefined>
  createSession(owner: string, title: string): Promise<Session>
  loadMessages(sessionId: string): Promise<Anthropic.MessageParam[]>
  appendMessages(owner: string, session: Session, messages: Anthropic.MessageParam[]): Promise<void>
}

// Outra requisição gravou na mesma sessão entre a leitura do histórico e a escrita deste turno.
export class ConcurrentTurn extends Error {}

const DAY = 24 * 60 * 60

type Send = Pick<DynamoDBDocumentClient, 'send'>

export function dynamoStore(
  table: string,
  ttlDays: number,
  db: Send = DynamoDBDocumentClient.from(new DynamoDBClient({}))
): Store {
  const now = () => Math.floor(Date.now() / 1000)

  return {
    async getSession(owner, id) {
      const { Item } = await db.send(new GetCommand({ TableName: table, Key: { PK: userKey(owner), SK: sessionKey(id) } }))
      const item = Item as SessionItem | undefined
      // O TTL do DynamoDB pode levar dias para apagar; vencida é tratada como inexistente.
      if (!item || item.ttl <= now()) return undefined
      return { id: item.sessionId, title: item.title, lastSeq: item.lastSeq, ttl: item.ttl }
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
      return { id, title, lastSeq: 0, ttl }
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
