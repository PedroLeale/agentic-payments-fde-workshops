import { PREMIUM_APIS, formatUsd, resolvePayTo } from "@travel-x402/shared";
import { config } from "./config.js";
import { explorerAddress, usdcBalanceOf } from "./chain.js";
import { wallet } from "./wallet.js";

type LedgerSnapshot = {
  balances: Record<string, { atomic: string; usd: number }>;
  transfers: { transaction: string; from: string; to: string; usd: number; resource?: string }[];
};

/**
 * Nomeia uma conta: a carteira do agente ou o provider que recebeu.
 *
 * @param address - Endereco da conta
 * @returns Um rotulo legivel
 */
function label(address: string): string {
  if (address.toLowerCase() === wallet.address.toLowerCase()) {
    return "Agente";
  }

  const api = PREMIUM_APIS.find(
    (entry) => resolvePayTo(entry).toLowerCase() === address.toLowerCase(),
  );
  return api ? api.provider : address;
}

/**
 * Le os saldos direto da blockchain, no modo testnet.
 */
async function showOnChain(): Promise<void> {
  console.log(`SALDOS ON-CHAIN (${config.network})\n`);

  const accounts = [
    { name: "Agente", address: wallet.address },
    ...PREMIUM_APIS.map((api) => ({ name: api.provider, address: resolvePayTo(api) })),
  ];

  for (const account of accounts) {
    const balance = await usdcBalanceOf(account.address);
    console.log(`  ${account.name.padEnd(20)} ${formatUsd(balance).padStart(9)}  ${account.address}`);
    const link = explorerAddress(account.address);

    if (link) {
      console.log(`  ${" ".repeat(20)} ${link}`);
    }
  }

  console.log("\nO historico completo de transferencias esta no explorer, nos links acima.");
}

/**
 * Le os saldos e liquidacoes do ledger em memoria, no modo local.
 */
async function showLocalLedger(): Promise<void> {
  const response = await fetch(`${config.facilitatorUrl}/ledger`);
  const ledger = (await response.json()) as LedgerSnapshot;

  console.log("SALDOS");
  for (const [address, balance] of Object.entries(ledger.balances)) {
    console.log(`  ${label(address).padEnd(20)} ${formatUsd(balance.usd).padStart(9)}  ${address}`);
  }

  console.log();
  console.log(`LIQUIDACOES (${ledger.transfers.length})`);
  for (const transfer of ledger.transfers) {
    console.log(
      `  ${formatUsd(transfer.usd).padStart(8)}  ${label(transfer.from)} -> ${label(transfer.to)}`,
    );
    console.log(`            ${transfer.resource ?? ""}`);
    console.log(`            tx ${transfer.transaction}`);
  }
}

/**
 * Imprime o estado das contas, do ledger local ou da blockchain.
 */
async function main(): Promise<void> {
  if (config.facilitatorMode === "testnet") {
    await showOnChain();
    return;
  }

  await showLocalLedger();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
