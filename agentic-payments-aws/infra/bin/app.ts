import { fileURLToPath } from 'node:url'
import { App } from 'aws-cdk-lib'
import { AgenticPaymentsStack } from '../lib/stack.ts'

const app = new App()

new AgenticPaymentsStack(app, 'AgenticPaymentsAws', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  loginDomainPrefix: app.node.tryGetContext('loginDomainPrefix') ?? 'agentic-pay-poc-fellowship',
  webDir: fileURLToPath(new URL('../../packages/web/out', import.meta.url)),
})
