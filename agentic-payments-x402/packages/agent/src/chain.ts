import { createPublicClient, erc20Abi, getAddress, http } from "viem";
import { USDC, atomicToUsd } from "@travel-x402/shared";
import { config } from "./config.js";

const publicClient = createPublicClient({ transport: http(config.rpcUrl) });

/**
 * Le o saldo de USDC de uma carteira direto do contrato na Base Sepolia.
 *
 * @param address - Endereco a consultar
 * @returns O saldo em dolares
 */
export async function usdcBalanceOf(address: string): Promise<number> {
  const balance = await publicClient.readContract({
    address: getAddress(USDC.address),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(address)],
  });

  return atomicToUsd(balance);
}

/**
 * Indica se faz sentido linkar para o explorer.
 *
 * Duas condicoes: o explorer precisa estar configurado, e a liquidacao precisa
 * ser real. No modo local o hash e sintetico - gerado pelo ledger em memoria -
 * entao um link para o basescan levaria a uma pagina inexistente.
 *
 * @returns true quando os links devem ser exibidos
 */
export function hasExplorer(): boolean {
  return config.explorerUrl.length > 0 && config.facilitatorMode === "testnet";
}

/**
 * Link do explorer para uma transacao, quando aplicavel.
 *
 * @param transaction - Hash da transacao
 * @returns A URL, ou null quando nao ha link util
 */
export function explorerTx(transaction: string): string | null {
  return hasExplorer() ? `${config.explorerUrl}/tx/${transaction}` : null;
}

/**
 * Link do explorer para um endereco, quando aplicavel.
 *
 * @param address - Endereco da conta
 * @returns A URL, ou null quando nao ha link util
 */
export function explorerAddress(address: string): string | null {
  return hasExplorer() ? `${config.explorerUrl}/address/${address}` : null;
}

/**
 * Recibo de uma liquidacao pronto para impressao: o link do explorer quando a
 * transacao existe on-chain, o hash quando nao existe.
 *
 * @param transaction - Hash da transacao
 * @returns O recibo a exibir
 */
export function settlementReceipt(transaction: string): string {
  return explorerTx(transaction) ?? transaction;
}
