export type AppConfig = {
  apiUrl: string
  region: string
  userPoolId: string
  clientId: string
  loginDomain: string
}

const CONFIG_PATH = process.env.NODE_ENV === 'development' ? '/config.local.json' : '/config.json'
const KEYS = ['apiUrl', 'region', 'userPoolId', 'clientId', 'loginDomain'] as const

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch(CONFIG_PATH, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${CONFIG_PATH}: HTTP ${res.status}`)
  const config = (await res.json()) as Partial<AppConfig>
  const missing = KEYS.filter((k) => typeof config[k] !== 'string' || !config[k])
  if (missing.length > 0) throw new Error(`${CONFIG_PATH}: faltando ${missing.join(', ')}`)
  return config as AppConfig
}

export const authority = (c: AppConfig) => `https://cognito-idp.${c.region}.amazonaws.com/${c.userPoolId}`

// O discovery do Cognito não publica end_session_endpoint; o logout é o /logout do domínio.
export const logoutUrl = (c: AppConfig, returnTo: string) =>
  `${c.loginDomain}/logout?client_id=${encodeURIComponent(c.clientId)}&logout_uri=${encodeURIComponent(returnTo)}`
