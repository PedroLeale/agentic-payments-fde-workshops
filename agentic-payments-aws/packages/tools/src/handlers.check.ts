import assert from 'node:assert/strict'
import schemas from './tool-schemas.json' with { type: 'json' }
import { DEFAULT_TZ } from './tools.ts'
import { getTimeHandler, listItemsHandler } from './handlers.ts'
import { handler as getTimeEntry } from './get-time.ts'
import { handler as listItemsEntry } from './list-items.ts'

assert.equal(getTimeEntry, getTimeHandler)
assert.equal(listItemsEntry, listItemsHandler)

const here = (await getTimeHandler({})) as { timezone: string }
assert.equal(here.timezone, DEFAULT_TZ)
assert.deepEqual(await getTimeHandler({ timezone: 'Mars/Olympus' }), { error: 'unknown timezone: Mars/Olympus' })
assert.equal(((await getTimeHandler(undefined as never)) as { timezone: string }).timezone, DEFAULT_TZ)

const ps5 = (await listItemsHandler({ search: 'playstation' })) as { count: number; items: { sku: string }[] }
assert.equal(ps5.count, 1)
assert.equal(ps5.items[0]?.sku, 'PS5')
assert.equal(((await listItemsHandler(undefined as never)) as { count: number }).count, 6)

assert.deepEqual(schemas.map((s) => s.name), ['get_time', 'list_items'])
for (const s of schemas) {
  assert.ok(s.description)
  assert.equal(s.inputSchema.type, 'object')
}
assert.deepEqual(Object.keys(schemas[0]!.inputSchema.properties), ['timezone'])
assert.deepEqual(Object.keys(schemas[1]!.inputSchema.properties), ['search'])

console.log('handlers.ts ok')
