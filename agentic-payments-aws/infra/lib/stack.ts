import { existsSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import * as apigw from 'aws-cdk-lib/aws-apigateway'
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import type { Construct } from 'constructs'
import toolSchemas from '../../packages/tools/src/tool-schemas.json' with { type: 'json' }

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MODEL_ID = 'anthropic.claude-haiku-5-5'
const LOCAL_ORIGIN = 'http://localhost:3000'

export type AgenticStackProps = StackProps & {
  // Prefixo do domínio do login do Cognito; é global na região. Não pode conter "aws", "amazon" nem "cognito".
  loginDomainPrefix: string
  // Saída do `next build` com export estático. Sem ela o stack sobe só o config.json.
  webDir?: string
}

export class AgenticPaymentsStack extends Stack {
  constructor(scope: Construct, id: string, props: AgenticStackProps) {
    super(scope, id, props)
    if (/aws|amazon|cognito/i.test(props.loginDomainPrefix)) {
      throw new Error(`loginDomainPrefix "${props.loginDomainPrefix}" can't contain aws, amazon or cognito`)
    }

    // --- Dados ---------------------------------------------------------------------------------

    // Uma tabela, chaves em packages/shared/src/keys.ts. Fica (RETAIN) num `cdk destroy`.
    const table = new dynamodb.TableV2(this, 'Chat', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
    })

    // --- Site (S3 privado + CloudFront com OAC) ------------------------------------------------

    const siteBucket = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Só tem o build do front, que se gera de novo.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      defaultRootObject: 'index.html',
      // Com OAC, arquivo inexistente no S3 volta 403.
      errorResponses: [{ httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html' }],
    })
    const siteUrl = `https://${distribution.distributionDomainName}`
    const allowedOrigins = [siteUrl, LOCAL_ORIGIN]

    // --- Login (Cognito, managed login) ---------------------------------------------------------

    // Sem auto-cadastro: usuários do PoC são criados por um admin.
    const userPool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    })
    const loginDomain = userPool.addDomain('Login', {
      cognitoDomain: { domainPrefix: props.loginDomainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    })
    const redirectUrls = allowedOrigins.map((o) => `${o}/`)
    // SPA: cliente público (sem secret), authorization code + PKCE.
    const webClient = userPool.addClient('Web', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: redirectUrls,
        logoutUrls: redirectUrls,
      },
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
    })
    // O managed login novo só abre a página se o cliente tiver um estilo; usa o padrão do Cognito.
    new cognito.CfnManagedLoginBranding(this, 'LoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: webClient.userPoolClientId,
      useCognitoProvidedValues: true,
    })

    // --- Lambdas ------------------------------------------------------------------------------

    const fn = (id: string, entry: string, props: Partial<nodejs.NodejsFunctionProps> = {}) =>
      new nodejs.NodejsFunction(this, id, {
        entry: path.join(ROOT, entry),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        projectRoot: ROOT,
        depsLockFilePath: path.join(ROOT, 'package-lock.json'),
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        bundling: {
          format: nodejs.OutputFormat.ESM,
          target: 'node22',
          mainFields: ['module', 'main'],
          // Versão fixa do SDK no pacote, não a que vier no runtime.
          bundleAwsSDK: true,
          // Dependências CommonJS dentro de um bundle ESM ainda chamam require.
          banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
        },
        ...props,
      })

    const getTimeFn = fn('GetTimeFn', 'packages/tools/src/get-time.ts', { memorySize: 256, timeout: Duration.seconds(10) })
    const listItemsFn = fn('ListItemsFn', 'packages/tools/src/list-items.ts', { memorySize: 256, timeout: Duration.seconds(10) })

    // --- Ferramentas (AgentCore Gateway, MCP) ---------------------------------------------------

    // Inbound AWS_IAM: só quem tiver bedrock-agentcore:InvokeGateway chama. Sem isto o L2 cria um Cognito próprio.
    const gateway = new agentcore.Gateway(this, 'ToolsGateway', {
      gatewayName: 'agentic-aws-tools',
      description: 'Ferramentas da loja (get_time, list_items) para o chat',
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
      // Explícito para não ligar a busca semântica do padrão do L2: ela publica uma ferramenta
      // a mais, que o chat repassaria ao modelo.
      protocolConfiguration: agentcore.GatewayProtocol.mcp({
        supportedVersions: [agentcore.MCPProtocolVersion.MCP_2025_06_18, agentcore.MCPProtocolVersion.MCP_2025_03_26],
      }),
    })
    // Um target por Lambda; o nome do target vira prefixo da ferramenta (time___get_time).
    // addLambdaTarget já dá ao role do Gateway permissão de invocar a função.
    gateway.addLambdaTarget('TimeTarget', {
      gatewayTargetName: 'time',
      lambdaFunction: getTimeFn,
      toolSchema: agentcore.ToolSchema.fromInline([toolDefinition('get_time')]),
    })
    gateway.addLambdaTarget('CatalogTarget', {
      gatewayTargetName: 'catalog',
      lambdaFunction: listItemsFn,
      toolSchema: agentcore.ToolSchema.fromInline([toolDefinition('list_items')]),
    })

    // --- Chat e sessões -------------------------------------------------------------------------

    const common = {
      TABLE_NAME: table.tableName,
      SESSION_TTL_DAYS: '30',
      ALLOWED_ORIGINS: allowedOrigins.join(','),
    }

    const chatFn = fn('ChatFn', 'packages/chat/src/handler.ts', {
      memorySize: 512,
      timeout: Duration.minutes(5),
      environment: { ...common, GATEWAY_URL: gateway.gatewayUrl!, MODEL_ID, BEDROCK_REGION: 'us-east-1' },
    })
    table.grantReadWriteData(chatFn)
    gateway.grantInvoke(chatFn)
    // Claude no Bedrock pelo endpoint bedrock-mantle (Messages API). A doc da AWS só traz
    // exemplo com Resource "*" para estas ações.
    chatFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock-mantle:CreateInference',
          'bedrock-mantle:GetProject',
          'bedrock-mantle:ListProjects',
          'bedrock-mantle:ListTagsForResources',
        ],
        resources: ['*'],
      })
    )

    const sessionsFn = fn('SessionsFn', 'packages/sessions/src/handler.ts', {
      memorySize: 256,
      timeout: Duration.seconds(15),
      environment: common,
    })
    table.grantReadWriteData(sessionsFn)

    // --- API (REST, JWT do Cognito em todo método) ---------------------------------------------

    const api = new apigw.RestApi(this, 'Api', {
      restApiName: 'agentic-aws-chat',
      endpointTypes: [apigw.EndpointType.REGIONAL],
      deployOptions: {
        stageName: 'prod',
        // Teto de custo do PoC: o chat chama o Bedrock a cada requisição.
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type'],
      },
    })
    // Erros do próprio API Gateway (401 do authorizer, 429 do throttling) também precisam de CORS,
    // senão o navegador esconde o status da página.
    for (const [id, type] of [
      ['Default4xx', apigw.ResponseType.DEFAULT_4XX],
      ['Default5xx', apigw.ResponseType.DEFAULT_5XX],
    ] as const) {
      api.addGatewayResponse(id, {
        type,
        responseHeaders: { 'Access-Control-Allow-Origin': `'${siteUrl}'`, Vary: "'Origin'" },
      })
    }

    // Sem scopes no método, o authorizer valida o ID token.
    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'Authorizer', { cognitoUserPools: [userPool] })
    const auth: apigw.MethodOptions = { authorizer, authorizationType: apigw.AuthorizationType.COGNITO }

    api.root.addResource('chat').addMethod(
      'POST',
      new apigw.LambdaIntegration(chatFn, {
        responseTransferMode: apigw.ResponseTransferMode.STREAM,
        timeout: Duration.minutes(5),
      }),
      auth
    )
    const sessionsIntegration = new apigw.LambdaIntegration(sessionsFn)
    const sessions = api.root.addResource('sessions')
    sessions.addMethod('GET', sessionsIntegration, auth)
    const session = sessions.addResource('{id}')
    session.addMethod('DELETE', sessionsIntegration, auth)
    session.addResource('messages').addMethod('GET', sessionsIntegration, auth)

    // --- Front ---------------------------------------------------------------------------------

    // Configuração lida pela página em runtime: o mesmo build serve qualquer ambiente.
    const config = s3deploy.Source.jsonData('config.json', {
      apiUrl: api.url,
      region: this.region,
      userPoolId: userPool.userPoolId,
      clientId: webClient.userPoolClientId,
      loginDomain: loginDomain.baseUrl(),
    })
    const webDir = props.webDir && existsSync(props.webDir) ? props.webDir : undefined
    if (!webDir) {
      Annotations.of(this).addWarningV2('agentic:web-build', 'Build estático do front não encontrado; só o config.json vai para o S3.')
    }
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: webDir ? [s3deploy.Source.asset(webDir), config] : [config],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    })

    // --- Saídas -------------------------------------------------------------------------------

    new CfnOutput(this, 'SiteUrl', { value: siteUrl })
    new CfnOutput(this, 'ApiUrl', { value: api.url })
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId })
    new CfnOutput(this, 'UserPoolClientId', { value: webClient.userPoolClientId })
    new CfnOutput(this, 'LoginDomain', { value: loginDomain.baseUrl() })
    new CfnOutput(this, 'GatewayUrl', { value: gateway.gatewayUrl! })
    new CfnOutput(this, 'TableName', { value: table.tableName })
  }
}

// --- Esquemas das ferramentas: a mesma fonte que as Lambdas testam (tool-schemas.json) --------

// `| undefined` porque o TypeScript infere o array do JSON como união (`search?: undefined`).
type JsonSchema = {
  type: string
  description?: string
  properties?: Record<string, JsonSchema | undefined>
  required?: string[]
  items?: JsonSchema
}

function toSchema(s: JsonSchema): agentcore.SchemaDefinition {
  const properties = Object.entries(s.properties ?? {}).flatMap(([k, v]) => (v ? [[k, toSchema(v)] as const] : []))
  return {
    type: agentcore.SchemaDefinitionType.of(s.type),
    ...(s.description && { description: s.description }),
    ...(s.properties && { properties: Object.fromEntries(properties) }),
    ...(s.required && { required: s.required }),
    ...(s.items && { items: toSchema(s.items) }),
  }
}

const TOOLS: { name: string; description: string; inputSchema: JsonSchema }[] = toolSchemas

export function toolDefinition(name: string): agentcore.ToolDefinition {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`tool ${name} not in tool-schemas.json`)
  return { name: tool.name, description: tool.description, inputSchema: toSchema(tool.inputSchema) }
}
