import { privateKeyToAccount } from "viem/accounts";
import { atomicToUsd } from "@travel-x402/shared";
import { config } from "./config.js";
import { usdcBalanceOf } from "./chain.js";

/**
 * A carteira do agente.
 *
 * A chave privada vem do `.env` (injetado por dotenvx) e nunca sai do processo:
 * o que trafega no protocolo x402 e apenas a autorizacao EIP-3009 assinada por
 * ela. Em producao isso viraria um KMS ou uma smart wallet - o formato do
 * signer muda, o resto do fluxo nao.
 */
export const wallet = privateKeyToAccount(config.privateKey);

/**
 * Garante saldo inicial para a carteira.
 *
 * No modo local isso e uma chamada a torneira do facilitator. No modo testnet
 * nao ha torneira nossa: o USDC precisa vir de um faucet publico da Base
 * Sepolia, entao aqui apenas consultamos o saldo real on-chain.
 *
 * @returns O saldo da carteira em dolares
 */
export async function fundWallet(): Promise<number> {
  if (config.facilitatorMode !== "local") {
    return usdcBalanceOf(wallet.address);
  }

  const response = await fetch(`${config.facilitatorUrl}/faucet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao financiar a carteira: HTTP ${response.status}`);
  }

  const result = (await response.json()) as { balance: { usd: number } };
  return result.balance.usd;
}

/**
 * Saldo atual da carteira: do ledger do facilitator local, ou on-chain no modo
 * testnet.
 *
 * @returns O saldo em dolares
 */
export async function walletBalance(): Promise<number> {
  if (config.facilitatorMode !== "local") {
    return usdcBalanceOf(wallet.address);
  }

  const response = await fetch(`${config.facilitatorUrl}/ledger`);
  const ledger = (await response.json()) as {
    balances: Record<string, { atomic: string; usd: number }>;
  };

  const balance = ledger.balances[wallet.address.toLowerCase()];
  return balance ? atomicToUsd(balance.atomic) : 0;
}

/**
 * Interrompe a execucao quando a carteira nao tem USDC suficiente para o
 * orcamento pedido, com instrucoes de como financiar.
 *
 * @param balanceUsd - Saldo atual da carteira
 */
export function assertFunded(balanceUsd: number): void {
  if (balanceUsd >= config.premiumBudgetUsd) {
    return;
  }

  const lines = [
    `Saldo insuficiente: a carteira ${wallet.address} tem $${balanceUsd.toFixed(2)} de USDC,`,
    `mas o orcamento pedido e $${config.premiumBudgetUsd.toFixed(2)}.`,
    "",
  ];

  if (config.facilitatorMode === "testnet") {
    lines.push(
      "Modo testnet: financie a carteira com USDC da Base Sepolia em",
      `  ${config.faucetUrl || "https://faucet.circle.com"}  (selecione Base Sepolia)`,
      "",
      "Nao e preciso ETH: quem submete a transacao e paga o gas e o facilitator.",
    );
  } else {
    lines.push("Modo local: reinicie `npm run dev` para recriar o ledger em memoria.");
  }

  throw new Error(lines.join("\n"));
}
