import type { Network } from "./types.js";

/**
 * Rede padrao do workshop, no formato CAIP-2 exigido pelo x402 v2.
 * `eip155:84532` = Base Sepolia (na v1 isso era a string "base-sepolia").
 */
export const DEFAULT_NETWORK: Network = "eip155:84532";

/**
 * USDC de teste na Base Sepolia. Esse endereco tambem e o `verifyingContract`
 * do dominio EIP-712 usado para assinar a autorizacao EIP-3009, e os campos
 * `name`/`version` precisam bater exatamente com os do contrato.
 */
export const USDC = {
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  eip712Name: "USDC",
  eip712Version: "2",
  decimals: 6,
  symbol: "USDC",
} as const;

/**
 * Extrai o chain id numerico de um identificador CAIP-2 `eip155:<chainId>`.
 *
 * @param network - Identificador da rede em CAIP-2
 * @returns O chain id EVM correspondente
 */
export function toChainId(network: Network): number {
  const [namespace, reference] = network.split(":");

  if (namespace !== "eip155" || !reference) {
    throw new Error(`Rede nao suportada pelo workshop: ${network}`);
  }

  const chainId = Number(reference);

  if (!Number.isInteger(chainId)) {
    throw new Error(`Chain id invalido em ${network}`);
  }

  return chainId;
}
