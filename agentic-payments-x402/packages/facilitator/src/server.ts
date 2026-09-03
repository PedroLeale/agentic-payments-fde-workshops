import express from "express";
import { getAddress } from "viem";
import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { DEFAULT_NETWORK, USDC, atomicToUsd, usdToAtomic } from "@travel-x402/shared";
import { Ledger } from "./ledger.js";
import { LocalLedgerExactEvmScheme } from "./local-exact-evm.js";

const PORT = Number(process.env.FACILITATOR_PORT ?? 4020);
const NETWORK = (process.env.X402_NETWORK ?? DEFAULT_NETWORK) as typeof DEFAULT_NETWORK;
const INITIAL_BALANCE = usdToAtomic(process.env.FACILITATOR_INITIAL_BALANCE_USD ?? "10");

const ledger = new Ledger();

/**
 * O `x402Facilitator` do `@x402/core` e o mesmo usado por um facilitator de
 * producao. O que trocamos e a implementacao do scheme registrado nele.
 */
const facilitator = new x402Facilitator().register(
  NETWORK,
  new LocalLedgerExactEvmScheme(ledger),
);

const funded = new Set<string>();
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "x402-local-facilitator", network: NETWORK });
});

/** Anuncia quais combinacoes de scheme/rede este facilitator sabe liquidar. */
app.get("/supported", (_req, res) => {
  res.json(facilitator.getSupported());
});

/**
 * Extrai o par payload/requirements do corpo da requisicao.
 *
 * @param body - Corpo recebido
 * @returns O par, ou null quando o corpo nao tem o formato esperado
 */
function readPaymentBody(
  body: unknown,
): { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements } | null {
  const { paymentPayload, paymentRequirements } = (body ?? {}) as {
    paymentPayload?: PaymentPayload;
    paymentRequirements?: PaymentRequirements;
  };

  if (!paymentPayload || !paymentRequirements) {
    return null;
  }

  return { paymentPayload, paymentRequirements };
}

/** Valida a autorizacao assinada, sem mover saldo. */
app.post("/verify", async (req, res) => {
  const body = readPaymentBody(req.body);

  if (!body) {
    res.status(400).json({ isValid: false, invalidReason: "invalid_request" });
    return;
  }

  const { paymentPayload, paymentRequirements } = body;
  const result = await facilitator.verify(paymentPayload, paymentRequirements);
  console.log(
    `[verify] ${result.isValid ? "ok" : `recusado (${result.invalidReason})`}` +
      ` recurso=${paymentPayload?.resource?.url ?? "-"}`,
  );
  res.json(result);
});

/** Reverifica e liquida o pagamento no ledger em memoria. */
app.post("/settle", async (req, res) => {
  const body = readPaymentBody(req.body);

  if (!body) {
    res
      .status(400)
      .json({ success: false, errorReason: "invalid_request", transaction: "", network: NETWORK });
    return;
  }

  const { paymentPayload, paymentRequirements } = body;
  const result = await facilitator.settle(paymentPayload, paymentRequirements);
  console.log(
    `[settle] ${result.success ? `ok tx=${result.transaction.slice(0, 12)}...` : `falhou (${result.errorReason})`}` +
      ` valor=${result.amount ? `$${atomicToUsd(result.amount).toFixed(3)}` : "-"}`,
  );
  res.json(result);
});

/**
 * Torneira de USDC de teste: credita o saldo inicial de uma carteira uma unica
 * vez. Substitui o faucet de testnet quando rodamos tudo em localhost.
 */
app.post("/faucet", (req, res) => {
  const { address } = req.body as { address?: string };

  if (!address) {
    res.status(400).json({ error: "informe `address`" });
    return;
  }

  const account = getAddress(address);

  if (!funded.has(account.toLowerCase())) {
    funded.add(account.toLowerCase());
    ledger.credit(account, BigInt(INITIAL_BALANCE));
    console.log(`[faucet] ${account} creditado com $${atomicToUsd(INITIAL_BALANCE).toFixed(2)}`);
  }

  res.json({
    address: account,
    balance: { atomic: ledger.balanceOf(account).toString(), usd: atomicToUsd(ledger.balanceOf(account)) },
  });
});

/** Estado do ledger: saldos e liquidacoes ja realizadas. */
app.get("/ledger", (_req, res) => {
  res.json({ network: NETWORK, asset: USDC.address, symbol: USDC.symbol, ...ledger.snapshot() });
});

app.listen(PORT, () => {
  console.log(`x402 facilitator local ouvindo em http://localhost:${PORT}`);
  console.log(`  rede    ${NETWORK}`);
  console.log(`  ativo   ${USDC.symbol} (${USDC.address})`);
  console.log(`  faucet  $${atomicToUsd(INITIAL_BALANCE).toFixed(2)} por carteira`);
});
