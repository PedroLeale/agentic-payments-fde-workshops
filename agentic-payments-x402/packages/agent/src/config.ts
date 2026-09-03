import { DEFAULT_NETWORK } from "@travel-x402/shared";
import type { Network } from "@travel-x402/shared";

/**
 * Le uma variavel de ambiente obrigatoria.
 *
 * @param name - Nome da variavel
 * @returns O valor da variavel
 */
function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variavel de ambiente ${name} nao definida. Copie .env.example para .env.`);
  }

  return value;
}

const facilitatorMode = process.env.FACILITATOR_MODE === "testnet" ? "testnet" : "local";

/** Providers de modelo suportados. */
const MODEL_PROVIDERS = ["ollama", "bedrock", "openai"] as const;

type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/**
 * Le e valida `MODEL_PROVIDER`.
 *
 * Um valor desconhecido interrompe a execucao em vez de cair no provider
 * padrao: um `Bedrock` com maiuscula ou um espaco sobrando viraria uma execucao
 * silenciosamente local, e a unica pista seria o cabecalho da interface.
 *
 * @returns O provider configurado
 */
function readModelProvider(): ModelProvider {
  const raw = (process.env.MODEL_PROVIDER ?? "ollama").trim().toLowerCase();

  if ((MODEL_PROVIDERS as readonly string[]).includes(raw)) {
    return raw as ModelProvider;
  }

  throw new Error(
    `MODEL_PROVIDER invalido: ${JSON.stringify(process.env.MODEL_PROVIDER)}. ` +
      `Use um de: ${MODEL_PROVIDERS.join(", ")}.`,
  );
}

export const config = {
  /** Chave privada da carteira do agente, carregada do .env via dotenvx. */
  privateKey: required("AGENT_PRIVATE_KEY") as `0x${string}`,
  /** Orcamento total de inteligencia premium, em dolares. */
  premiumBudgetUsd: Number(process.env.PREMIUM_BUDGET_USD ?? "0.20"),
  /**
   * Prioridades do viajante, em ordem de importancia. Entram no pedido junto do
   * objetivo e do orcamento, como descrito na secao 4 do documento: o agente
   * decide o que investigar a partir delas.
   */
  travelerPriorities: (
    process.env.TRAVELER_PRIORITIES ??
    "evitar conexoes arriscadas,minimizar preco,evitar grande chance de atraso"
  )
    .split(",")
    .map((priority) => priority.trim())
    .filter(Boolean),
  network: (process.env.X402_NETWORK ?? DEFAULT_NETWORK) as Network,
  facilitatorMode,
  facilitatorUrl:
    facilitatorMode === "testnet"
      ? (process.env.TESTNET_FACILITATOR_URL ?? "https://x402.org/facilitator")
      : (process.env.FACILITATOR_URL ?? "http://localhost:4020"),
  sellersBaseUrl: process.env.SELLERS_BASE_URL ?? "http://localhost:4021",
  /** RPC usado apenas para leitura (saldo on-chain) no modo testnet. */
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
  /**
   * Explorer usado para montar os links das liquidacoes. Deixe vazio para
   * desligar os links e mostrar apenas o hash.
   */
  explorerUrl: (process.env.EXPLORER_BASE_URL ?? "https://sepolia.basescan.org")
    .trim()
    .replace(/\/+$/, ""),
  /**
   * Faucet publico usado para financiar a carteira com USDC de testnet.
   * Opcional: sem ele a interface simplesmente nao mostra o link.
   */
  faucetUrl: (process.env.FAUCET_URL ?? "").trim(),
  model: {
    provider: readModelProvider(),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
    ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3:1.7b",
    bedrockModelId: process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-sonnet-4-6",
    awsRegion: process.env.AWS_REGION ?? "us-east-1",
    awsProfile: process.env.AWS_PROFILE ?? "",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.4",
  },
} as const;
