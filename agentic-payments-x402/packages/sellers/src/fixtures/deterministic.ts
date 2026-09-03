/**
 * Hash estavel de uma string para um numero em [0, 1).
 *
 * Todas as APIs deste marketplace sao mocks, mas precisam responder de forma
 * consistente: a mesma consulta tem que devolver sempre o mesmo numero, senao o
 * agente veria o mundo mudar a cada request. Entradas que nao estao nas
 * fixtures caem neste gerador em vez de retornar erro.
 *
 * @param seed - Texto que identifica a consulta
 * @returns Um numero deterministico em [0, 1)
 */
export function pseudoRandom(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return ((hash >>> 0) % 100000) / 100000;
}

/**
 * Sorteia um numero deterministico dentro de uma faixa.
 *
 * @param seed - Texto que identifica a consulta
 * @param min - Limite inferior
 * @param max - Limite superior
 * @returns Um valor em [min, max]
 */
export function pseudoRange(seed: string, min: number, max: number): number {
  return min + pseudoRandom(seed) * (max - min);
}

/**
 * Arredonda para um numero fixo de casas decimais.
 *
 * @param value - Valor a arredondar
 * @param decimals - Casas decimais desejadas
 * @returns O valor arredondado
 */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
