/**
 * Copia do contrato de eventos publicado pelo agente
 * (`packages/agent/src/events.ts`).
 *
 * A interface nao importa do pacote do agente de proposito: ele carrega o SDK
 * do Strands e o viem, que nao tem por que ir para o bundle do navegador.
 */
export type RunEvent =
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
  | { type: "tool"; id: string; name: string; input: unknown; paid: boolean }
  | { type: "tool-result"; id: string; name: string; ok: boolean; output: unknown }
  | {
      type: "quote";
      apiId: string;
      provider: string;
      priceUsd: number;
      network: string;
      payTo: string;
      fitsBudget: boolean;
    }
  | {
      type: "purchase";
      apiId: string;
      provider: string;
      priceUsd: number;
      transaction: string;
      explorerUrl: string | null;
      justification: string;
    }
  | { type: "refusal"; apiId: string; provider: string; priceUsd: number; reason: string }
  | { type: "budget"; totalUsd: number; spentUsd: number; remainingUsd: number }
  | { type: "text"; delta: string }
  | { type: "done"; recommendation: string; walletBalanceUsd: number }
  | { type: "error"; message: string };

/** Nomes de evento que o servidor SSE publica. */
export const RUN_EVENT_TYPES = [
  "start",
  "tool",
  "tool-result",
  "quote",
  "purchase",
  "refusal",
  "budget",
  "text",
  "done",
  "error",
] as const;

/** Contexto da aplicacao, lido antes de qualquer execucao. */
export type AppConfig = {
  /** Aviso quando o .env mudou depois que o servidor subiu. */
  staleEnv: string | null;
  walletAddress: string;
  network: string;
  facilitatorMode: "local" | "testnet";
  facilitatorUrl: string;
  budgetUsd: number;
  priorities: string[];
  model: string;
  hasExplorer: boolean;
  /** Link do explorer para a carteira do agente, quando o explorer se aplica. */
  walletExplorerUrl: string | null;
  /** Saldo da carteira, ou null quando a leitura falhou. */
  walletBalanceUsd: number | null;
  /** Faucet de USDC de testnet, quando configurado no .env. */
  faucetUrl: string | null;
  catalog: { id: string; provider: string; priceUsd: number; capability: string }[];
};

/** Estado da conexao SSE. */
export type RunStatus = "idle" | "running" | "done" | "error";
