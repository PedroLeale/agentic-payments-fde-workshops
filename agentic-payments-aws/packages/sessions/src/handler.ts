import { dynamoStore } from '@agentic-aws/store'
import { sessionsHandler } from './sessions.ts'

const env = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`missing env ${name}`)
  return value
}

export const handler = sessionsHandler({
  store: dynamoStore(env('TABLE_NAME'), Number(process.env.SESSION_TTL_DAYS ?? 30)),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
})
