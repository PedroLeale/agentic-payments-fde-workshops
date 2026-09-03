import { USDC } from "./network.js";

/**
 * Converte um preco em dolares (`"$0.03"` ou `0.03`) para unidades atomicas do
 * USDC (6 casas decimais), sem passar por float.
 *
 * @param price - Preco em dolares
 * @returns A quantidade em unidades atomicas, como string
 */
export function usdToAtomic(price: string | number): string {
  const raw = String(price).replace("$", "").trim();

  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Preco invalido: ${price}`);
  }

  const [whole = "0", fraction = ""] = raw.split(".");
  const padded = fraction.padEnd(USDC.decimals, "0").slice(0, USDC.decimals);

  return BigInt(`${whole}${padded}`).toString();
}

/**
 * Converte unidades atomicas de USDC de volta para um numero em dolares.
 *
 * @param atomic - Quantidade em unidades atomicas
 * @returns O valor equivalente em dolares
 */
export function atomicToUsd(atomic: string | bigint): number {
  return Number(BigInt(atomic)) / 10 ** USDC.decimals;
}

/**
 * Formata um valor em dolares com a precisao de centavos usada na demo.
 *
 * @param usd - Valor em dolares
 * @returns O valor formatado, por exemplo `$0.03`
 */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}
