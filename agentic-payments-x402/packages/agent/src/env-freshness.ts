import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
const STARTED_AT = Date.now();

/**
 * Indica se o `.env` foi editado depois que este processo subiu.
 *
 * O `dotenvx run` injeta as variaveis no spawn e o `tsx watch` recarrega o
 * codigo, nunca o ambiente. Entao uma edicao no `.env` fica invisivel ate o
 * processo reiniciar - e o sintoma e sempre confuso: a aplicacao segue usando o
 * provider, a rede ou as credenciais antigas, sem nenhum erro que aponte para a
 * causa. Detectar isso transforma o mistere em uma mensagem.
 *
 * @returns A mensagem de aviso, ou null quando o ambiente esta atualizado
 */
export function staleEnvWarning(): string | null {
  try {
    if (statSync(ENV_PATH).mtimeMs <= STARTED_AT) {
      return null;
    }
  } catch {
    // Sem .env (variaveis vindas do proprio ambiente): nada a comparar.
    return null;
  }

  return (
    "O arquivo .env foi editado DEPOIS que este processo subiu, entao as " +
    "alteracoes ainda nao valem: o .env e lido apenas no spawn. " +
    "Reinicie o `npm run dev`."
  );
}
