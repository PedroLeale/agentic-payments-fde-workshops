import { atomicToUsd } from "@travel-x402/shared";

/** Uma transferencia liquidada pelo facilitator. */
export type LedgerTransfer = {
  transaction: string;
  from: string;
  to: string;
  value: string;
  resource?: string;
  at: string;
};

/**
 * Ledger de USDC em memoria.
 *
 * Substitui a liquidacao on-chain: nada aqui toca a blockchain. O que continua
 * real e a etapa anterior - a autorizacao EIP-3009 assinada pelo comprador, que
 * o facilitator valida criptograficamente antes de mover qualquer saldo.
 */
export class Ledger {
  private readonly balances = new Map<string, bigint>();
  private readonly usedNonces = new Set<string>();
  private readonly transfers: LedgerTransfer[] = [];

  /**
   * Credita saldo em uma conta (usado para financiar a carteira do agente).
   *
   * @param address - Endereco da conta
   * @param amount - Valor em unidades atomicas
   */
  credit(address: string, amount: bigint): void {
    const key = address.toLowerCase();
    this.balances.set(key, (this.balances.get(key) ?? 0n) + amount);
  }

  /**
   * Saldo atual de uma conta.
   *
   * @param address - Endereco da conta
   * @returns O saldo em unidades atomicas
   */
  balanceOf(address: string): bigint {
    return this.balances.get(address.toLowerCase()) ?? 0n;
  }

  /**
   * Indica se um nonce de autorizacao ja foi consumido (protecao a replay).
   *
   * @param nonce - Nonce da autorizacao EIP-3009
   * @returns true se o nonce ja foi usado
   */
  isNonceUsed(nonce: string): boolean {
    return this.usedNonces.has(nonce.toLowerCase());
  }

  /**
   * Consome o nonce e move o saldo entre as contas.
   *
   * @param params - Dados da transferencia
   * @param params.from - Pagador
   * @param params.to - Recebedor
   * @param params.value - Valor em unidades atomicas
   * @param params.nonce - Nonce da autorizacao, consumido aqui
   * @param params.transaction - Identificador sintetico da liquidacao
   * @param params.resource - URL do recurso pago, quando informada
   */
  settle(params: {
    from: string;
    to: string;
    value: bigint;
    nonce: string;
    transaction: string;
    resource?: string;
  }): void {
    const { from, to, value, nonce, transaction, resource } = params;

    if (this.isNonceUsed(nonce)) {
      throw new Error(`Nonce ja utilizado: ${nonce}`);
    }

    if (this.balanceOf(from) < value) {
      throw new Error(`Saldo insuficiente em ${from}`);
    }

    this.usedNonces.add(nonce.toLowerCase());
    this.balances.set(from.toLowerCase(), this.balanceOf(from) - value);
    this.credit(to, value);
    this.transfers.push({
      transaction,
      from,
      to,
      value: value.toString(),
      resource,
      at: new Date().toISOString(),
    });
  }

  /**
   * Retorna um retrato legivel do ledger, para o endpoint de inspecao.
   *
   * @returns Saldos e transferencias com os valores tambem em dolares
   */
  snapshot() {
    return {
      balances: Object.fromEntries(
        [...this.balances.entries()].map(([address, amount]) => [
          address,
          { atomic: amount.toString(), usd: atomicToUsd(amount) },
        ]),
      ),
      transfers: this.transfers.map((transfer) => ({
        ...transfer,
        usd: atomicToUsd(transfer.value),
      })),
    };
  }
}
