import { AfterToolCallEvent, BeforeToolCallEvent } from "@strands-agents/sdk";
import { config } from "./config.js";
import { createTravelAgent } from "./agent.js";
import { describeModel } from "./model.js";
import { BudgetPolicy } from "./budget.js";
import { PremiumApiClient } from "./x402-client.js";
import { SessionState } from "./session.js";
import { assertFunded, fundWallet, wallet, walletBalance } from "./wallet.js";
import type { RunEvent, RunEventSink } from "./events.js";

const PAID_TOOL = "buy_premium_insight";

/**
 * Monta o pedido no formato da secao 4 do documento: objetivo, prioridades e
 * orcamento de inteligencia.
 *
 * @param goal - Objetivo informado pelo usuario
 * @returns O pedido estruturado enviado ao agente
 */
export function buildRequest(goal: string): string {
  const priorities = config.travelerPriorities
    .map((priority, index) => `${index + 1}. ${priority}`)
    .join("\n");

  return [
    `Objetivo:\n${goal}`,
    `Prioridades do viajante:\n${priorities}`,
    `Budget de inteligencia premium:\n$${config.premiumBudgetUsd.toFixed(2)}`,
  ].join("\n\n");
}

/**
 * Extrai o texto de uma lista de blocos de conteudo do Strands.
 *
 * @param content - Blocos devolvidos pelo modelo ou por uma tool
 * @returns O texto concatenado
 */
function textOf(content: { text?: string }[]): string {
  return content
    .map((block) => ("text" in block ? (block.text ?? "") : ""))
    .join("")
    .trim();
}

/**
 * Executa o agente publicando cada passo em um sink de eventos.
 *
 * E o mesmo caminho que a CLI percorre, mas instrumentado: a interface web
 * consome esses eventos por SSE e monta a linha do tempo da execucao.
 *
 * @param goal - Objetivo informado pelo usuario
 * @param onEvent - Destino dos eventos da execucao
 */
export async function runAgent(goal: string, onEvent: RunEventSink): Promise<void> {
  const balance = await fundWallet();
  assertFunded(balance);

  const budget = new BudgetPolicy(config.premiumBudgetUsd);
  const client = new PremiumApiClient(budget, onEvent);
  const session = new SessionState();
  const agent = createTravelAgent(budget, client, session);

  onEvent({
    type: "start",
    goal,
    priorities: [...config.travelerPriorities],
    budgetUsd: config.premiumBudgetUsd,
    walletAddress: wallet.address,
    walletBalanceUsd: balance,
    network: config.network,
    facilitatorMode: config.facilitatorMode,
    model: describeModel(),
  });
  onEvent({
    type: "budget",
    totalUsd: budget.totalBudgetUsd,
    spentUsd: budget.spentUsd,
    remainingUsd: budget.remainingUsd,
  });

  agent.addHook(BeforeToolCallEvent, (event) => {
    onEvent({
      type: "tool",
      id: event.toolUse.toolUseId,
      name: event.toolUse.name,
      input: event.toolUse.input,
      paid: event.toolUse.name === PAID_TOOL,
    });
  });

  agent.addHook(AfterToolCallEvent, (event) => {
    const output = event.result.content.map((block) => {
      if ("text" in block) {
        return block.text;
      }

      return "json" in block ? block.json : null;
    });

    onEvent({
      type: "tool-result",
      id: event.result.toolUseId,
      name: event.toolUse.name,
      ok: event.result.status === "success",
      output: output.length === 1 ? output[0] : output,
    });
  });

  let recommendation = "";

  for await (const streamed of agent.stream(buildRequest(goal))) {
    // Blocos de texto completos, ja fora do raciocinio interno do modelo.
    if (streamed.type === "contentBlockEvent" && streamed.contentBlock.type === "textBlock") {
      const delta = streamed.contentBlock.text;
      recommendation += delta;
      onEvent({ type: "text", delta });
    }
  }

  onEvent({ type: "done", recommendation: recommendation.trim(), walletBalanceUsd: await walletBalance() });
}

export type { RunEvent };
