import type { APIGatewayProxyEvent } from 'aws-lambda'
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk'
import { chatHandler } from './chat.ts'
import { gatewayTools } from './gateway.ts'
import { dynamoStore } from '@agentic-aws/store'

const env = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`missing env ${name}`)
  return value
}

const REGION = process.env.BEDROCK_REGION ?? 'us-east-1'
// bedrock-runtime (InvokeModelWithResponseStream). O Haiku 4.5 só roda por inference profile.
const client = new AnthropicBedrock({ awsRegion: REGION })

const chat = chatHandler({
  model: (params) => client.messages.stream(params),
  modelId: process.env.MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  store: dynamoStore(env('TABLE_NAME'), Number(process.env.SESSION_TTL_DAYS ?? 30)),
  tools: () => gatewayTools(env('GATEWAY_URL'), process.env.AWS_REGION ?? REGION),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
})

export const handler = awslambda.streamifyResponse(async (event: APIGatewayProxyEvent, responseStream) => {
  await chat(event, (metadata) => awslambda.HttpResponseStream.from(responseStream, metadata))
})
