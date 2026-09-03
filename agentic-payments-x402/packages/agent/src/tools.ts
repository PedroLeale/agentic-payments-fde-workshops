import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { FREE_APIS, PREMIUM_APIS, findPremiumApi } from "@travel-x402/shared";
import { config } from "./config.js";
import type { BudgetPolicy } from "./budget.js";
import type { PremiumApiClient } from "./x402-client.js";
import type { SessionState } from "./session.js";

/** Parametros livres aceitos pelas rotas premium. */
const paramsSchema = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .optional()
  .describe(
    "Parametros da consulta, conforme o campo `params` do catalogo. " +
      "Ex.: { airport: 'LAX', inboundFlight: 'AA123', connectionMinutes: 95 }",
  );

/**
 * Busca em uma rota gratuita do marketplace.
 *
 * @param path - Caminho da rota
 * @param params - Parametros de query
 * @returns O corpo JSON da resposta
 */
async function getFree(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(path, config.sellersBaseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url);
  return response.json();
}

/**
 * Monta as tools do agente sobre uma politica de orcamento e um cliente x402.
 *
 * A separacao entre `get_premium_price` e `buy_premium_insight` e proposital:
 * descobrir o preco e um passo com custo zero, e e entre os dois que o agente
 * decide se a informacao vale o que custa.
 *
 * @param budget - Politica de orcamento da execucao
 * @param client - Cliente x402 do agente
 * @param session - Estado da execucao, que impoe o funil gratuito -> premium
 * @returns A lista de tools registradas no agente
 */
export function createTools(
  budget: BudgetPolicy,
  client: PremiumApiClient,
  session: SessionState,
) {
  /**
   * Chave que identifica uma consulta premium ja paga.
   *
   * @param apiId - Identificador da API
   * @param params - Parametros da consulta
   * @returns A chave normalizada
   */
  const purchaseKey = (apiId: string, params: Record<string, string | number>): string =>
    `${apiId}:${JSON.stringify(Object.entries(params).sort())}`;

  /**
   * Recusa consultas premium enquanto nenhuma fonte gratuita foi consultada.
   *
   * @returns A mensagem de recusa, ou null quando o funil ja foi respeitado
   */
  const requireFreeSearch = (): { erro: string } | null =>
    session.hasFreeSearch
      ? null
      : {
          erro:
            "Voce ainda nao consultou nenhuma fonte gratuita, e nao se compra informacao " +
            "sobre opcoes que voce ainda nao viu. Chame search_flights agora e, com as opcoes " +
            "em maos, refaca esta chamada usando os dados reais do voo que quiser avaliar.",
        };

  const searchFlights = tool({
    name: "search_flights",
    description:
      "GRATUITO. Busca opcoes de voo com preco, escalas e tempo de conexao. " +
      "Sempre comece por aqui: nao gaste orcamento antes de conhecer os candidatos.",
    inputSchema: z.object({
      origin: z.string().describe("Codigo IATA de origem, ex.: GRU"),
      destination: z.string().describe("Codigo IATA de destino, ex.: HND"),
      departureDate: z.string().optional().describe("Data de partida (YYYY-MM-DD)"),
    }),
    callback: async (input) => {
      session.markFreeSearch();

      return getFree(FREE_APIS.flightSearch, {
        origin: input.origin,
        destination: input.destination,
        departureDate: input.departureDate ?? "",
      }) as Promise<Record<string, unknown>>;
    },
  });

  const searchHotels = tool({
    name: "search_hotels",
    description: "GRATUITO. Lista hoteis no destino com a diaria atual.",
    inputSchema: z.object({
      city: z.string().describe("Cidade de destino, ex.: Tokyo"),
    }),
    callback: async (input) => {
      session.markFreeSearch();

      return getFree(FREE_APIS.hotelSearch, { city: input.city }) as Promise<
        Record<string, unknown>
      >;
    },
  });

  const listCatalog = tool({
    name: "list_premium_catalog",
    description:
      "GRATUITO. Lista as APIs premium disponiveis, com preco por request e quando cada uma vale a pena.",
    callback: async () => {
      const response = await fetch(new URL("/catalog", config.sellersBaseUrl));
      const catalog = (await response.json()) as { apis: unknown[] };

      return {
        budgetRestanteUsd: budget.remainingUsd,
        apis: catalog.apis,
      };
    },
  });

  const getPremiumPrice = tool({
    name: "get_premium_price",
    description:
      "GRATUITO. Pergunta a uma API premium quanto ela cobra, sem pagar nada. " +
      "A API responde 402 Payment Required com o preco. Use antes de decidir comprar.",
    inputSchema: z.object({
      apiId: z.enum(PREMIUM_APIS.map((api) => api.id) as [string, ...string[]]),
      params: paramsSchema,
    }),
    callback: async (input) => {
      const blocked = requireFreeSearch();

      if (blocked) {
        return blocked;
      }

      const api = findPremiumApi(input.apiId);

      if (!api) {
        return { erro: `API desconhecida: ${input.apiId}` };
      }

      const quote = await client.quote(api, input.params ?? {});
      const decision = budget.evaluate(quote.priceUsd);

      return {
        apiId: quote.apiId,
        provider: quote.provider,
        precoUsd: quote.priceUsd,
        rede: quote.network,
        recebedor: quote.payTo,
        budgetRestanteUsd: budget.remainingUsd,
        cabeNoOrcamento: decision.allowed,
      };
    },
  });

  const buyPremiumInsight = tool({
    name: "buy_premium_insight",
    description:
      "PAGO. Paga a API premium via x402 e devolve os dados. O valor sai do orcamento. " +
      "So chame quando a informacao puder mudar a recomendacao final - o objetivo nao e gastar o orcamento inteiro.",
    inputSchema: z.object({
      apiId: z.enum(PREMIUM_APIS.map((api) => api.id) as [string, ...string[]]),
      params: paramsSchema,
      justificativa: z
        .string()
        .describe("Em uma frase: que decisao esta informacao vai mudar e por que compensa pagar."),
    }),
    callback: async (input) => {
      const blocked = requireFreeSearch();

      if (blocked) {
        return blocked;
      }

      const api = findPremiumApi(input.apiId);

      if (!api) {
        return { erro: `API desconhecida: ${input.apiId}` };
      }

      const params = input.params ?? {};
      const key = purchaseKey(input.apiId, params);

      if (session.alreadyPurchased(key)) {
        return {
          comprado: false,
          motivo: "Voce ja comprou exatamente esta consulta nesta execucao. Use o dado que ja tem.",
          budgetRestanteUsd: budget.remainingUsd,
        };
      }

      const result = await client.purchase(api, params, input.justificativa);

      if ("refused" in result) {
        return {
          comprado: false,
          motivo: result.reason,
          budgetRestanteUsd: budget.remainingUsd,
        };
      }

      session.markPurchased(key);

      return {
        comprado: true,
        provider: result.provider,
        precoUsd: result.priceUsd,
        transacao: result.transaction,
        dados: result.data,
        budgetGastoUsd: budget.spentUsd,
        budgetRestanteUsd: budget.remainingUsd,
      };
    },
  });

  const getBudgetStatus = tool({
    name: "get_budget_status",
    description: "GRATUITO. Mostra quanto do orcamento premium ja foi gasto e o que foi comprado.",
    callback: async () => ({
      budgetTotalUsd: budget.totalBudgetUsd,
      budgetGastoUsd: budget.spentUsd,
      budgetRestanteUsd: budget.remainingUsd,
      compras: budget.history.map((purchase) => ({
        provider: purchase.provider,
        precoUsd: purchase.priceUsd,
        justificativa: purchase.justification,
      })),
    }),
  });

  return [
    searchFlights,
    searchHotels,
    listCatalog,
    getPremiumPrice,
    buyPremiumInsight,
    getBudgetStatus,
  ];
}
