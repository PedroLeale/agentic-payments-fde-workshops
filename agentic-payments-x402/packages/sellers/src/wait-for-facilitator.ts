/**
 * Aguarda o facilitator responder antes de montar o middleware de pagamento.
 *
 * O `x402ResourceServer` consulta `/supported` uma unica vez na inicializacao
 * para saber quais combinacoes de scheme e rede consegue cobrar. Se essa
 * chamada falhar, toda rota premium passa a responder 500 - o que acontece com
 * facilidade quando facilitator e marketplace sobem em paralelo.
 *
 * @param url - URL base do facilitator
 * @param timeoutMs - Tempo maximo de espera
 */
export async function waitForFacilitator(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/supported`, { signal: AbortSignal.timeout(3_000) });

      if (response.ok) {
        return;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Facilitator ${url} nao respondeu em ${timeoutMs}ms: ${lastError}`);
}
