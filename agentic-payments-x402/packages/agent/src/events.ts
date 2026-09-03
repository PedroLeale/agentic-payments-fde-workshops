/**
 * Eventos publicados durante uma execucao do agente.
 *
 * Sao o contrato entre o backend e a interface: o servidor SSE serializa cada
 * um deles como uma mensagem `data:`. O frontend tem uma copia destes tipos em
 * `packages/web/src/types.ts` - a interface nao importa nada do agente, que
 * carrega viem e o SDK do Strands.
 */
export type RunEvent =
  /** Inicio da execucao: contexto que a interface mostra no cabecalho. */
  | {
      type: "start";
      goal: string;
      priorities: string[];
      budgetUsd: number;
      walletAddress: string;
      walletBalanceUsd: number;
      network: string;
      facilitatorMode: "local" | "testnet";
      model: string;
    }
  /** O agente decidiu chamar uma tool. */
  | { type: "tool"; id: string; name: string; input: unknown; paid: boolean }
  /** A tool respondeu. */
  | { type: "tool-result"; id: string; name: string; ok: boolean; output: unknown }
  /** Um recurso premium respondeu 402 e revelou o preco - nada foi pago ainda. */
  | {
      type: "quote";
      apiId: string;
      provider: string;
      priceUsd: number;
      network: string;
      payTo: string;
      fitsBudget: boolean;
    }
  /** Pagamento liquidado: a informacao foi comprada. */
  | {
      type: "purchase";
      apiId: string;
      provider: string;
      priceUsd: number;
      transaction: string;
      explorerUrl: string | null;
      justification: string;
    }
  /** A politica de orcamento recusou a compra antes de assinar qualquer coisa. */
  | { type: "refusal"; apiId: string; provider: string; priceUsd: number; reason: string }
  /** Estado do orcamento apos cada movimento. */
  | { type: "budget"; totalUsd: number; spentUsd: number; remainingUsd: number }
  /** Pedaco de texto da resposta do modelo. */
  | { type: "text"; delta: string }
  /** Fim da execucao. */
  | { type: "done"; recommendation: string; walletBalanceUsd: number }
  /** Falha em qualquer ponto. */
  | { type: "error"; message: string };

/** Destino dos eventos de uma execucao. */
export type RunEventSink = (event: RunEvent) => void;
