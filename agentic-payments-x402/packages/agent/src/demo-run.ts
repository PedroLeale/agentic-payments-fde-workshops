import { findPremiumApi } from "@travel-x402/shared";
import { config } from "./config.js";
import { BudgetPolicy } from "./budget.js";
import { PremiumApiClient } from "./x402-client.js";
import { assertFunded, fundWallet, wallet, walletBalance } from "./wallet.js";
import type { RunEventSink } from "./events.js";

type FlightOption = {
  id: string;
  route: string;
  priceUsd: number;
  inboundFlight: string;
  outboundFlight: string;
  connectionAirport: string;
  connectionMinutes: number;
  connectionLabel: string;
};

/**
 * Roteiro deterministico do cenario da secao 7 do documento.
 *
 * Publica exatamente os mesmos eventos do agente - inclusive `quote` e
 * `purchase` reais, com liquidacao de verdade - mas com as decisoes escritas em
 * codigo. E o que garante que a demo mostre o fluxo completo mesmo quando o
 * modelo disponivel nao sustenta o raciocinio.
 *
 * @param onEvent - Destino dos eventos da execucao
 */
export async function runDemo(onEvent: RunEventSink): Promise<void> {
  const balance = await fundWallet();
  assertFunded(balance);

  const budget = new BudgetPolicy(config.premiumBudgetUsd);
  const client = new PremiumApiClient(budget, onEvent);

  /**
   * Publica uma linha da narrativa como texto.
   *
   * @param text - Linha a publicar
   */
  const say = (text: string): void => onEvent({ type: "text", delta: `${text}\n` });

  onEvent({
    type: "start",
    goal: "Roteiro deterministico: o cenario da secao 7 do documento, sem LLM no caminho.",
    priorities: [...config.travelerPriorities],
    budgetUsd: config.premiumBudgetUsd,
    walletAddress: wallet.address,
    walletBalanceUsd: balance,
    network: config.network,
    facilitatorMode: config.facilitatorMode,
    model: "roteiro deterministico (sem modelo)",
  });
  onEvent({
    type: "budget",
    totalUsd: budget.totalBudgetUsd,
    spentUsd: budget.spentUsd,
    remainingUsd: budget.remainingUsd,
  });

  // Etapa 1 - busca gratuita
  onEvent({
    type: "tool",
    id: "demo-search",
    name: "search_flights",
    input: { origin: "GRU", destination: "HND" },
    paid: false,
  });

  const search = await fetch(
    new URL("/free/flight-search?origin=GRU&destination=HND", config.sellersBaseUrl),
  );
  const { options } = (await search.json()) as { options: FlightOption[] };

  onEvent({
    type: "tool-result",
    id: "demo-search",
    name: "search_flights",
    ok: true,
    output: { options },
  });

  const cheapest = [...options].sort((a, b) => a.priceUsd - b.priceUsd)[0]!;
  const safest = [...options].sort((a, b) => b.connectionMinutes - a.connectionMinutes)[0]!;

  say(
    `Os dados gratuitos trazem preco e conexao. A opcao ${cheapest.id} e a mais barata ` +
      `($${cheapest.priceUsd}), mas depende de uma conexao de ${cheapest.connectionLabel} em ` +
      `${cheapest.connectionAirport}. O que eles nao dizem e se essa conexao aguenta um atraso.`,
  );

  // Etapa 2 - a incerteza mais cara de errar
  const connectionRisk = findPremiumApi("connection-risk")!;
  const riskParams = {
    airport: cheapest.connectionAirport,
    inboundFlight: cheapest.inboundFlight,
    outboundFlight: cheapest.outboundFlight,
    connectionMinutes: cheapest.connectionMinutes,
  };
  const risk = await client.purchase(
    connectionRisk,
    riskParams,
    `Avaliar se a conexao de ${cheapest.connectionLabel} em ${cheapest.connectionAirport} inviabiliza a opcao mais barata`,
  );

  if ("refused" in risk) {
    say(`Compra recusada: ${risk.reason}`);
    onEvent({ type: "done", recommendation: "", walletBalanceUsd: await walletBalance() });
    return;
  }

  const riskData = risk.data as {
    missProbability: number;
    risk: string;
    recommendedMinimumConnection: string;
  };
  say(
    `ConnectionRisk: ${Math.round(riskData.missProbability * 100)}% de chance de perder a conexao ` +
      `(risco ${riskData.risk}, minimo recomendado ${riskData.recommendedMinimumConnection}).`,
  );

  // Etapa 3 - a alternativa segura esta com preco bom?
  const farePulse = findPremiumApi("fare-forecast")!;
  const fare = await client.purchase(
    farePulse,
    {
      origin: "GRU",
      destination: "HND",
      departureDate: "2026-10-10",
      currentPrice: safest.priceUsd,
    },
    `Saber se vale reservar a opcao ${safest.id} agora ou esperar uma queda de preco`,
  );

  if ("refused" in fare) {
    say(`Compra recusada: ${fare.reason}`);
    onEvent({ type: "done", recommendation: "", walletBalanceUsd: await walletBalance() });
    return;
  }

  const fareData = fare.data as {
    dropProbability72h: number;
    expectedRange: { min: number; max: number };
    recommendation: string;
  };
  say(
    `FarePulse: ${Math.round(fareData.dropProbability72h * 100)}% de chance de queda em 72h, ` +
      `faixa esperada $${fareData.expectedRange.min}-$${fareData.expectedRange.max} ` +
      `(${fareData.recommendation}).`,
  );

  const recommendation = [
    `Nao reservar a opcao ${cheapest.id}: ${Math.round(riskData.missProbability * 100)}% de risco ` +
      `na conexao de ${cheapest.connectionLabel} nao compensa economizar ` +
      `$${safest.priceUsd - cheapest.priceUsd}.`,
    `Aguardar ate 72h antes de reservar a opcao ${safest.id}: ha ` +
      `${Math.round(fareData.dropProbability72h * 100)}% de chance de o preco cair para a faixa ` +
      `$${fareData.expectedRange.min}-$${fareData.expectedRange.max}.`,
    `Custo da inteligencia: $${budget.spentUsd.toFixed(2)} de um orcamento de ` +
      `$${budget.totalBudgetUsd.toFixed(2)}, para melhorar uma decisao de ~$${safest.priceUsd}.`,
  ].join("\n\n");

  say(`\n${recommendation}`);
  onEvent({ type: "done", recommendation, walletBalanceUsd: await walletBalance() });
}
