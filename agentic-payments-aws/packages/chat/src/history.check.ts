import assert from 'node:assert/strict'
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import { ConcurrentTurn, dynamoStore } from './history.ts'

type Sent = { name: string; input: any }

function fakeDb(reply: (cmd: Sent) => unknown = () => ({})) {
  const sent: Sent[] = []
  const db = {
    send: async (cmd: { constructor: { name: string }; input: unknown }) => {
      const s = { name: cmd.constructor.name, input: cmd.input }
      sent.push(s)
      return reply(s)
    },
  }
  return { sent, db: db as never }
}

const now = Math.floor(Date.now() / 1000)

// createSession: um Put condicional, TTL contado da criação.
{
  const { sent, db } = fakeDb()
  const session = await dynamoStore('T', 30, db).createSession('sub-a', 'Quanto custa o PS5?')
  assert.equal(sent[0]!.name, PutCommand.name)
  const { Item, ConditionExpression, TableName } = sent[0]!.input
  assert.equal(TableName, 'T')
  assert.equal(ConditionExpression, 'attribute_not_exists(PK)')
  assert.equal(Item.PK, 'USER#sub-a')
  assert.equal(Item.SK, `SESSION#${session.id}`)
  assert.equal(Item.lastSeq, 0)
  assert.equal(Item.title, 'Quanto custa o PS5?')
  assert.ok(Math.abs(Item.ttl - (now + 30 * 86400)) < 5)
  assert.deepEqual(session, { id: Item.sessionId, title: Item.title, lastSeq: 0, ttl: Item.ttl })
}

// getSession: chave do dono; vencida conta como inexistente.
{
  const item = { sessionId: 's1', title: 't', lastSeq: 4, ttl: now + 100 }
  const { sent, db } = fakeDb(() => ({ Item: item }))
  const store = dynamoStore('T', 30, db)
  assert.deepEqual(await store.getSession('sub-a', 's1'), { id: 's1', title: 't', lastSeq: 4, ttl: now + 100 })
  assert.equal(sent[0]!.name, GetCommand.name)
  assert.deepEqual(sent[0]!.input.Key, { PK: 'USER#sub-a', SK: 'SESSION#s1' })

  item.ttl = now - 1
  assert.equal(await store.getSession('sub-a', 's1'), undefined)
  assert.equal(await dynamoStore('T', 30, fakeDb(() => ({})).db).getSession('sub-a', 's1'), undefined)
}

// loadMessages: pagina e devolve o conteúdo exatamente como foi gravado.
{
  const thinking = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'oi' }]
  const pages = [
    { Items: [{ role: 'user', content: JSON.stringify('olá') }], LastEvaluatedKey: { PK: 'x', SK: 'MSG#000001' } },
    { Items: [{ role: 'assistant', content: JSON.stringify(thinking) }] },
  ]
  const { sent, db } = fakeDb(() => pages.shift())
  const messages = await dynamoStore('T', 30, db).loadMessages('s1')
  assert.deepEqual(messages, [
    { role: 'user', content: 'olá' },
    { role: 'assistant', content: thinking },
  ])
  assert.equal(sent.length, 2)
  assert.equal(sent[0]!.name, QueryCommand.name)
  assert.equal(sent[0]!.input.ExpressionAttributeValues[':pk'], 'SESSION#s1')
  assert.deepEqual(sent[1]!.input.ExclusiveStartKey, { PK: 'x', SK: 'MSG#000001' })
}

// appendMessages: uma transação; lastSeq condicional + um Put por mensagem, numeração contínua.
{
  const { sent, db } = fakeDb()
  const session = { id: 's1', title: 't', lastSeq: 2, ttl: now + 100 }
  await dynamoStore('T', 30, db).appendMessages('sub-a', session, [
    { role: 'user', content: 'e o monitor?' },
    { role: 'assistant', content: [{ type: 'text', text: 'R$ 1.899,90', citations: null }] },
  ])
  assert.equal(sent[0]!.name, TransactWriteCommand.name)
  const [update, put3, put4, ...rest] = sent[0]!.input.TransactItems
  assert.equal(rest.length, 0)
  assert.deepEqual(update.Update.Key, { PK: 'USER#sub-a', SK: 'SESSION#s1' })
  assert.equal(update.Update.ConditionExpression, 'lastSeq = :expected')
  assert.equal(update.Update.ExpressionAttributeValues[':expected'], 2)
  assert.equal(update.Update.ExpressionAttributeValues[':next'], 4)
  assert.equal(put3.Put.Item.SK, 'MSG#000003')
  assert.equal(put3.Put.Item.PK, 'SESSION#s1')
  assert.equal(put3.Put.Item.content, '"e o monitor?"')
  assert.equal(put4.Put.Item.SK, 'MSG#000004')
  assert.equal(put4.Put.Item.role, 'assistant')
  assert.equal(put4.Put.Item.ttl, now + 100)
  assert.equal(put4.Put.ConditionExpression, 'attribute_not_exists(PK)')

  const conflict = fakeDb(() => {
    throw new TransactionCanceledException({ message: 'cancelled', $metadata: {} })
  })
  await assert.rejects(dynamoStore('T', 30, conflict.db).appendMessages('sub-a', session, []), ConcurrentTurn)
}

console.log('history.ts ok')
