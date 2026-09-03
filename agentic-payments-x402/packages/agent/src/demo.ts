import { formatUsd } from "@travel-x402/shared";
import { runDemo } from "./demo-run.js";
import { settlementReceipt } from "./chain.js";

/**
 * Roda o roteiro deterministico no terminal.
 *
 * A logica vive em {@link runDemo}, que publica eventos; aqui so os
 * renderizamos. O servidor SSE consome exatamente os mesmos eventos, entao a
 * demo no terminal e a demo na interface nunca saem de sincronia.
 */
async function main(): Promise<void> {
  console.log("=".repeat(78));
  console.log("ROTEIRO DETERMINISTICO - o cenario da secao 7, sem LLM no caminho");
  console.log("=".repeat(78));

  await runDemo((event) => {
    switch (event.type) {
      case "start":
        console.log(`carteira   ${event.walletAddress}`);
        console.log(`saldo      ${formatUsd(event.walletBalanceUsd)}`);
        console.log(`orcamento  ${formatUsd(event.budgetUsd)}\n`);
        break;

      case "tool":
        console.log(`-> ${event.name} ${JSON.stringify(event.input)}`);
        break;

      case "quote":
        console.log(
          `   402 Payment Required: ${event.provider} cobra ${formatUsd(event.priceUsd)} ` +
            `(cabe no orcamento: ${event.fitsBudget ? "sim" : "nao"})`,
        );
        break;

      case "purchase":
        console.log(`$  pago ${formatUsd(event.priceUsd)} a ${event.provider}`);
        console.log(`   motivo: ${event.justification}`);
        console.log(`   ${settlementReceipt(event.transaction)}`);
        break;

      case "refusal":
        console.log(`   recusado: ${event.reason}`);
        break;

      case "budget":
        console.log(
          `   orcamento: gasto ${formatUsd(event.spentUsd)}, resta ${formatUsd(event.remainingUsd)}\n`,
        );
        break;

      case "text":
        console.log(event.delta.trimEnd());
        break;

      case "done":
        console.log(`\nsaldo da carteira: ${formatUsd(event.walletBalanceUsd)}`);
        break;

      default:
        break;
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
