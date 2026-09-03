import { findPremiumApi, formatUsd } from "@travel-x402/shared";
import { BudgetPolicy } from "./budget.js";
import { PremiumApiClient } from "./x402-client.js";
import { config } from "./config.js";
import { assertFunded, fundWallet, wallet, walletBalance } from "./wallet.js";
import { settlementReceipt } from "./chain.js";

/**
 * Demonstra o ciclo x402 completo sem nenhuma LLM no caminho:
 * descobrir o preco (402), decidir, pagar, consumir.
 *
 * Util para validar o ambiente antes de rodar o agente e para mostrar o
 * protocolo isolado do raciocinio do modelo.
 */
async function main(): Promise<void> {
  const api = findPremiumApi(process.argv[2] ?? "connection-risk");

  if (!api) {
    throw new Error(`API desconhecida: ${process.argv[2]}`);
  }

  console.log(`Carteira do agente: ${wallet.address}`);
  const funded = await fundWallet();
  console.log(`Saldo: ${formatUsd(funded)}\n`);
  assertFunded(funded);

  const budget = new BudgetPolicy(config.premiumBudgetUsd);
  const client = new PremiumApiClient(budget);

  console.log(`1. GET ${api.path} sem pagamento`);
  const quote = await client.quote(api, {});
  console.log(`   402 Payment Required`);
  console.log(`   preco   ${formatUsd(quote.priceUsd)}`);
  console.log(`   rede    ${quote.network}`);
  console.log(`   ativo   ${quote.asset}`);
  console.log(`   payTo   ${quote.payTo}\n`);

  console.log(`2. Cabe no orcamento de ${formatUsd(budget.remainingUsd)}? ` +
    `${budget.evaluate(quote.priceUsd).allowed ? "sim" : "nao"}\n`);

  console.log("3. Assinando a autorizacao EIP-3009 e repetindo a requisicao");
  const result = await client.purchase(api, {}, "Smoke test do fluxo x402");

  if ("refused" in result) {
    console.log(`   recusado: ${result.reason}`);
    return;
  }

  console.log(`   200 OK`);
  console.log(`   tx      ${settlementReceipt(result.transaction)}`);
  console.log(`   dados   ${JSON.stringify(result.data)}\n`);

  console.log(`4. Orcamento: gasto ${formatUsd(budget.spentUsd)}, resta ${formatUsd(budget.remainingUsd)}`);
  console.log(`   Saldo da carteira: ${formatUsd(await walletBalance())}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
