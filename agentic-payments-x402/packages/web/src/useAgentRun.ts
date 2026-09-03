import { useCallback, useRef, useState } from "react";
import { RUN_EVENT_TYPES, type RunEvent, type RunStatus } from "./types";

/** Uma compra concluida, acumulada a partir dos eventos. */
export type Purchase = Extract<RunEvent, { type: "purchase" }>;

/** Estado do orcamento durante a execucao. */
export type Budget = Extract<RunEvent, { type: "budget" }>;

/** Contexto publicado no inicio da execucao. */
export type RunStart = Extract<RunEvent, { type: "start" }>;

/**
 * Assina o stream SSE de uma execucao e acumula o estado que a tela mostra.
 *
 * O servidor publica eventos nomeados (`event: purchase`), entao registramos um
 * listener por tipo - `onmessage` so dispara para eventos sem nome.
 */
export function useAgentRun() {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [start, setStart] = useState<RunStart | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [recommendation, setRecommendation] = useState("");
  // O saldo e lido no inicio e no fim da execucao: durante o percurso o valor
  // exibido continua sendo o da ultima leitura, nunca uma estimativa.
  const [walletBalanceUsd, setWalletBalanceUsd] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const run = useCallback(
    (url: string) => {
      stop();
      setStatus("running");
      setEvents([]);
      setStart(null);
      setBudget(null);
      setPurchases([]);
      setRecommendation("");
      setError(null);

      const source = new EventSource(url);
      sourceRef.current = source;

      for (const type of RUN_EVENT_TYPES) {
        source.addEventListener(type, (message) => {
          const event = JSON.parse((message as MessageEvent<string>).data) as RunEvent;
          setEvents((current) => [...current, event]);

          switch (event.type) {
            case "start":
              setStart(event);
              setWalletBalanceUsd(event.walletBalanceUsd);
              break;
            case "budget":
              setBudget(event);
              break;
            case "purchase":
              setPurchases((current) => [...current, event]);
              break;
            case "text":
              setRecommendation((current) => current + event.delta);
              break;
            case "done":
              setWalletBalanceUsd(event.walletBalanceUsd);
              setStatus("done");
              stop();
              break;
            case "error":
              setError(event.message);
              setStatus("error");
              stop();
              break;
            default:
              break;
          }
        });
      }

      // O servidor fecha a conexao ao terminar; sem isso o EventSource tentaria
      // reconectar sozinho e comecaria uma nova execucao.
      source.onerror = () => {
        stop();
        setStatus((current) => (current === "running" ? "done" : current));
      };
    },
    [stop],
  );

  return {
    status,
    events,
    start,
    budget,
    purchases,
    recommendation,
    walletBalanceUsd,
    error,
    run,
    stop,
  };
}
