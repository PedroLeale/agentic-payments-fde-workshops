import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { PremiumApi } from "@travel-x402/shared";
import { atomicToUsd } from "@travel-x402/shared";
import { config } from "./config.js";
import { wallet } from "./wallet.js";
import type { BudgetPolicy } from "./budget.js";
import type { RunEventSink } from "./events.js";
import { explorerTx } from "./chain.js";

/** Condicoes de pagamento anunciadas por um recurso premium. */
export type Quote = {
  apiId: string;
  provider: string;
  priceUsd: number;
  network: string;
  asset: string;
  payTo: string;
  description?: string;
  maxTimeoutSeconds: number;
};

/** Resultado de uma compra concluida. */
export type Purchase = {
  apiId: string;
  provider: string;
  priceUsd: number;
  transaction: string;
  data: unknown;
};

/** Compra recusada antes de qualquer pagamento. */
export type PurchaseRefusal = { refused: true; reason: string; priceUsd: number };

/**
 * Monta a URL de um recurso premium com os parametros da consulta.
 *
 * @param api - API do catalogo
 * @param params - Parametros de query
 * @returns A URL completa
 */
function buildUrl(api: PremiumApi, params: Record<string, string | number>): string {
  const url = new URL(api.path, config.sellersBaseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

/**
 * Cliente x402 do agente.
 *
 * Separa deliberadamente as duas metades do fluxo que o middleware costuma
 * esconder: {@link PremiumApiClient.quote} para de proposito no 402 e devolve o
 * preco, e {@link PremiumApiClient.purchase} e quem assina e paga. E nesse
 * intervalo que a decisao "vale a pena?" acontece.
 */
export class PremiumApiClient {
  private readonly paidFetch: ReturnType<typeof wrapFetchWithPayment>;

  constructor(
    private readonly budget: BudgetPolicy,
    private readonly onEvent: RunEventSink = () => {},
  ) {
    const client = x402Client.fromConfig({
      schemes: [{ network: "eip155:*", client: new ExactEvmScheme(wallet) }],
      // Teto por pagamento como rede de seguranca: mesmo que a politica de
      // orcamento falhe, nenhuma cobranca isolada pode estourar o budget total.
      spendControls: { maxAmountPerPayment: `$${budget.totalBudgetUsd}` },
    });

    this.paidFetch = wrapFetchWithPayment(fetch, client);
  }

  /**
   * Consulta o preco de um recurso premium sem pagar.
   *
   * Faz a requisicao sem cabecalho de pagamento e le o `PAYMENT-REQUIRED`
   * devolvido junto do 402 - exatamente o passo "descobrir quanto custa" do
   * fluxo x402.
   *
   * @param api - API do catalogo
   * @param params - Parametros de query
   * @returns As condicoes de pagamento anunciadas pelo provider
   */
  async quote(api: PremiumApi, params: Record<string, string | number>): Promise<Quote> {
    const response = await fetch(buildUrl(api, params));

    if (response.status !== 402) {
      throw new Error(
        `Esperava 402 Payment Required de ${api.path}, veio HTTP ${response.status}`,
      );
    }

    const header = response.headers.get("PAYMENT-REQUIRED");

    if (!header) {
      throw new Error(`Resposta 402 de ${api.path} sem o cabecalho PAYMENT-REQUIRED`);
    }

    const paymentRequired = decodePaymentRequiredHeader(header);
    const requirements = paymentRequired.accepts[0];

    if (!requirements) {
      throw new Error(`Resposta 402 de ${api.path} sem condicoes de pagamento`);
    }

    const quote: Quote = {
      apiId: api.id,
      provider: api.provider,
      priceUsd: atomicToUsd(requirements.amount),
      network: requirements.network,
      asset: requirements.asset,
      payTo: requirements.payTo,
      description: paymentRequired.resource?.description,
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    };

    this.onEvent({
      type: "quote",
      apiId: quote.apiId,
      provider: quote.provider,
      priceUsd: quote.priceUsd,
      network: quote.network,
      payTo: quote.payTo,
      fitsBudget: this.budget.evaluate(quote.priceUsd).allowed,
    });

    return quote;
  }

  /**
   * Paga e consome um recurso premium.
   *
   * Confere o orcamento antes de assinar qualquer coisa; se couber, o
   * `wrapFetchWithPayment` repete a requisicao com a autorizacao EIP-3009
   * assinada e devolve os dados junto do recibo da liquidacao.
   *
   * @param api - API do catalogo
   * @param params - Parametros de query
   * @param justification - Por que o agente decidiu que vale a pena pagar
   * @returns A compra concluida, ou a recusa por orcamento
   */
  async purchase(
    api: PremiumApi,
    params: Record<string, string | number>,
    justification: string,
  ): Promise<Purchase | PurchaseRefusal> {
    // Uma compra bate no recurso mais de uma vez: aqui, para saber o preco antes
    // de comprometer o orcamento, e de novo dentro do `paidFetch`, que tambem
    // comeca sem pagamento e so assina depois de receber o 402. E o preco de
    // deixar a decisao explicita - um cliente que so quer os dados chamaria
    // apenas o `paidFetch`.
    const quote = await this.quote(api, params);
    const decision = this.budget.reserve(quote.priceUsd);

    if (!decision.allowed) {
      this.onEvent({
        type: "refusal",
        apiId: api.id,
        provider: api.provider,
        priceUsd: quote.priceUsd,
        reason: decision.reason,
      });

      return { refused: true, reason: decision.reason, priceUsd: quote.priceUsd };
    }

    try {
      const response = await this.paidFetch(buildUrl(api, params));

      if (!response.ok) {
        throw new Error(`Pagamento de ${api.path} falhou: HTTP ${response.status}`);
      }

      const receiptHeader = response.headers.get("PAYMENT-RESPONSE");
      const receipt = receiptHeader ? decodePaymentResponseHeader(receiptHeader) : undefined;
      const data = await response.json();
      const transaction = receipt?.transaction ?? "(sem recibo)";

      this.budget.commit({
        apiId: api.id,
        provider: api.provider,
        priceUsd: quote.priceUsd,
        transaction,
        network: quote.network as `${string}:${string}`,
        justification,
        at: new Date().toISOString(),
      });

      this.onEvent({
        type: "purchase",
        apiId: api.id,
        provider: api.provider,
        priceUsd: quote.priceUsd,
        transaction,
        explorerUrl: explorerTx(transaction),
        justification,
      });
      this.onEvent({
        type: "budget",
        totalUsd: this.budget.totalBudgetUsd,
        spentUsd: this.budget.spentUsd,
        remainingUsd: this.budget.remainingUsd,
      });

      return {
        apiId: api.id,
        provider: api.provider,
        priceUsd: quote.priceUsd,
        transaction,
        data,
      };
    } catch (error) {
      // O pagamento nao se concretizou: devolve a reserva ao orcamento.
      this.budget.release(quote.priceUsd);
      throw error;
    }
  }
}
