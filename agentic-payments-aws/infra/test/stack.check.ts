import assert from 'node:assert/strict'
import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import toolSchemas from '../../packages/tools/src/tool-schemas.json' with { type: 'json' }
import { AgenticPaymentsStack } from '../lib/stack.ts'

const stack = new AgenticPaymentsStack(new App(), 'Test', {
  env: { account: '111122223333', region: 'us-east-1' },
  loginDomainPrefix: 'agentic-pay-test',
})
const template = Template.fromStack(stack)
const resources: Record<string, { Type: string; Properties: any }> = template.toJSON().Resources

const ofType = (type: string) => Object.entries(resources).filter(([, r]) => r.Type === type)
const fnId = (prefix: string) => ofType('AWS::Lambda::Function').find(([id]) => id.startsWith(prefix))![0]
const roleOf = (prefix: string) => resources[fnId(prefix)]!.Properties.Role['Fn::GetAtt'][0] as string
const statements = (roleId: string) =>
  ofType('AWS::IAM::Policy')
    .filter(([, p]) => p.Properties.Roles.some((r: { Ref: string }) => r.Ref === roleId))
    .flatMap(([, p]) => p.Properties.PolicyDocument.Statement as { Action: string | string[]; Resource: unknown }[])
const actions = (roleId: string) => statements(roleId).flatMap((s) => [s.Action].flat())
const gatewayId = ofType('AWS::BedrockAgentCore::Gateway')[0]![0]

// --- API: JWT do Cognito em tudo, menos no preflight de CORS ------------------------------------

for (const [, m] of ofType('AWS::ApiGateway::Method')) {
  const expected = m.Properties.HttpMethod === 'OPTIONS' ? 'NONE' : 'COGNITO_USER_POOLS'
  assert.equal(m.Properties.AuthorizationType, expected, `${m.Properties.HttpMethod} auth`)
}
const chatPost = ofType('AWS::ApiGateway::Method').find(
  ([id, m]) => id.startsWith('Apichat') && m.Properties.HttpMethod === 'POST'
)![1].Properties.Integration
assert.equal(chatPost.ResponseTransferMode, 'STREAM')
assert.equal(chatPost.TimeoutInMillis, 300000)
assert.match(JSON.stringify(chatPost.Uri), /2021-11-15\/functions\/.*\/response-streaming-invocations/)

template.hasResourceProperties('AWS::ApiGateway::Stage', {
  MethodSettings: Match.arrayWith([Match.objectLike({ ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 })]),
})
template.resourceCountIs('AWS::ApiGateway::GatewayResponse', 2)

// --- Gateway: IAM na entrada, sem busca semântica, um target por ferramenta ------------------

const gw = resources[gatewayId]!.Properties
assert.equal(gw.AuthorizerType, 'AWS_IAM')
assert.equal(gw.ProtocolType, 'MCP')
assert.equal(gw.ProtocolConfiguration.Mcp.SearchType, undefined)

const targets = Object.fromEntries(
  ofType('AWS::BedrockAgentCore::GatewayTarget').map(([, t]) => [t.Properties.Name, t.Properties.TargetConfiguration.Mcp.Lambda])
)
assert.deepEqual(Object.keys(targets).sort(), ['catalog', 'time'])
assert.deepEqual(targets.time.LambdaArn, { 'Fn::GetAtt': [fnId('GetTimeFn'), 'Arn'] })
assert.deepEqual(targets.catalog.LambdaArn, { 'Fn::GetAtt': [fnId('ListItemsFn'), 'Arn'] })
// Mesmo esquema que as Lambdas testam em tool-schemas.json.
for (const [target, tool] of [['time', 'get_time'], ['catalog', 'list_items']] as const) {
  const [published] = targets[target].ToolSchema.InlinePayload
  const source = toolSchemas.find((t) => t.name === tool)!
  assert.equal(published.Name, tool)
  assert.equal(published.Description, source.description)
  assert.deepEqual(Object.keys(published.InputSchema.Properties), Object.keys(source.inputSchema.properties))
}

// --- Permissões: cada função só com o que usa ------------------------------------------------

const chatRole = roleOf('ChatFn')
const invokeGateway = statements(chatRole).find((s) => [s.Action].flat().includes('bedrock-agentcore:InvokeGateway'))!
assert.deepEqual(invokeGateway.Resource, { 'Fn::GetAtt': [gatewayId, 'GatewayArn'] })
// Bedrock só no inference profile us. do Haiku 4.5 e no modelo das regiões dele; nada em "*".
const bedrock = statements(chatRole).filter((s) => [s.Action].flat().some((a) => a.startsWith('bedrock:')))
assert.equal(bedrock.length, 1)
assert.deepEqual([bedrock[0]!.Action].flat().sort(), ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'])
const bedrockResources = JSON.stringify(bedrock[0]!.Resource)
for (const region of ['us-east-1', 'us-east-2', 'us-west-2']) {
  assert.ok(
    bedrockResources.includes(`:bedrock:${region}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`),
    `${region} missing in ${bedrockResources}`
  )
}
assert.ok(bedrockResources.includes(':inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0'))
assert.ok(!statements(chatRole).some((s) => JSON.stringify(s.Resource) === '"*"'))
assert.ok(!actions(chatRole).some((a) => a.startsWith('bedrock-mantle:')))
assert.ok(actions(chatRole).some((a) => a.startsWith('dynamodb:')))

const sessionsRole = roleOf('SessionsFn')
assert.ok(actions(sessionsRole).some((a) => a.startsWith('dynamodb:')))
assert.ok(!actions(sessionsRole).some((a) => a.startsWith('bedrock')))

for (const tool of ['GetTimeFn', 'ListItemsFn']) {
  assert.deepEqual(actions(roleOf(tool)), [], `${tool} has no extra permissions`)
}

const gatewayRole = gw.RoleArn['Fn::GetAtt'][0]
const invokes = statements(gatewayRole).filter((s) => [s.Action].flat().includes('lambda:InvokeFunction'))
const invoked = JSON.stringify(invokes.map((s) => s.Resource))
assert.ok(invoked.includes(fnId('GetTimeFn')) && invoked.includes(fnId('ListItemsFn')))
assert.ok(!invoked.includes(fnId('ChatFn')) && !invoked.includes(fnId('SessionsFn')))

// --- Lambdas ----------------------------------------------------------------------------------

for (const [, f] of ofType('AWS::Lambda::Function').filter(([id]) => /^(Chat|Sessions|GetTime|ListItems)Fn/.test(id))) {
  assert.equal(f.Properties.Runtime, 'nodejs22.x')
  assert.deepEqual(f.Properties.Architectures, ['arm64'])
}
const chatEnv = resources[fnId('ChatFn')]!.Properties.Environment.Variables
assert.equal(chatEnv.MODEL_ID, 'us.anthropic.claude-haiku-4-5-20251001-v1:0')
assert.deepEqual(chatEnv.GATEWAY_URL, { 'Fn::GetAtt': [gatewayId, 'GatewayUrl'] })
assert.equal(resources[fnId('ChatFn')]!.Properties.Timeout, 300)

// --- Dados ------------------------------------------------------------------------------------

template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
  KeySchema: [
    { AttributeName: 'PK', KeyType: 'HASH' },
    { AttributeName: 'SK', KeyType: 'RANGE' },
  ],
  TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
  BillingMode: 'PAY_PER_REQUEST',
})

// --- Login ------------------------------------------------------------------------------------

template.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true } })
template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
  GenerateSecret: false,
  AllowedOAuthFlows: ['code'],
  AllowedOAuthFlowsUserPoolClient: true,
  CallbackURLs: Match.arrayWith(['http://localhost:3000/']),
  SupportedIdentityProviders: ['COGNITO'],
})
template.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: 'agentic-pay-test', ManagedLoginVersion: 2 })
template.hasResourceProperties('AWS::Cognito::ManagedLoginBranding', { UseCognitoProvidedValues: true })

assert.throws(
  () => new AgenticPaymentsStack(new App(), 'Bad', { loginDomainPrefix: 'my-aws-chat' }),
  /can't contain aws, amazon or cognito/
)

// --- Site: bucket privado, só o CloudFront (OAC) lê --------------------------------------------

template.hasResourceProperties('AWS::S3::Bucket', {
  PublicAccessBlockConfiguration: {
    BlockPublicAcls: true,
    BlockPublicPolicy: true,
    IgnorePublicAcls: true,
    RestrictPublicBuckets: true,
  },
})
template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1)
template.hasResourceProperties('AWS::CloudFront::Distribution', {
  DistributionConfig: Match.objectLike({
    DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
  }),
})

// --- O que sobrevive a um `cdk destroy` (o README promete isto) ---------------------------------

const deletion = (type: string) => ofType(type).map(([, r]) => (r as { DeletionPolicy?: string }).DeletionPolicy)
assert.deepEqual(deletion('AWS::DynamoDB::GlobalTable'), ['Retain'])
assert.deepEqual(deletion('AWS::Cognito::UserPool'), ['Retain'])
assert.deepEqual(deletion('AWS::S3::Bucket'), ['Delete'])
// Todos os log groups do template somem no destroy, inclusive o da Lambda do BucketDeployment.
assert.ok(deletion('AWS::Logs::LogGroup').length >= 5)
assert.ok(deletion('AWS::Logs::LogGroup').every((p) => p === 'Delete'))

// --- Tags do projeto ------------------------------------------------------------------------------

const PROJECT = { Key: 'project', Value: 'agentic-payments-aws' }
// Tudo o que guarda dado ou custa dinheiro, e os roles.
for (const type of [
  'AWS::Lambda::Function',
  'AWS::IAM::Role',
  'AWS::Logs::LogGroup',
  'AWS::S3::Bucket',
  'AWS::CloudFront::Distribution',
  'AWS::ApiGateway::RestApi',
  'AWS::ApiGateway::Stage',
]) {
  for (const [id, r] of ofType(type)) {
    // A Lambda/role do auto-delete do S3 é um recurso cru sem Tags; recebe as tags do stack.
    if (id.startsWith('CustomS3AutoDeleteObjects')) continue
    const tags = r.Properties.Tags ?? r.Properties.DistributionConfig?.Tags
    assert.ok(
      tags?.some((t: { Key: string; Value: string }) => t.Key === PROJECT.Key && t.Value === PROJECT.Value),
      `${type} ${id} without project tag`
    )
  }
}
assert.equal(resources[ofType('AWS::Cognito::UserPool')[0]![0]]!.Properties.UserPoolTags.project, PROJECT.Value)
assert.equal(resources[gatewayId]!.Properties.Tags.project, PROJECT.Value)
const table = ofType('AWS::DynamoDB::GlobalTable')[0]![1].Properties
assert.ok(table.Replicas[0].Tags.some((t: { Key: string; Value: string }) => t.Key === 'project' && t.Value === PROJECT.Value))
// Tags no nível do stack: o CloudFormation propaga para o que o CDK não marcou.
assert.deepEqual(stack.tags.tagValues(), { environment: 'poc', 'managed-by': 'cdk', project: 'agentic-payments-aws' })

console.log('stack.ts ok')
