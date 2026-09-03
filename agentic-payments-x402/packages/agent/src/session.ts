/**
 * Estado da execucao usado para impor o funil descrito no workshop:
 * dados gratuitos primeiro, inteligencia premium depois.
 *
 * A regra vive aqui e nao apenas no prompt porque um modelo pode simplesmente
 * pular a etapa gratuita e comecar comprando - que e exatamente o comportamento
 * que a demo quer evitar.
 */
export class SessionState {
  private freeSearchDone = false;
  private readonly purchased = new Set<string>();

  /** Marca que o agente ja consultou uma fonte gratuita. */
  markFreeSearch(): void {
    this.freeSearchDone = true;
  }

  /** Indica se alguma busca gratuita ja foi feita. */
  get hasFreeSearch(): boolean {
    return this.freeSearchDone;
  }

  /**
   * Indica se uma consulta identica ja foi comprada nesta execucao.
   *
   * @param key - Chave da consulta (api + parametros)
   * @returns true quando a mesma informacao ja foi paga
   */
  alreadyPurchased(key: string): boolean {
    return this.purchased.has(key);
  }

  /**
   * Registra uma consulta comprada.
   *
   * @param key - Chave da consulta (api + parametros)
   */
  markPurchased(key: string): void {
    this.purchased.add(key);
  }
}
