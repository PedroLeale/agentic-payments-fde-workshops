// Gera public/config.local.json (usado pelo `next dev`) a partir das saídas do stack já
// implantado. Lê com as credenciais AWS da sua sessão; não escreve nada na AWS.
//   npm run config:local -- [--stack AgenticPaymentsAws] [--region us-east-1] [--profile x]
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const stack = arg('stack', 'AgenticPaymentsAws')
const region = arg('region', 'us-east-1')
const profile = arg('profile')

const out = execFileSync(
  'aws',
  ['cloudformation', 'describe-stacks', '--stack-name', stack, '--region', region, '--output', 'json', ...(profile ? ['--profile', profile] : [])],
  { encoding: 'utf8' }
)
const outputs = Object.fromEntries(JSON.parse(out).Stacks[0].Outputs.map((o) => [o.OutputKey, o.OutputValue]))

const config = {
  apiUrl: outputs.ApiUrl,
  region,
  userPoolId: outputs.UserPoolId,
  clientId: outputs.UserPoolClientId,
  loginDomain: outputs.LoginDomain,
}
const missing = Object.entries(config).filter(([, v]) => !v).map(([k]) => k)
if (missing.length) throw new Error(`stack ${stack} sem as saídas: ${missing.join(', ')}`)

const file = new URL('../public/config.local.json', import.meta.url)
writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
console.log(`escrito ${file.pathname}`)
