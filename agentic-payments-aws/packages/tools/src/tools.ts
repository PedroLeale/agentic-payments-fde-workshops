
export const CATALOG = [
  { sku: 'PS5', name: 'PlayStation 5', price: 4799.0, currency: 'BRL' },
  { sku: 'PCGAMER', name: 'PC Gamer', price: 12499.0, currency: 'BRL' },
  { sku: 'NOTEWORK', name: 'Notebook de trabalho', price: 6299.0, currency: 'BRL' },
  { sku: 'MONITOR', name: 'Monitor 27" 144Hz', price: 1899.9, currency: 'BRL' },
  { sku: 'CADEIRA', name: 'Cadeira gamer', price: 1299.0, currency: 'BRL' },
  { sku: 'LHC', name: 'Acelerador de partículas de bancada (seminovo, poucos prótons rodados)', price: 4200000000.0, currency: 'BRL' },
]

export const DEFAULT_TZ = 'America/Sao_Paulo'

export function getTime(args: { timezone?: unknown }) {
  const tz = typeof args.timezone === 'string' && args.timezone.trim() ? args.timezone.trim() : DEFAULT_TZ
  try {
    return { timezone: tz, now: new Date().toLocaleString('pt-BR', { timeZone: tz, timeZoneName: 'short' }) }
  } catch {
    throw new BadArgs(`unknown timezone: ${tz}`)
  }
}

export function listItems(args: { search?: unknown }) {
  const q = typeof args.search === 'string' ? args.search.trim().toLowerCase() : ''
  const items = q ? CATALOG.filter((i) => i.name.toLowerCase().includes(q)) : CATALOG
  return { count: items.length, items }
}

export class BadArgs extends Error {}
