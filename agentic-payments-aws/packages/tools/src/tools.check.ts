import assert from 'node:assert/strict'
import { BadArgs, CATALOG, DEFAULT_TZ, getTime, listItems } from './tools.ts'

const here = getTime({})
assert.equal(here.timezone, DEFAULT_TZ)
assert.match(here.now, /^\d{2}\/\d{2}\/\d{4}/)
assert.equal(getTime({ timezone: '  ' }).timezone, DEFAULT_TZ)
assert.equal(getTime({ timezone: 42 }).timezone, DEFAULT_TZ)
assert.match(getTime({ timezone: 'UTC' }).now, /\d{4}/)
assert.notEqual(getTime({ timezone: 'Asia/Tokyo' }).now, getTime({ timezone: 'America/Sao_Paulo' }).now)
assert.throws(() => getTime({ timezone: 'Mars/Olympus' }), BadArgs)

assert.equal(listItems({}).count, CATALOG.length)
assert.equal(listItems({ search: 'playstation' }).items[0].sku, 'PS5')
assert.equal(listItems({ search: '  Monitor ' }).count, 1)
assert.equal(listItems({ search: 'unobtainium' }).count, 0)
assert.equal(listItems({ search: 99 }).count, CATALOG.length)

console.log('tools.ts ok')
