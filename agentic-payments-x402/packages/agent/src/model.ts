import { BedrockModel } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { Model } from "@strands-agents/sdk";
import { config } from "./config.js";
import { staleEnvWarning } from "./env-freshness.js";

/**
 * Cria o provider de modelo configurado no `.env`.
 *
 * O Strands trata o modelo como uma peca substituivel: as tools, o loop de
 * decisao e a politica de orcamento nao mudam quando se troca Ollama por
 * Bedrock. O padrao e Ollama para manter o workshop rodando sem conta AWS.
 *
 * @returns O modelo pronto para ser usado pelo agente
 */
export function createModel(): Model {
  switch (config.model.provider) {
    case "bedrock":
      return new BedrockModel({
        modelId: config.model.bedrockModelId,
        region: config.model.awsRegion,
        temperature: 0.2,
      });

    case "openai":
      return new OpenAIModel({
        api: "chat",
        modelId: config.model.openaiModel,
        temperature: 0.2,
      });

    case "ollama":
      // O Ollama expoe uma API compativel com a da OpenAI em /v1, entao o mesmo
      // provider serve para os dois. A apiKey e ignorada pelo Ollama.
      // temperatura 0.6 / top_p 0.95 e a amostragem recomendada pelo Qwen3 em
      // modo thinking; temperatura 0 leva o modelo a repeticoes degeneradas.
      return new OpenAIModel({
        api: "chat",
        modelId: config.model.ollamaModel,
        apiKey: "ollama",
        clientConfig: { baseURL: config.model.ollamaBaseUrl },
        temperature: 0.6,
        topP: 0.95,
      });
  }
}

/**
 * Traduz falhas conhecidas de provider para uma mensagem acionavel.
 *
 * O erro cru do SDK da AWS ("Could not load credentials from any providers")
 * nao diz o que fazer, e e a primeira parede de quem troca para Bedrock.
 *
 * @param error - Erro capturado durante a execucao
 * @returns A mensagem a exibir
 */
export function explainModelError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const stale = staleEnvWarning();

  if (stale) {
    return `${message}\n\n${stale}`;
  }

  if (config.model.provider === "bedrock" && /credential/i.test(message)) {
    const profile = config.model.awsProfile || "<seu-perfil>";

    return [
      `${message}`,
      "",
      "MODEL_PROVIDER=bedrock exige credenciais AWS validas. Ou faca login SSO:",
      `  aws sso login --profile ${profile}`,
      "e defina AWS_PROFILE no .env; ou coloque AWS_ACCESS_KEY_ID,",
      "AWS_SECRET_ACCESS_KEY e AWS_SESSION_TOKEN no .env.",
      "",
      "Em qualquer caso, reinicie o `npm run dev` depois de mexer no .env.",
      "Atencao: o dotenvx nao sobrescreve variaveis ja exportadas no seu shell -",
      "se houver um AWS_ACCESS_KEY_ID vencido exportado, ele vence o do .env.",
    ].join("\n");
  }

  if (config.model.provider === "ollama" && /ECONNREFUSED|fetch failed/i.test(message)) {
    return `${message}\n\nO Ollama nao respondeu em ${config.model.ollamaBaseUrl}. Rode \`ollama serve\`.`;
  }

  return message;
}

/**
 * Descreve o modelo ativo, para o cabecalho da execucao.
 *
 * @returns Uma linha com provider e modelo
 */
export function describeModel(): string {
  switch (config.model.provider) {
    case "bedrock": {
      const profile = config.model.awsProfile ? ` perfil ${config.model.awsProfile}` : "";
      return `bedrock / ${config.model.bedrockModelId} (${config.model.awsRegion}${profile})`;
    }
    case "openai":
      return `openai / ${config.model.openaiModel}`;
    case "ollama":
      return `ollama / ${config.model.ollamaModel} (${config.model.ollamaBaseUrl})`;
  }
}
