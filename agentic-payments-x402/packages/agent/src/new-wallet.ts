import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Gera uma carteira nova e imprime a chave, para colar no `.env`.
 *
 * Nao le nenhuma configuracao de propósito: este e o comando que voce roda
 * justamente quando ainda nao tem uma chave valida. A chave publica do Anvil
 * que vem no `.env.example` serve para o ledger local, mas na Base Sepolia
 * qualquer pessoa poderia gastar o USDC dela.
 */
const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("Carteira nova gerada. Coloque no seu .env:\n");
console.log(`AGENT_PRIVATE_KEY=${privateKey}`);
console.log(`\nEndereco: ${account.address}`);
console.log("\nFinancie com USDC de teste da Base Sepolia em https://faucet.circle.com");
console.log("Nao e preciso ETH: o gas da liquidacao e pago pelo facilitator.");
