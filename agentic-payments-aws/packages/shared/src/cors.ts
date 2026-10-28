// A resposta só libera o Origin se ele estiver na lista (CloudFront e localhost em dev).
export function corsHeaders(origin: string | undefined, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {}
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
}
