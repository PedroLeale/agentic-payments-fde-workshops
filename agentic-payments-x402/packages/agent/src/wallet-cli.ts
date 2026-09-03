import { formatUsd } from "@travel-x402/shared";
import { config } from "./config.js";
import { explorerAddress } from "./chain.js";
import { fundWallet, wallet } from "./wallet.js";

/**
 * Mostra o endereco e o saldo da carteira do agente.
 */
async function main(): Promise<void> {
  console.log(`endereco     ${wallet.address}`);
  console.log(`rede         ${config.network}`);
  console.log(`facilitator  ${config.facilitatorUrl} (modo ${config.facilitatorMode})`);

  const balance = await fundWallet();
  console.log(`saldo USDC   ${formatUsd(balance)}`);

  if (config.facilitatorMode === "testnet") {
    const link = explorerAddress(wallet.address);

    if (link) {
      console.log(`explorer     ${link}`);
    }

    if (balance === 0) {
      console.log("\nCarteira vazia. Pegue USDC de teste em https://faucet.circle.com");
      console.log("(selecione Base Sepolia). Nao e preciso ETH.");
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
