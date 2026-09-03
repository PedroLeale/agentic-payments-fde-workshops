import type { PurchaseRecord } from "@travel-x402/shared";

/** Resultado da avaliacao de uma compra contra o orcamento. */
export type BudgetDecision =
  | { allowed: true; remainingAfter: number }
  | { allowed: false; reason: string };

/**
 * Politica de orcamento do agente.
 *
 * O objetivo nao e gastar todo o budget: e tomar a melhor decisao possivel
 * dentro dele. Por isso o controle vive no codigo e nao so no prompt - o modelo
 * pode se enganar sobre quanto ja gastou, a politica nao.
 *
 * O valor sai do orcamento no momento da reserva, nao no momento em que a
 * compra termina. Sem isso, duas tool calls emitidas no mesmo turno poderiam
 * passar pela verificacao antes de qualquer uma debitar, e juntas estourar o
 * orcamento.
 */
export class BudgetPolicy {
  private committed = 0;
  private reserved = 0;
  private readonly purchases: PurchaseRecord[] = [];

  constructor(private readonly totalUsd: number) {}

  /** Quanto ja foi efetivamente gasto em inteligencia premium. */
  get spentUsd(): number {
    return Number(this.committed.toFixed(6));
  }

  /** Quanto ainda resta, ja descontando as compras em andamento. */
  get remainingUsd(): number {
    return Number((this.totalUsd - this.committed - this.reserved).toFixed(6));
  }

  /** Orcamento total autorizado pelo usuario. */
  get totalBudgetUsd(): number {
    return this.totalUsd;
  }

  /** Compras concluidas, na ordem em que aconteceram. */
  get history(): readonly PurchaseRecord[] {
    return this.purchases;
  }

  /**
   * Verifica se uma compra caberia no orcamento, sem reservar nada.
   *
   * @param priceUsd - Preco cobrado pela API
   * @returns A decisao e, quando negada, o motivo
   */
  evaluate(priceUsd: number): BudgetDecision {
    if (priceUsd > this.remainingUsd) {
      return {
        allowed: false,
        reason:
          `A consulta custa $${priceUsd.toFixed(2)} e restam apenas ` +
          `$${this.remainingUsd.toFixed(2)} do orcamento de inteligencia premium.`,
      };
    }

    return { allowed: true, remainingAfter: Number((this.remainingUsd - priceUsd).toFixed(6)) };
  }

  /**
   * Reserva o valor antes de assinar a autorizacao de pagamento.
   *
   * Toda reserva aceita precisa terminar em {@link BudgetPolicy.commit} ou
   * {@link BudgetPolicy.release}.
   *
   * @param priceUsd - Preco cobrado pela API
   * @returns A decisao e, quando negada, o motivo
   */
  reserve(priceUsd: number): BudgetDecision {
    const decision = this.evaluate(priceUsd);

    if (decision.allowed) {
      this.reserved += priceUsd;
    }

    return decision;
  }

  /**
   * Confirma uma reserva: a compra foi liquidada.
   *
   * @param purchase - Dados da compra concluida
   */
  commit(purchase: PurchaseRecord): void {
    this.reserved = Math.max(0, this.reserved - purchase.priceUsd);
    this.committed += purchase.priceUsd;
    this.purchases.push(purchase);
  }

  /**
   * Devolve uma reserva que nao virou compra.
   *
   * @param priceUsd - Valor reservado
   */
  release(priceUsd: number): void {
    this.reserved = Math.max(0, this.reserved - priceUsd);
  }
}
