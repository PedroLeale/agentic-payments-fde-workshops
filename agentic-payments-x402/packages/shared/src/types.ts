/** Identificador de rede no formato CAIP-2, por exemplo `eip155:84532`. */
export type Network = `${string}:${string}`;

/** Uma API premium publicada no marketplace. */
export type PremiumApi = {
  /** Identificador curto usado pelo agente nas tool calls. */
  id: string;
  /** Nome comercial do provider. */
  provider: string;
  /** Rota HTTP exposta pelo seller. */
  path: string;
  /** Preco por request, em dolares, no formato aceito pelo x402 (`"$0.03"`). */
  price: `$${string}`;
  /** Carteira que recebe o pagamento desta API. */
  payTo: `0x${string}`;
  /** O que a API entrega. */
  capability: string;
  /** Quando vale a pena comprar - vai no catalogo apresentado ao agente. */
  whenToUse: string;
  /** Parametros de query aceitos pela rota. */
  params: string[];
};

/** Registro de uma compra concluida via x402. */
export type PurchaseRecord = {
  apiId: string;
  provider: string;
  priceUsd: number;
  transaction: string;
  network: Network;
  justification: string;
  at: string;
};
