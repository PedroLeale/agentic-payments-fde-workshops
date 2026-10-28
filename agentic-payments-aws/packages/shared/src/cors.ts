export function corsHeaders(origin: string | undefined, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {}
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
}
