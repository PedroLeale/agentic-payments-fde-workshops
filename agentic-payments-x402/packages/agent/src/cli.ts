import { AfterToolCallEvent, BeforeToolCallEvent } from "@strands-agents/sdk";
import { formatUsd } from "@travel-x402/shared";
import { config } from "./config.js";
import { createTravelAgent } from "./agent.js";
import { describeModel, explainModelError } from "./model.js";
import { BudgetPolicy } from "./budget.js";
import { PremiumApiClient } from "./x402-client.js";
import { SessionState } from "./session.js";
import { assertFunded, fundWallet, wallet, walletBalance } from "./wallet.js";
import { settlementReceipt } from "./chain.js";

const DEFAULT_GOAL =
  "Planejar viagem de Sao Paulo (GRU) para Toquio (HND) entre 10 e 20 de outubro de 2026.";

/**
 * Monta o pedido no formato da secao 4 do documento: objetivo, prioridades e
 * orcamento de inteligencia. O agente decide sozinho o que fazer com isso.
 *
 * @param goal - Objetivo informado pelo usuario
 * @returns O pedido estruturado enviado ao agente
 */
function buildRequest(goal: string): string {
  const priorities = config.travelerPriorities
    .map((priority, index) => `${index + 1}. ${priority}`)
    .join("\n");

  return [
    `Objetivo:\n${goal}`,
    `Prioridades do viajante:\n${priorities}`,
    `Budget de inteligencia premium:\n${formatUsd(config.premiumBudgetUsd)}`,
  ].join("\n\n");
}

/**
 * Espera um servico HTTP ficar disponivel.
 *
 * @param name - Nome exibido em caso de falha
 * @param url - URL de health check
 * @param timeoutMs - Tempo maximo de espera
 */
async function waitFor(name: string, url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });

      if (response.ok) {
        return;
      }
    } catch {
      // servico ainda subindo
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${name} nao respondeu em ${url}. Rode \`npm run dev\` em outro terminal.`);
}

/**
 * Resume um valor JSON em uma linha curta para o log.
 *
 * @param value - Valor a resumir
 * @param limit - Tamanho maximo
 * @returns O texto resumido
 */
function summarize(value: unknown, limit = 150): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);

  if (!text) {
    return "";
  }

  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

/**
 * Executa o cenario de ponta a ponta e imprime o relatorio da execucao.
 */
async function main(): Promise<void> {
  const goal = process.argv.slice(2).join(" ").trim() || DEFAULT_GOAL;
  const request = buildRequest(goal);

  console.log("=".repeat(78));
  console.log("AGENTIC TRAVEL - pay-per-intelligence com x402");
  console.log("=".repeat(78));
  console.log(`carteira     ${wallet.address}`);
  console.log(`modelo       ${describeModel()}`);
  console.log(`facilitator  ${config.facilitatorUrl} (modo ${config.facilitatorMode})`);
  console.log(`marketplace  ${config.sellersBaseUrl}`);
  console.log(`orcamento    ${formatUsd(config.premiumBudgetUsd)}`);

  await waitFor("Facilitator", `${config.facilitatorUrl}/supported`);
  await waitFor("Marketplace", `${config.sellersBaseUrl}/health`);

  const initialBalance = await fundWallet();
  console.log(`saldo USDC   ${formatUsd(initialBalance)}`);
  assertFunded(initialBalance);
  console.log();
  console.log("PEDIDO");
  console.log("-".repeat(78));
  console.log(request);
  console.log("-".repeat(78));

  const budget = new BudgetPolicy(config.premiumBudgetUsd);
  const client = new PremiumApiClient(budget);
  const session = new SessionState();
  const agent = createTravelAgent(budget, client, session);

  agent.addHook(BeforeToolCallEvent, (event) => {
    const paid = event.toolUse.name === "buy_premium_insight";
    console.log(`${paid ? "$" : " "} -> ${event.toolUse.name} ${summarize(event.toolUse.input)}`);
  });

  agent.addHook(AfterToolCallEvent, (event) => {
    const output = event.result.content
      .map((block) => {
        if ("text" in block) {
          return block.text;
        }

        return "json" in block ? JSON.stringify(block.json) : "";
      })
      .join(" ")
      .trim();
    console.log(`    <- ${event.result.status === "error" ? "ERRO " : ""}${summarize(output)}`);
  });

  const result = await agent.invoke(request);

  console.log("-".repeat(78));
  console.log("RECOMENDACAO");
  console.log("-".repeat(78));
  console.log(
    result.lastMessage.content
      .map((block) => ("text" in block ? block.text : ""))
      .join("")
      .trim(),
  );

  console.log();
  console.log("-".repeat(78));
  console.log("INTELIGENCIA PREMIUM COMPRADA");
  console.log("-".repeat(78));

  if (budget.history.length === 0) {
    console.log("(nenhuma compra - o agente decidiu com os dados gratuitos)");
  }

  for (const purchase of budget.history) {
    console.log(`${formatUsd(purchase.priceUsd).padEnd(8)} ${purchase.provider}`);
    console.log(`         motivo: ${purchase.justification}`);
    console.log(`         tx:     ${settlementReceipt(purchase.transaction)}`);
  }

  const finalBalance = await walletBalance();

  console.log("-".repeat(78));
  console.log(`orcamento total     ${formatUsd(budget.totalBudgetUsd)}`);
  console.log(`gasto               ${formatUsd(budget.spentUsd)}`);
  console.log(`restante            ${formatUsd(budget.remainingUsd)}`);
  console.log(`saldo da carteira   ${formatUsd(finalBalance)}`);
}

main().catch((error) => {
  console.error(explainModelError(error));
  process.exit(1);
});
