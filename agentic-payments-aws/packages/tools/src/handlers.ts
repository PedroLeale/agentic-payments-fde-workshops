import { BadArgs, getTime, listItems } from './tools.ts'

// O AgentCore Gateway entrega os argumentos da ferramenta como o próprio evento da Lambda.
// Como é uma Lambda por ferramenta, o nome da ferramenta (que vem no context) não é necessário.
type ToolEvent = Record<string, unknown>

export const getTimeHandler = (event: ToolEvent) => run(() => getTime(event ?? {}))

export const listItemsHandler = (event: ToolEvent) => run(() => listItems(event ?? {}))

async function run(tool: () => unknown) {
  try {
    return tool()
  } catch (err) {
    if (err instanceof BadArgs) return { error: err.message }
    throw err
  }
}
