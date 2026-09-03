import { pseudoRange, round } from "./deterministic.js";

/**
 * Uma opcao de itinerario devolvida pela busca gratuita.
 *
 * O formato e plano de proposito: os campos que as APIs premium pedem
 * (`connectionAirport`, `inboundFlight`, `outboundFlight`, `connectionMinutes`)
 * aparecem prontos para serem copiados na proxima consulta.
 */
export type FlightOption = {
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
 * Resultado da busca gratuita de voos: preco e horario, nada alem disso.
 * E de proposito que essas opcoes nao sejam decidiveis so pelo preco - a
 * duvida que sobra e o que justifica comprar inteligencia premium.
 */
export const FLIGHT_OPTIONS: readonly FlightOption[] = [
  {
    id: "A",
    route: "GRU -> LAX -> HND",
    priceUsd: 920,
    inboundFlight: "AA123",
    outboundFlight: "JL456",
    connectionAirport: "LAX",
    connectionMinutes: 95,
    connectionLabel: "1h35",
  },
  {
    id: "B",
    route: "GRU -> DOH -> HND",
    priceUsd: 1080,
    inboundFlight: "QR774",
    outboundFlight: "QR812",
    connectionAirport: "DOH",
    connectionMinutes: 190,
    connectionLabel: "3h10",
  },
  {
    id: "C",
    route: "GRU -> JFK -> NRT",
    priceUsd: 870,
    inboundFlight: "LA8180",
    outboundFlight: "JL5",
    connectionAirport: "JFK",
    connectionMinutes: 80,
    connectionLabel: "1h20",
  },
];

/** Hoteis devolvidos pela busca gratuita. */
export const HOTELS = [
  { id: "H1", name: "Shinjuku Business Hotel", area: "Shinjuku", nightlyRateUsd: 198, stars: 3 },
  { id: "H2", name: "Ginza Central", area: "Ginza", nightlyRateUsd: 245, stars: 4 },
  { id: "H3", name: "Asakusa Riverside", area: "Asakusa", nightlyRateUsd: 172, stars: 3 },
] as const;

/** Perfil operacional de cada aeroporto de conexao. */
const AIRPORTS: Record<string, { minimumConnectionMinutes: number; baseMissRate: number }> = {
  LAX: { minimumConnectionMinutes: 140, baseMissRate: 0.1 },
  JFK: { minimumConnectionMinutes: 150, baseMissRate: 0.12 },
  DOH: { minimumConnectionMinutes: 90, baseMissRate: 0.05 },
  HND: { minimumConnectionMinutes: 75, baseMissRate: 0.04 },
  NRT: { minimumConnectionMinutes: 90, baseMissRate: 0.05 },
  GRU: { minimumConnectionMinutes: 110, baseMissRate: 0.08 },
};

/** Preco de referencia por rota, usado pela previsao de tarifa. */
const FARE_BASELINES: Record<string, number> = {
  "GRU-HND": 965,
  "GRU-NRT": 940,
  "GRU-LAX": 610,
  "GRU-JFK": 580,
};

/** Confiabilidade historica por voo. */
const FLIGHT_RELIABILITY: Record<string, { onTimeRate: number; averageDelayMinutes: number; cancellationRate: number }> = {
  AA123: { onTimeRate: 0.71, averageDelayMinutes: 38, cancellationRate: 0.03 },
  JL456: { onTimeRate: 0.92, averageDelayMinutes: 9, cancellationRate: 0.01 },
  QR774: { onTimeRate: 0.89, averageDelayMinutes: 14, cancellationRate: 0.01 },
  QR812: { onTimeRate: 0.9, averageDelayMinutes: 12, cancellationRate: 0.01 },
  LA8180: { onTimeRate: 0.68, averageDelayMinutes: 44, cancellationRate: 0.04 },
  JL5: { onTimeRate: 0.93, averageDelayMinutes: 8, cancellationRate: 0.01 },
};

/**
 * Classifica uma probabilidade de perda de conexao.
 *
 * @param probability - Probabilidade estimada
 * @returns O nivel de risco correspondente
 */
function classifyRisk(probability: number): "LOW" | "MEDIUM" | "HIGH" {
  if (probability < 0.1) {
    return "LOW";
  }

  return probability < 0.22 ? "MEDIUM" : "HIGH";
}

/**
 * Formata minutos como `2h20`.
 *
 * @param minutes - Duracao em minutos
 * @returns A duracao formatada
 */
function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * ConnectionRisk: estima o risco de perder a conexao.
 *
 * @param params - Aeroporto, voos e tempo de conexao
 * @param params.airport - Aeroporto da conexao
 * @param params.inboundFlight - Voo de chegada
 * @param params.outboundFlight - Voo de saida
 * @param params.connectionMinutes - Tempo de conexao em minutos
 * @returns A avaliacao de risco da conexao
 */
export function connectionRisk(params: {
  airport: string;
  inboundFlight: string;
  outboundFlight: string;
  connectionMinutes: number;
}) {
  const airport = AIRPORTS[params.airport.toUpperCase()] ?? {
    minimumConnectionMinutes: Math.round(pseudoRange(params.airport, 80, 150)),
    baseMissRate: round(pseudoRange(`${params.airport}:base`, 0.04, 0.14), 3),
  };

  const deficit = Math.max(0, airport.minimumConnectionMinutes - params.connectionMinutes);
  const inbound = FLIGHT_RELIABILITY[params.inboundFlight.toUpperCase()];
  // Um voo de chegada menos pontual que a media do setor empurra o risco para cima.
  const inboundPenalty = inbound ? Math.max(0, 0.85 - inbound.onTimeRate) * 0.25 : 0;
  const missProbability = Math.min(
    0.95,
    round(airport.baseMissRate + (deficit / airport.minimumConnectionMinutes) * 0.451 + inboundPenalty, 2),
  );

  return {
    airport: params.airport.toUpperCase(),
    inboundFlight: params.inboundFlight.toUpperCase(),
    outboundFlight: params.outboundFlight.toUpperCase(),
    connectionMinutes: params.connectionMinutes,
    missProbability,
    recommendedMinimumConnection: formatMinutes(airport.minimumConnectionMinutes),
    risk: classifyRisk(missProbability),
  };
}

/**
 * FarePulse: projeta o comportamento do preco nas proximas 72h.
 *
 * @param params - Rota, data e preco atual
 * @param params.origin - Aeroporto de origem
 * @param params.destination - Aeroporto de destino
 * @param params.departureDate - Data de partida
 * @param params.currentPrice - Preco atual da passagem
 * @returns A previsao de tarifa
 */
export function fareForecast(params: {
  origin: string;
  destination: string;
  departureDate: string;
  currentPrice: number;
}) {
  const key = `${params.origin.toUpperCase()}-${params.destination.toUpperCase()}`;
  const baseline = FARE_BASELINES[key] ?? Math.round(pseudoRange(key, 450, 1200));
  const premium = params.currentPrice / baseline - 1;
  const dropProbability72h = Math.min(0.95, Math.max(0.05, round(0.5 + premium * 1.93, 2)));

  return {
    route: key,
    departureDate: params.departureDate,
    currentPrice: params.currentPrice,
    currency: "USD",
    dropProbability72h,
    expectedRange: { min: Math.round(baseline * 0.974), max: Math.round(baseline * 1.026) },
    recommendation:
      dropProbability72h >= 0.6 ? "WAIT" : dropProbability72h >= 0.35 ? "MONITOR" : "BOOK_NOW",
  };
}

/**
 * FlightReliability: pontualidade historica do voo.
 *
 * @param flightNumber - Numero do voo
 * @returns As estatisticas operacionais do voo
 */
export function flightReliability(flightNumber: string) {
  const key = flightNumber.toUpperCase();
  const stats = FLIGHT_RELIABILITY[key] ?? {
    onTimeRate: round(pseudoRange(key, 0.6, 0.95), 2),
    averageDelayMinutes: Math.round(pseudoRange(`${key}:delay`, 8, 55)),
    cancellationRate: round(pseudoRange(`${key}:cancel`, 0.005, 0.05), 3),
  };

  return { flightNumber: key, ...stats, sampleSizeDays: 180 };
}

/**
 * HotelRatePro: inteligencia de preco e ocupacao de hoteis.
 *
 * @param params - Cidade e datas da estadia
 * @param params.city - Cidade de destino
 * @param params.checkIn - Data de entrada
 * @param params.checkOut - Data de saida
 * @returns A projecao de diarias para o periodo
 */
export function hotelRateIntelligence(params: { city: string; checkIn: string; checkOut: string }) {
  const key = params.city.toLowerCase();
  const isHighDemand = key === "tokyo" || key === "toquio";
  const currentAverageRate = isHighDemand ? 210 : Math.round(pseudoRange(key, 90, 260));
  const pressureFactor = isHighDemand ? 1.167 : 1 + pseudoRange(`${key}:pressure`, -0.06, 0.18);
  const expectedRateIn48h = Math.round(currentAverageRate * pressureFactor);
  const delta = expectedRateIn48h / currentAverageRate - 1;

  return {
    city: params.city,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    currentAverageRate,
    expectedRateIn48h,
    occupancyPressure: delta > 0.1 ? "HIGH" : delta > 0.02 ? "MEDIUM" : "LOW",
    recommendation: delta > 0.05 ? "BOOK_NOW" : "WAIT",
  };
}

/** Eventos conhecidos por cidade. */
const EVENTS: Record<string, { name: string; expectedAttendance: number }[]> = {
  tokyo: [
    { name: "Tokyo International Motor Show", expectedAttendance: 85000 },
    { name: "Shibuya Digital Art Week", expectedAttendance: 24000 },
  ],
};

/**
 * EventsNow: eventos no destino e impacto na demanda hoteleira.
 *
 * @param params - Cidade e janela de datas
 * @param params.city - Cidade de destino
 * @param params.from - Inicio da janela
 * @param params.to - Fim da janela
 * @returns Os eventos do periodo e o impacto esperado
 */
export function destinationEvents(params: { city: string; from: string; to: string }) {
  const key = params.city.toLowerCase();
  const events = EVENTS[key] ?? [
    {
      name: `${params.city} Seasonal Fair`,
      expectedAttendance: Math.round(pseudoRange(`${key}:event`, 3000, 40000)),
    },
  ];
  const totalAttendance = events.reduce((sum, event) => sum + event.expectedAttendance, 0);

  return {
    city: params.city,
    window: { from: params.from, to: params.to },
    events,
    hotelDemandImpact: totalAttendance > 60000 ? "HIGH" : totalAttendance > 20000 ? "MEDIUM" : "LOW",
  };
}
