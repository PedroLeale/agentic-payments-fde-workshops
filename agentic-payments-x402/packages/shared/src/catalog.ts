import type { PremiumApi } from "./types.js";

/**
 * Carteiras que recebem os pagamentos. Sao as contas #1..#5 do Anvil/Hardhat:
 * enderecos publicos de teste, usados aqui so para deixar visivel no ledger
 * qual provider faturou o que.
 */
const PAY_TO = {
  farePulse: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  connectionRisk: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  flightReliability: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  hotelRatePro: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  eventsNow: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
} as const;

/**
 * Catalogo do marketplace. Cada entrada e uma API independente, cobrada por
 * request via x402 - nao ha cadastro, assinatura nem API key.
 */
export const PREMIUM_APIS: readonly PremiumApi[] = [
  {
    id: "connection-risk",
    provider: "ConnectionRisk",
    path: "/premium/connection-risk",
    price: "$0.04",
    payTo: PAY_TO.connectionRisk,
    capability: "Probabilidade de perder uma conexao e tempo minimo recomendado.",
    whenToUse:
      "Quando uma opcao barata depende de uma conexao curta e o risco de perde-la muda a recomendacao.",
    params: ["airport", "inboundFlight", "outboundFlight", "connectionMinutes"],
  },
  {
    id: "fare-forecast",
    provider: "FarePulse",
    path: "/premium/fare-forecast",
    price: "$0.03",
    payTo: PAY_TO.farePulse,
    capability: "Previsao de queda de preco da passagem nas proximas 72h.",
    whenToUse:
      "Quando a duvida e comprar agora ou esperar, e a diferenca esperada de preco justifica o custo da consulta.",
    params: ["origin", "destination", "departureDate", "currentPrice"],
  },
  {
    id: "flight-reliability",
    provider: "FlightReliability",
    path: "/premium/flight-reliability",
    price: "$0.02",
    payTo: PAY_TO.flightReliability,
    capability: "Pontualidade historica, atraso medio e taxa de cancelamento do voo.",
    whenToUse:
      "Quando duas opcoes empatam em preco e a confiabilidade operacional decide.",
    params: ["flightNumber"],
  },
  {
    id: "hotel-rate-intelligence",
    provider: "HotelRatePro",
    path: "/premium/hotel-rate-intelligence",
    price: "$0.03",
    payTo: PAY_TO.hotelRatePro,
    capability: "Diaria media atual, projecao para 48h e pressao de ocupacao.",
    whenToUse: "Quando a decisao e reservar o hotel agora ou aguardar.",
    params: ["city", "checkIn", "checkOut"],
  },
  {
    id: "destination-events",
    provider: "EventsNow",
    path: "/premium/destination-events",
    price: "$0.01",
    payTo: PAY_TO.eventsNow,
    capability: "Eventos no destino no periodo e o impacto esperado na demanda hoteleira.",
    whenToUse:
      "Consulta barata, util para explicar por que os precos de hotel estao pressionados.",
    params: ["city", "from", "to"],
  },
];

/**
 * Endereco que recebe o pagamento de uma API.
 *
 * `SELLER_PAY_TO` redireciona todos os providers para um unico endereco. E util
 * no modo testnet para ver o USDC chegar na sua propria carteira - ao custo de
 * perder a separacao por provider no extrato.
 *
 * @param api - API do catalogo
 * @returns O endereco que deve receber o pagamento
 */
export function resolvePayTo(api: PremiumApi): string {
  return process.env.SELLER_PAY_TO?.trim() || api.payTo;
}

/**
 * Busca uma API do catalogo pelo id.
 *
 * @param id - Identificador da API
 * @returns A API correspondente, ou undefined
 */
export function findPremiumApi(id: string): PremiumApi | undefined {
  return PREMIUM_APIS.find((api) => api.id === id);
}

/** Rotas gratuitas expostas pelo mesmo servidor, sem x402. */
export const FREE_APIS = {
  flightSearch: "/free/flight-search",
  hotelSearch: "/free/hotel-search",
} as const;
