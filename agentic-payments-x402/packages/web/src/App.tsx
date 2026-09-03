import { useEffect, useRef, useState, type ComponentProps, type FormEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAgentRun } from "./useAgentRun";
import type { AppConfig, RunEvent } from "./types";

const DEFAULT_GOAL =
  "Planejar viagem de Sao Paulo (GRU) para Toquio (HND) entre 10 e 20 de outubro de 2026.";

/**
 * Formata um valor em dolares com precisao de centavos.
 *
 * @param usd - Valor em dolares
 * @returns O valor formatado
 */
function money(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

/**
 * Encurta um endereco ou hash para exibicao.
 *
 * @param value - Endereco ou hash completo
 * @returns A versao encurtada
 */
function short(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

/**
 * Uma entrada da linha do tempo.
 *
 * @param props - Propriedades do componente
 * @param props.event - Evento a renderizar
 * @returns O item da linha do tempo, ou null quando o evento nao e exibido
 */
function TimelineItem({ event }: { event: RunEvent }) {
  switch (event.type) {
    case "tool":
      return (
        <li className={`item item-tool ${event.paid ? "is-paid" : ""}`}>
          <span className="badge">{event.paid ? "PAGO" : "GRATIS"}</span>
          <div className="item-body">
            <strong>{event.name}</strong>
            <pre>{JSON.stringify(event.input)}</pre>
          </div>
        </li>
      );

    case "tool-result":
      return (
        <li className="item item-result">
          <span className="badge badge-muted">{event.ok ? "OK" : "ERRO"}</span>
          <div className="item-body">
            <pre className="truncate">{JSON.stringify(event.output)}</pre>
          </div>
        </li>
      );

    case "quote":
      return (
        <li className="item item-quote">
          <span className="badge badge-402">402</span>
          <div className="item-body">
            <strong>{event.provider}</strong> cobra <strong>{money(event.priceUsd)}</strong> por
            request
            <div className="meta">
              paga para {short(event.payTo)} em {event.network} ·{" "}
              {event.fitsBudget ? "cabe no orcamento" : "nao cabe no orcamento"}
            </div>
          </div>
        </li>
      );

    case "purchase":
      return (
        <li className="item item-purchase">
          <span className="badge badge-paid">{money(event.priceUsd)}</span>
          <div className="item-body">
            <strong>Comprado de {event.provider}</strong>
            <div className="meta">{event.justification}</div>
            <div className="meta">
              {event.explorerUrl ? (
                <a href={event.explorerUrl} target="_blank" rel="noreferrer">
                  {short(event.transaction)} ↗
                </a>
              ) : (
                <code>{short(event.transaction)}</code>
              )}
            </div>
          </div>
        </li>
      );

    case "refusal":
      return (
        <li className="item item-refusal">
          <span className="badge badge-warn">RECUSADO</span>
          <div className="item-body">
            <strong>{event.provider}</strong>
            <div className="meta">{event.reason}</div>
          </div>
        </li>
      );

    case "error":
      return (
        <li className="item item-refusal">
          <span className="badge badge-warn">ERRO</span>
          <div className="item-body">
            <pre>{event.message}</pre>
          </div>
        </li>
      );

    default:
      return null;
  }
}

/**
 * Copia um texto para a area de transferencia.
 *
 * `navigator.clipboard` so existe em contexto seguro (HTTPS ou localhost), e a
 * demo tambem roda em HTTP puro fora do localhost - por isso o fallback com um
 * textarea invisivel e `execCommand`, que funciona nos dois casos.
 *
 * @param text - Texto a copiar
 * @returns Se a copia deu certo
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Cai no fallback abaixo: a permissao pode ter sido negada.
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * O endereco da carteira do agente: encurtado na tela, copiavel por inteiro e,
 * quando a execucao e on-chain de verdade, com link para o explorer.
 *
 * @param props - Propriedades do componente
 * @param props.address - Endereco completo da carteira
 * @param props.explorerUrl - Link do explorer, ou null no modo local
 * @returns A linha da carteira
 */
function WalletAddress({ address, explorerUrl }: { address: string; explorerUrl: string | null }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    setCopied(await copyToClipboard(address));
  }

  return (
    <div className="wallet">
      <code title={address}>{short(address)}</code>
      <button
        type="button"
        className={`icon-button ${copied ? "is-copied" : ""}`}
        onClick={handleCopy}
        title="Copiar endereco"
        aria-label="Copiar endereco da carteira"
      >
        {copied ? "copiado" : "copiar"}
      </button>
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="icon-button"
          title="Abrir a carteira no explorer"
        >
          explorer ↗
        </a>
      )}
    </div>
  );
}

/**
 * Sobrescritas do react-markdown: links do agente abrem em nova aba, e tabelas
 * ganham um container que rola na horizontal em vez de esticar o painel.
 */
const MARKDOWN_COMPONENTS = {
  a: ({ ...props }: ComponentProps<"a">) => <a {...props} target="_blank" rel="noreferrer" />,
  table: ({ ...props }: ComponentProps<"table">) => (
    <div className="md-table-wrap">
      <table {...props} />
    </div>
  ),
};

function App() {
  const {
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
  } = useAgentRun();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const timelineRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    timelineRef.current?.scrollTo({
      top: timelineRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [events]);

  function handleRunAgent(event: FormEvent) {
    event.preventDefault();
    const trimmed = goal.trim();

    if (trimmed) {
      run(`/api/run?goal=${encodeURIComponent(trimmed)}`);
    }
  }

  const balance = walletBalanceUsd ?? config?.walletBalanceUsd ?? null;
  const spent = budget?.spentUsd ?? 0;
  const total = budget?.totalUsd ?? config?.budgetUsd ?? 0;
  const spentPercent = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
  const running = status === "running";

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Agentic Travel</h1>
          <p className="tagline">
            O agente compra inteligencia premium por request, via x402
          </p>
        </div>
        {config && (
          <dl className="context">
            <div>
              <dt>rede</dt>
              <dd>
                {config.network}
                <span className={`mode mode-${config.facilitatorMode}`}>
                  {config.facilitatorMode}
                </span>
              </dd>
            </div>
            <div>
              <dt>carteira</dt>
              <dd>
                <WalletAddress
                  address={config.walletAddress}
                  explorerUrl={config.walletExplorerUrl}
                />
              </dd>
            </div>
            <div>
              <dt>modelo</dt>
              <dd>{start?.model ?? config.model}</dd>
            </div>
          </dl>
        )}
      </header>

      {config?.staleEnv && <p className="banner">{config.staleEnv}</p>}

      <main className="layout">
        <section className="panel panel-control">
          <form onSubmit={handleRunAgent}>
            <label htmlFor="goal">Objetivo</label>
            <textarea
              id="goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={4}
              disabled={running}
            />

            {config && (
              <>
                <span className="label">Prioridades do viajante</span>
                <ol className="priorities">
                  {config.priorities.map((priority) => (
                    <li key={priority}>{priority}</li>
                  ))}
                </ol>
              </>
            )}

            <div className="actions">
              <button type="submit" disabled={running}>
                {running ? "Executando..." : "Rodar agente"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={running}
                onClick={() => run("/api/demo")}
              >
                Rodar roteiro
              </button>
              {running && (
                <button type="button" className="ghost" onClick={stop}>
                  Parar
                </button>
              )}
            </div>
            <p className="hint">
              O roteiro e deterministico: mesmas compras reais, decisoes escritas em codigo.
            </p>
          </form>

          {/* Tres dinheiros diferentes convivem na demo e sao faceis de
              confundir - o saldo real da carteira, o recorte dele que o agente
              pode gastar em dados, e o preco da viagem, que nao passa por aqui.
              Cada um aparece com o proprio nome e a propria explicacao. */}
          <div className="money">
            <span className="label">Dinheiro nesta demo</span>

            <div className="money-row">
              <div className="money-head">
                <strong>Saldo da carteira</strong>
                <span>{balance === null ? "--" : `${money(balance)} USDC`}</span>
              </div>
              <p className="meta">
                {config?.facilitatorMode === "testnet"
                  ? "USDC de testnet na Base Sepolia, lido do RPC."
                  : "USDC no ledger em memoria do facilitator local."}{" "}
                E o dinheiro que a carteira do agente tem: cada pagamento x402 sai daqui.
                {config?.faucetUrl && (
                  <>
                    {" "}
                    <a href={config.faucetUrl} target="_blank" rel="noreferrer">
                      pegar USDC no faucet ↗
                    </a>
                  </>
                )}
              </p>
            </div>

            <div className="money-row">
              <div className="money-head">
                <strong>Orcamento de inteligencia</strong>
                <span>
                  {money(spent)} de {money(total)}
                </span>
              </div>
              <div className="meter">
                <div className="meter-fill" style={{ width: `${spentPercent}%` }} />
              </div>
              <p className="meta">
                Restam {money(budget?.remainingUsd ?? total)}. E o recorte do saldo liberado para
                comprar dados - o unico dinheiro que o agente move sozinho, centavo a centavo, por
                request.
              </p>
            </div>

            <div className="money-row">
              <div className="money-head">
                <strong>Viagem</strong>
                <span className="off">fora da carteira</span>
              </div>
              <p className="meta">
                Os precos de voo e hotel da recomendacao sao dolares do viajante, na casa das
                centenas, e nao passam pelo x402: o agente compara e recomenda, nao reserva nem
                paga.
              </p>
            </div>
          </div>

          {purchases.length > 0 && (
            <div className="purchases">
              <span className="label">Comprado nesta execucao</span>
              <ul>
                {purchases.map((purchase) => (
                  <li key={purchase.transaction}>
                    <span>{purchase.provider}</span>
                    <span>{money(purchase.priceUsd)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="panel panel-timeline">
          <span className="label">Linha do tempo</span>
          <ol className="timeline" ref={timelineRef}>
            {events.length === 0 && (
              <li className="empty">
                {running ? "Aguardando o primeiro passo..." : "Rode o agente para ver o fluxo."}
              </li>
            )}
            {events.map((event, index) => (
              <TimelineItem key={`${event.type}-${index}`} event={event} />
            ))}
          </ol>
        </section>

        <section className="panel panel-answer">
          <span className="label">Recomendacao</span>
          {error && <p className="error">{error}</p>}
          <div className="answer">
            {recommendation ? (
              <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {recommendation}
              </Markdown>
            ) : (
              <span className="empty">A resposta aparece aqui ao final.</span>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
