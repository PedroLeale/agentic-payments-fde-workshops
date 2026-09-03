import express from "express";
import type { Request } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { DEFAULT_NETWORK, FREE_APIS, PREMIUM_APIS, resolvePayTo } from "@travel-x402/shared";
import {
  FLIGHT_OPTIONS,
  HOTELS,
  connectionRisk,
  destinationEvents,
  fareForecast,
  flightReliability,
  hotelRateIntelligence,
} from "./fixtures/travel.js";
import { waitForFacilitator } from "./wait-for-facilitator.js";

const PORT = Number(process.env.SELLERS_PORT ?? 4021);
const NETWORK = (process.env.X402_NETWORK ?? DEFAULT_NETWORK) as typeof DEFAULT_NETWORK;
const FACILITATOR_URL =
  process.env.FACILITATOR_MODE === "testnet"
    ? (process.env.TESTNET_FACILITATOR_URL ?? "https://x402.org/facilitator")
    : (process.env.FACILITATOR_URL ?? "http://localhost:4020");

/**
 * Le um parametro de query como texto.
 *
 * @param req - Requisicao HTTP
 * @param name - Nome do parametro
 * @param fallback - Valor usado quando o parametro nao vem
 * @returns O valor do parametro
 */
function param(req: Request, name: string, fallback = ""): string {
  const value = req.query[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Le um parametro de query como numero.
 *
 * @param req - Requisicao HTTP
 * @param name - Nome do parametro
 * @param fallback - Valor usado quando o parametro nao vem ou nao e numerico
 * @returns O valor numerico do parametro
 */
function numberParam(req: Request, name: string, fallback: number): number {
  const value = Number(param(req, name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Rotas gratuitas: preco e horario, o suficiente para montar candidatos.
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "travel-marketplace", network: NETWORK });
});

/** Catalogo do marketplace: o que existe, quanto custa e quando vale a pena. */
app.get("/catalog", (_req, res) => {
  res.json({
    network: NETWORK,
    apis: PREMIUM_APIS.map((api) => ({
      id: api.id,
      provider: api.provider,
      path: api.path,
      priceUsd: Number(api.price.replace("$", "")),
      capability: api.capability,
      whenToUse: api.whenToUse,
      params: api.params,
    })),
  });
});

app.get(FREE_APIS.flightSearch, (req, res) => {
  res.json({
    aviso:
      "Dados gratuitos: trazem preco e tempo de conexao, mas NAO trazem risco de perder a " +
      "conexao, pontualidade do voo nem tendencia de preco.",
    // O tier gratuito anuncia o pago: e assim que um marketplace freemium
    // funciona, e e o gancho que leva o agente ao passo seguinte do funil.
    proximoPasso:
      "Escolha a opcao cuja incerteza e mais cara de errar e compre a informacao que falta " +
      "com buy_premium_insight. Uma conexao curta em uma viagem de ~$1000 costuma justificar " +
      "os centavos de connection-risk.",
    origin: param(req, "origin", "GRU"),
    destination: param(req, "destination", "HND"),
    departureDate: param(req, "departureDate", "2026-10-10"),
    options: FLIGHT_OPTIONS,
  });
});

app.get(FREE_APIS.hotelSearch, (req, res) => {
  res.json({
    city: param(req, "city", "Tokyo"),
    source: "free-tier",
    hotels: HOTELS,
  });
});

// ---------------------------------------------------------------------------
// x402: cada rota premium declara quanto custa, em que rede e para quem pagar.
// O middleware responde 402 com essas condicoes e so libera o handler depois
// que o facilitator verificar a autorizacao assinada pelo comprador.
// ---------------------------------------------------------------------------
const routes: RoutesConfig = Object.fromEntries(
  PREMIUM_APIS.map((api) => [
    `GET ${api.path}`,
    {
      accepts: [
        {
          scheme: "exact",
          price: api.price,
          network: NETWORK,
          payTo: resolvePayTo(api),
        },
      ],
      description: `${api.provider}: ${api.capability}`,
      mimeType: "application/json",
    },
  ]),
);

/**
 * Registra os handlers das rotas premium. Eles so sao alcancados depois que o
 * middleware x402 confirmou o pagamento da requisicao.
 */
function registerPremiumRoutes(): void {
  app.get("/premium/connection-risk", (req, res) => {
    res.json(
      connectionRisk({
        airport: param(req, "airport", "LAX"),
        inboundFlight: param(req, "inboundFlight", "AA123"),
        outboundFlight: param(req, "outboundFlight", "JL456"),
        connectionMinutes: numberParam(req, "connectionMinutes", 95),
      }),
    );
  });

  app.get("/premium/fare-forecast", (req, res) => {
    res.json(
      fareForecast({
        origin: param(req, "origin", "GRU"),
        destination: param(req, "destination", "HND"),
        departureDate: param(req, "departureDate", "2026-10-10"),
        currentPrice: numberParam(req, "currentPrice", 1080),
      }),
    );
  });

  app.get("/premium/flight-reliability", (req, res) => {
    res.json(flightReliability(param(req, "flightNumber", "AA123")));
  });

  app.get("/premium/hotel-rate-intelligence", (req, res) => {
    res.json(
      hotelRateIntelligence({
        city: param(req, "city", "Tokyo"),
        checkIn: param(req, "checkIn", "2026-10-10"),
        checkOut: param(req, "checkOut", "2026-10-20"),
      }),
    );
  });

  app.get("/premium/destination-events", (req, res) => {
    res.json(
      destinationEvents({
        city: param(req, "city", "Tokyo"),
        from: param(req, "from", "2026-10-10"),
        to: param(req, "to", "2026-10-20"),
      }),
    );
  });
}

/**
 * Sobe o marketplace: espera o facilitator, monta o middleware x402 e escuta.
 */
async function main(): Promise<void> {
  console.log(`Aguardando o facilitator em ${FACILITATOR_URL}...`);
  await waitForFacilitator(FACILITATOR_URL);

  const resourceServer = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: FACILITATOR_URL }),
  ).register(NETWORK, new ExactEvmScheme());

  app.use(paymentMiddleware(routes, resourceServer));
  registerPremiumRoutes();

  app.listen(PORT, () => {
    console.log(`Marketplace de viagens ouvindo em http://localhost:${PORT}`);
    console.log(`  facilitator ${FACILITATOR_URL}`);
    console.log(`  rede        ${NETWORK}`);
    console.log(`  gratuitas   ${Object.values(FREE_APIS).join(", ")}`);
    for (const api of PREMIUM_APIS) {
      console.log(`  ${api.price.padEnd(6)} ${api.path} (${api.provider}) -> ${resolvePayTo(api)}`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
