'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { UserManager } from 'oidc-client-ts'
import { AuthProvider, useAuth } from 'react-oidc-context'
import type { SessionSummary } from '@agentic-aws/shared'
import { apiClient, ApiError } from './api'
import { authority, loadConfig, logoutUrl, type AppConfig } from './config'
import { toTurns, type Turn } from './turns'

export default function Page() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadConfig().then(setConfig, (err) => setError(String(err)))
  }, [])

  const userManager = useMemo(() => {
    if (!config) return null
    const home = `${window.location.origin}/`
    return new UserManager({
      authority: authority(config),
      client_id: config.clientId,
      redirect_uri: home,
      post_logout_redirect_uri: home,
      response_type: 'code',
      scope: 'openid email profile',
    })
  }, [config])

  if (error) return <Centered>Não foi possível carregar a configuração: {error}</Centered>
  if (!config || !userManager) return <Centered>Carregando…</Centered>

  return (
    <AuthProvider
      userManager={userManager}
      // Tira ?code=&state= da barra de endereço depois do login.
      onSigninCallback={() => window.history.replaceState({}, document.title, window.location.pathname)}
    >
      <Gate config={config} userManager={userManager} />
    </AuthProvider>
  )
}

type ChatProps = { config: AppConfig; userManager: UserManager }

function Gate({ config, userManager }: ChatProps) {
  const auth = useAuth()

  if (auth.isLoading) return <Centered>Carregando…</Centered>
  if (!auth.isAuthenticated) {
    return (
      <Centered>
        <h1 className="text-xl font-semibold">Loja de eletrônicos</h1>
        <p className="text-sm text-gray-500">Entre para conversar com o vendedor.</p>
        {auth.error && <p className="text-sm text-red-600">Erro no login: {auth.error.message}</p>}
        <button className="rounded bg-blue-600 px-4 py-2 text-white" onClick={() => auth.signinRedirect()}>
          Entrar
        </button>
      </Centered>
    )
  }
  return <Chat config={config} userManager={userManager} />
}

function Chat({ config, userManager }: ChatProps) {
  const auth = useAuth()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [peek, setPeek] = useState<number | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const client = useMemo(
    () =>
      apiClient(config.apiUrl, async () => {
        let user = await userManager.getUser()
        if (!user || user.expired) user = await userManager.signinSilent()
        if (!user?.id_token) throw new Error('sessão expirada, entre de novo')
        return user.id_token
      }),
    [config.apiUrl, userManager]
  )

  const refreshSessions = useCallback(
    () =>
      client.listSessions().then(setSessions, (err) => setNotice(`Não foi possível listar as conversas: ${message(err)}`)),
    [client]
  )

  useEffect(() => {
    let cancelled = false
    client.listSessions().then(
      (list) => !cancelled && setSessions(list),
      (err) => !cancelled && setNotice(`Não foi possível listar as conversas: ${message(err)}`)
    )
    return () => {
      cancelled = true
    }
  }, [client])

  function showPeek(i: number) {
    clearTimeout(closeTimer.current)
    setPeek(i)
  }
  function hidePeek() {
    closeTimer.current = setTimeout(() => setPeek(null), 400)
  }

  function newChat() {
    setActiveId(null)
    setTurns([])
    setPeek(null)
  }

  async function openSession(id: string) {
    if (busy || id === activeId) return
    setActiveId(id)
    setTurns([])
    setPeek(null)
    try {
      setTurns(toTurns((await client.history(id)).messages))
    } catch (err) {
      setNotice(`Não foi possível abrir a conversa: ${message(err)}`)
      if (err instanceof ApiError && err.status === 404) {
        newChat()
        refreshSessions()
      }
    }
  }

  async function removeSession(s: SessionSummary) {
    if (busy || !window.confirm(`Apagar a conversa "${s.title}"?`)) return
    try {
      await client.deleteSession(s.id)
      if (s.id === activeId) newChat()
    } catch (err) {
      setNotice(`Não foi possível apagar: ${message(err)}`)
    }
    refreshSessions()
  }

  async function send(e: { preventDefault(): void }) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return

    const user: Turn = { role: 'user', content: text }
    const base = [...turns, user]
    setTurns([...base, { role: 'assistant', content: '' }])
    setInput('')
    setBusy(true)
    setNotice(null)

    let reply = ''
    try {
      await client.chat({ sessionId: activeId ?? undefined, message: text }, (line) => {
        if ('session' in line) return setActiveId(line.session.id)
        if ('error' in line) throw new Error(line.error)
        if ('tool' in line) {
          user.tools = [...(user.tools ?? []), line.tool]
          reply = ''
        } else if ('message' in line) {
          reply += line.message.content
        }
        setTurns([...base, { role: 'assistant', content: reply }])
      })
    } catch (err) {
      setTurns([...base, { role: 'assistant', content: `Erro: ${message(err)}` }])
    } finally {
      setBusy(false)
      refreshSessions()
    }
  }

  async function signOut() {
    await auth.removeUser()
    window.location.href = logoutUrl(config, `${window.location.origin}/`)
  }

  return (
    <div className="flex h-screen">
      <nav className="flex w-64 shrink-0 flex-col gap-2 border-r p-3 dark:border-gray-800">
        <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={newChat} disabled={busy}>
          Nova conversa
        </button>
        <ul className="flex-1 space-y-1 overflow-y-auto">
          {sessions.map((s) => (
            <li key={s.id} className="group flex items-center gap-1">
              <button
                onClick={() => openSession(s.id)}
                disabled={busy}
                className={`flex-1 truncate rounded px-2 py-1 text-left text-sm ${
                  s.id === activeId ? 'bg-gray-200 dark:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-900'
                }`}
                title={`${s.title}\n${new Date(s.updatedAt).toLocaleString('pt-BR')}`}
              >
                {s.title}
              </button>
              <button
                onClick={() => removeSession(s)}
                disabled={busy}
                className="invisible px-1 text-gray-400 hover:text-red-600 group-hover:visible"
                aria-label={`Apagar ${s.title}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t pt-2 text-xs text-gray-500 dark:border-gray-800">
          <p className="truncate">{String(auth.user?.profile.email ?? '')}</p>
          <button className="underline" onClick={signOut}>
            Sair
          </button>
        </div>
      </nav>

      <main className="mx-auto flex h-screen max-w-2xl flex-1 flex-col gap-4 p-4">
        {notice && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950">
            {notice}
          </p>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto">
          {turns.length === 0 && (
            <p className="text-sm text-gray-500">O histórico fica salvo: dá para fechar a página e continuar depois.</p>
          )}
          {turns.map((m, i) =>
            m.role === 'user' ? (
              <div
                key={i}
                onMouseEnter={() => showPeek(i)}
                onMouseLeave={hidePeek}
                className="ml-auto w-fit max-w-[80%] cursor-help whitespace-pre-wrap rounded bg-blue-600 px-3 py-2 text-white"
              >
                {m.content}
              </div>
            ) : (
              <div key={i} className="prose-chat w-fit max-w-[80%] rounded bg-gray-200 px-3 py-2 dark:bg-gray-800">
                {m.content ? <Markdown>{m.content}</Markdown> : busy && i === turns.length - 1 ? '…' : '(sem resposta)'}
              </div>
            )
          )}
        </div>

        <form onSubmit={send} className="flex gap-2">
          <input
            className="flex-1 rounded border px-3 py-2"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte alguma coisa…"
            maxLength={4000}
          />
          <button className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50" disabled={busy}>
            Enviar
          </button>
        </form>
      </main>

      {peek !== null && turns[peek]?.role === 'user' && (
        <aside
          onMouseEnter={() => showPeek(peek)}
          onMouseLeave={hidePeek}
          className="fixed right-4 top-4 z-10 max-h-[calc(100vh-2rem)] w-80 overflow-y-auto rounded border border-gray-300 bg-white p-3 text-xs shadow-lg xl:w-96 dark:border-gray-700 dark:bg-gray-900"
        >
          <p className="mb-2 font-semibold">Ferramentas chamadas neste turno</p>
          {turns[peek].tools?.length ? (
            turns[peek].tools.map((t, j) => (
              <div key={j} className="mb-2 rounded border border-amber-400 bg-amber-50 p-2 last:mb-0 dark:bg-amber-950">
                <span className="font-mono uppercase text-amber-700 dark:text-amber-400">ferramenta · {t.name}</span>
                <p className="whitespace-pre-wrap font-mono">
                  {JSON.stringify(t.arguments)} → {JSON.stringify(t.result)}
                </p>
              </div>
            ))
          ) : (
            <p className="text-gray-500">Nenhuma.</p>
          )}
        </aside>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex h-screen flex-col items-center justify-center gap-3 p-4 text-center">{children}</main>
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}
