import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const API = `${location.protocol}//${location.hostname}:3001/api`
const ROTA = { sem: '/sem-idempotencia/pagamentos', com: '/com-idempotencia/pagamentos' }
const MAX_TENTATIVAS = 4

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hora = () => new Date().toLocaleTimeString('pt-BR')
// randomUUID só existe em contexto seguro (localhost/https); fallback para quem abrir pelo IP da rede.
const novaChave = () => crypto.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`

// Estado e ações de uma das pistas ("sem" ou "com" idempotência) — o "app do cliente".
function usePista(modo, atualizar) {
  const [log, setLog] = useState([])
  const [pacotes, setPacotes] = useState([])
  const [armado, setArmadoState] = useState(false)
  const [intencoes, setIntencoes] = useState([])
  const [valor, setValor] = useState(100)
  const armadoRef = useRef(false)
  const ultimaRef = useRef(null)
  const seq = useRef(0)
  const numPedido = useRef(100)

  const setArmado = (v) => {
    armadoRef.current = v
    setArmadoState(v)
  }
  const registrar = (tipo, texto) => setLog((l) => [...l, { id: ++seq.current, tipo, texto, hora: hora() }])
  const moverPacote = (id, fase, rotulo) =>
    setPacotes((ps) => (ps.some((p) => p.id === id) ? ps.map((p) => (p.id === id ? { ...p, fase, rotulo } : p)) : [...ps, { id, fase, rotulo }]))
  const removerPacote = (id) => setPacotes((ps) => ps.filter((p) => p.id !== id))

  async function enviar(intencao) {
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const perder = armadoRef.current // a falha armada vale só para a próxima requisição
      if (perder) setArmado(false)
      const id = ++seq.current
      registrar('req', `POST ${ROTA[modo]} · ${intencao.pedido} · ${brl(intencao.valor)} · tentativa ${tentativa}`)
      moverPacote(id, 'ida', `#${tentativa}`)

      const resposta = fetch(API + ROTA[modo], {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(modo === 'com' && { 'idempotency-key': intencao.chave }),
          ...(perder && { 'x-simular-falha': 'perder-resposta' }),
        },
        body: JSON.stringify({ pedido: intencao.pedido, valor: intencao.valor }),
      }).then(async (r) => ({ status: r.status, replay: r.headers.get('idempotent-replayed') === 'true', corpo: await r.json() }))
      resposta.catch(() => {}) // tratado abaixo; evita "unhandled rejection" durante a animação

      await sleep(400)
      moverPacote(id, 'servidor', `#${tentativa}`)
      atualizar()

      try {
        const r = await resposta
        const ok = r.status === 201
        moverPacote(id, ok ? 'volta' : 'volta erro', String(r.status))
        setTimeout(() => removerPacote(id), 600)
        if (ok && r.replay) registrar('replay', `← 201 · resposta salva devolvida (Idempotent-Replayed) · ${r.corpo.id} · nenhuma nova cobrança`)
        else if (ok) registrar('ok', `← 201 Created · cobrança ${r.corpo.id}`)
        else if (r.status === 409) registrar('bloqueio', '← 409 Conflict · chave em processamento, nada cobrado')
        else if (r.status === 422) registrar('erro', '← 422 Unprocessable · mesma chave, outro payload: rejeitado')
        else registrar('erro', `← ${r.status} · ${r.corpo.erro}`)
        atualizar()
        return
      } catch {
        moverPacote(id, 'perdida', '✕')
        setTimeout(() => removerPacote(id), 1000)
        atualizar()
        registrar('perda', 'resposta perdida · timeout… o cliente não sabe se foi cobrado')
        if (tentativa === MAX_TENTATIVAS) break
        const espera = Math.round(500 * 2 ** (tentativa - 1) + Math.random() * 300) // backoff exponencial + jitter
        registrar('retry', `retry em ${espera} ms ${modo === 'com' ? `· mesma Idempotency-Key ${intencao.chave.slice(0, 8)}…` : '· sem chave: a API não reconhece a repetição'}`)
        await sleep(espera)
      }
    }
    registrar('erro', `desistiu após ${MAX_TENTATIVAS} tentativas`)
  }

  function novaIntencao() {
    const intencao = { pedido: `A-${++numPedido.current}`, valor: Number(valor), chave: novaChave() }
    ultimaRef.current = intencao
    setIntencoes((is) => [...is, intencao])
    return intencao
  }

  const pagar = async () => {
    const intencao = novaIntencao()
    await enviar(intencao)
    return intencao
  }
  const cliqueDuplo = () => {
    const intencao = novaIntencao()
    registrar('info', `clique duplo no "Pagar" · ${intencao.pedido} enviado 2× em paralelo`)
    return Promise.all([enviar(intencao), enviar(intencao)])
  }
  const outroValor = async () => {
    const base = ultimaRef.current ?? (await pagar())
    const alterada = { ...base, valor: base.valor + 50 }
    registrar('info', `reenviando ${base.pedido} com a mesma chave, mas ${brl(alterada.valor)}`)
    await enviar(alterada)
  }
  const limpar = () => {
    setLog([])
    setPacotes([])
    setIntencoes([])
    setArmado(false)
    ultimaRef.current = null
  }

  return { modo, log, pacotes, armado, setArmado, intencoes, valor, setValor, pagar, cliqueDuplo, outroValor, limpar }
}

function App() {
  const [estado, setEstado] = useState({ cobrancas: [], chaves: [] })
  const [offline, setOffline] = useState(false)
  const ultimaLeitura = useRef(0)

  const atualizar = useCallback(() => {
    const n = ++ultimaLeitura.current // ignora respostas fora de ordem
    return fetch(`${API}/estado`)
      .then((r) => r.json())
      .then((e) => n === ultimaLeitura.current && (setEstado(e), setOffline(false)))
      .catch(() => setOffline(true))
  }, [])
  useEffect(() => {
    atualizar()
  }, [atualizar])

  const sem = usePista('sem', atualizar)
  const com = usePista('com', atualizar)

  const resetar = async () => {
    await fetch(`${API}/estado`, { method: 'DELETE' }).catch(() => {})
    sem.limpar()
    com.limpar()
    atualizar()
  }

  const roteiro = [
    { texto: 'Sem chave + timeout', resultado: 'cobrança dupla', tom: 'ruim', rodar: () => (sem.setArmado(true), sem.pagar()) },
    { texto: 'Com chave + timeout', resultado: '1 cobrança só', tom: 'bom', rodar: () => (com.setArmado(true), com.pagar()) },
    { texto: 'Clique duplo', resultado: '409, nada duplicado', tom: 'bom', rodar: () => (sem.cliqueDuplo(), com.cliqueDuplo()) },
    { texto: 'Mesma chave, outro valor', resultado: '422', tom: 'ruim', rodar: () => com.outroValor() },
  ]

  return (
    <main>
      <header className="topo">
        <div>
          <span className="eyebrow laranja">Workshop · APIs de pagamento</span>
          <h1>Simulador de idempotência</h1>
          <p className="sub">Como cobrar exatamente uma vez — mesmo quando a rede falha e o cliente tenta de novo.</p>
        </div>
        <button className="secundario" onClick={resetar}>
          Resetar tudo
        </button>
      </header>

      {offline && (
        <p className="offline" role="alert">
          API fora do ar em {API}. Rode <code>npm run dev</code> (ou <code>npm run api</code>).
        </p>
      )}

      <section aria-labelledby="roteiro-titulo">
        <h2 id="roteiro-titulo" className="eyebrow laranja">
          No simulador · clique para rodar
        </h2>
        <ol className="roteiro">
          {roteiro.map((c, i) => (
            <li key={c.texto}>
              <button onClick={c.rodar}>
                <span className="num">{i + 1}</span> {c.texto} → <span className={c.tom}>{c.resultado}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <div className="pistas">
        <Pista pista={sem} estado={estado} />
        <Pista pista={com} estado={estado} />
      </div>
    </main>
  )
}

function Pista({ pista, estado }) {
  const { modo } = pista
  const cobrancas = estado.cobrancas.filter((c) => c.modo === modo)
  const processando = pista.pacotes.some((p) => p.fase === 'servidor')
  const ultima = pista.intencoes.at(-1)

  return (
    <section className={`pista ${modo}`}>
      <header>
        <span className="eyebrow">{modo === 'sem' ? 'POST puro' : 'POST + Idempotency-Key'}</span>
        <h2>{modo === 'sem' ? 'Sem idempotência' : 'Com idempotência'}</h2>
      </header>

      <div className="controles">
        <label>
          Valor R$
          <input type="number" min="1" step="1" value={pista.valor} onChange={(e) => pista.setValor(e.target.value)} />
        </label>
        <button onClick={pista.pagar}>Pagar</button>
        <button onClick={pista.cliqueDuplo}>Clique duplo</button>
        {modo === 'com' && <button onClick={pista.outroValor}>Mesma chave, outro valor</button>}
      </div>

      {modo === 'com' && (
        <code className="chave">
          Idempotency-Key: {ultima ? `${ultima.chave.slice(0, 18)}… (${ultima.pedido})` : '— gerada uma vez por intenção de pagamento'}
        </code>
      )}

      <Diagrama pista={pista} processando={processando} />
      <Extrato cobrancas={cobrancas} intencoes={pista.intencoes} />
      {modo === 'com' && <TabelaChaves chaves={estado.chaves} />}
      <Log log={pista.log} />
    </section>
  )
}

function Diagrama({ pista, processando }) {
  const { armado, setArmado, pacotes } = pista
  return (
    <div className="diagrama-bloco">
      <div className="diagrama">
        <div className="no">App do cliente</div>
        <button
          className={`fio ${armado ? 'armado' : ''}`}
          aria-pressed={armado}
          aria-label="Derrubar a próxima resposta"
          onClick={() => setArmado(!armado)}
        >
          <span className="linha" />
          {armado && <span className="raio">⚡</span>}
          {pacotes.map((p, i) => (
            <span key={p.id} className={`pacote ${p.fase}`} style={{ top: `calc(50% + ${(i - (pacotes.length - 1) / 2) * 26}px)` }}>
              <b>{p.rotulo}</b>
            </span>
          ))}
        </button>
        <div className={`no api ${processando ? 'ocupado' : ''}`}>
          API de pagamento
          <small>{processando ? 'processando cobrança…' : 'aguardando'}</small>
        </div>
      </div>
      <p className={`dica ${armado ? 'ativa' : ''}`}>
        {armado
          ? '⚡ Rede instável: a próxima resposta será perdida — a API cobra, mas o cliente não fica sabendo.'
          : '✂ Clique no fio para derrubar a próxima resposta.'}
      </p>
    </div>
  )
}

function Extrato({ cobrancas, intencoes }) {
  const cobrado = cobrancas.reduce((s, c) => s + c.valor, 0)
  const pedido = intencoes.reduce((s, i) => s + i.valor, 0)
  const excesso = cobrado - pedido
  const porPedido = Object.groupBy(cobrancas, (c) => c.pedido)

  return (
    <div className="extrato">
      <div className={`total ${excesso > 0 ? 'ruim' : ''}`}>
        <span className="eyebrow">Resultado</span>
        <strong>{brl(cobrado)}</strong>
        <span>cobrados por pedidos que somam {brl(pedido)}</span>
        {excesso > 0 && <span className="alerta">+{brl(excesso)} cobrados a mais</span>}
      </div>
      <ul className="recibos" aria-label="Cobranças registradas na API">
        {cobrancas.length === 0 && <li className="vazio">Nenhuma cobrança ainda</li>}
        {cobrancas.map((c) => (
          <li key={c.id} className={porPedido[c.pedido].length > 1 ? 'dup' : ''}>
            <span className="mono">{c.id}</span>
            <span>{c.pedido}</span>
            <strong>{brl(c.valor)}</strong>
            {porPedido[c.pedido].length > 1 && <span className="selo">duplicada</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function TabelaChaves({ chaves }) {
  return (
    <div className="tabela-chaves">
      <span className="eyebrow">Tabela de chaves na API · UNIQUE(chave)</span>
      <table>
        <thead>
          <tr>
            <th>Chave</th>
            <th>Status</th>
            <th>Hash do payload</th>
            <th>Resposta salva</th>
          </tr>
        </thead>
        <tbody>
          {chaves.length === 0 && (
            <tr>
              <td colSpan="4" className="vazio">
                Nenhuma chave registrada
              </td>
            </tr>
          )}
          {chaves.map((k) => (
            <tr key={k.chave}>
              <td className="mono">{k.chave.slice(0, 8)}…</td>
              <td>
                <span className={`status ${k.status}`}>{k.status}</span>
              </td>
              <td className="mono">{k.hash}…</td>
              <td className="mono">{k.resposta ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Log({ log }) {
  return (
    <div className="log">
      <span className="eyebrow">Linha do tempo</span>
      {/* column-reverse mantém a rolagem presa no evento mais recente */}
      <div className="rolagem">
        <ol>
          {log.length === 0 && <li className="vazio">Faça um pagamento para ver as requisições</li>}
          {log.map((e) => (
            <li key={e.id} className={e.tipo}>
              <time>{e.hora}</time> {e.texto}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
