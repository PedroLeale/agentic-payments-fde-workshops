import express from "express";
import type { Response } from "express";
import { PREMIUM_APIS } from "@travel-x402/shared";
import { config } from "./config.js";
import { describeModel, explainModelError } from "./model.js";
import { runAgent } from "./run.js";
import { runDemo } from "./demo-run.js";
import type { RunEvent } from "./events.js";
import { explorerAddress, hasExplorer } from "./chain.js";
import { staleEnvWarning } from "./env-freshness.js";
import { wallet, walletBalance } from "./wallet.js";

const PORT = Number(process.env.AGENT_PORT ?? 4022);

const app = express();
app.use(express.json());

// A interface roda no dev server do Vite, em outra porta.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.WEB_ORIGIN ?? "*");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "travel-agent", staleEnv: staleEnvWarning() });
});

/**
 * Saldo da carteira, sem derrubar o resto do contexto quando a leitura falha.
 *
 * No modo testnet isso e uma chamada de RPC e no local uma chamada ao ledger do
 * facilitator: as duas podem estar fora do ar enquanto a interface ja subiu. O
 * saldo e um dado a mais na tela, entao um null vale mais que um 500 que
 * esconderia a rede, o modelo e o catalogo.
 *
 * @returns O saldo em dolares, ou null quando nao deu para ler
 */
async function safeWalletBalance(): Promise<number | null> {
  try {
    return await walletBalance();
  } catch {
    return null;
  }
}

/** Contexto que a interface mostra antes de qualquer execucao. */
app.get("/api/config", async (_req, res) => {
  res.json({
    staleEnv: staleEnvWarning(),
    walletAddress: wallet.address,
    network: config.network,
    facilitatorMode: config.facilitatorMode,
    facilitatorUrl: config.facilitatorUrl,
    budgetUsd: config.premiumBudgetUsd,
    priorities: config.travelerPriorities,
    model: describeModel(),
    hasExplorer: hasExplorer(),
    walletExplorerUrl: explorerAddress(wallet.address),
    walletBalanceUsd: await safeWalletBalance(),
    faucetUrl: config.faucetUrl || null,
    catalog: PREMIUM_APIS.map((api) => ({
      id: api.id,
      provider: api.provider,
      priceUsd: Number(api.price.replace("$", "")),
      capability: api.capability,
    })),
  });
});

/**
 * Envia um evento no formato SSE.
 *
 * @param res - Resposta HTTP mantida aberta
 * @param event - Evento a publicar
 */
function send(res: Response, event: RunEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Executa o agente e transmite cada passo por Server-Sent Events.
 *
 * SSE cai bem aqui porque o fluxo e de mao unica e so dura o tempo da
 * execucao: o navegador abre um `EventSource`, recebe a linha do tempo
 * conforme ela acontece e a conexao fecha no fim.
 */
app.get("/api/run", async (req, res) => {
  const goal = typeof req.query.goal === "string" ? req.query.goal.trim() : "";

  if (!goal) {
    res.status(400).json({ error: "informe `goal`" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Se o usuario fechar a aba no meio, para de escrever em um socket morto.
  let open = true;
  req.on("close", () => {
    open = false;
  });

  try {
    await runAgent(goal, (event) => {
      if (open) {
        send(res, event);
      }
    });
  } catch (error) {
    if (open) {
      send(res, { type: "error", message: explainModelError(error) });
    }
  } finally {
    res.end();
  }
});

/**
 * Transmite o roteiro deterministico pelo mesmo canal SSE.
 *
 * Mesmos eventos, mesmas compras reais - so as decisoes e que vem do codigo em
 * vez do modelo. Garante que a demo mostre o fluxo inteiro em qualquer maquina.
 */
app.get("/api/demo", async (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let open = true;
  res.on("close", () => {
    open = false;
  });

  try {
    await runDemo((event) => {
      if (open) {
        send(res, event);
      }
    });
  } catch (error) {
    if (open) {
      send(res, { type: "error", message: explainModelError(error) });
    }
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Agente ouvindo em http://localhost:${PORT}`);
  console.log(`  SSE       GET /api/run?goal=...`);
  console.log(`  SSE       GET /api/demo`);
  console.log(`  contexto  GET /api/config`);
  console.log(`  modelo    ${describeModel()}`);
});
