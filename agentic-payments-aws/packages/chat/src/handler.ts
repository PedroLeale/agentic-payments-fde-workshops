import type { APIGatewayProxyEvent } from 'aws-lambda'
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'
import { chatHandler } from './chat.ts'
import { gatewayTools } from './gateway.ts'
import { dynamoStore } from '@agentic-aws/store'

const env = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`missing env ${name}`)
  return value
}

const REGION = process.env.BEDROCK_REGION ?? 'us-east-1'
const client = new AnthropicBedrockMantle({ awsRegion: REGION })

const chat = chatHandler({
  model: (params) => client.messages.stream(params),
  modelId: process.env.MODEL_ID ?? 'anthropic.claude-haiku-5-5',
  store: dynamoStore(env('TABLE_NAME'), Number(process.env.SESSION_TTL_DAYS ?? 30)),
  tools: () => gatewayTools(env('GATEWAY_URL'), process.env.AWS_REGION ?? REGION),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
})

export const handler = awslambda.streamifyResponse(async (event: APIGatewayProxyEvent, responseStream) => {
  await chat(event, (metadata) => awslambda.HttpResponseStream.from(responseStream, metadata))
})
