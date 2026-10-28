# ollama-chat

Chat em Next.js que conversa com um modelo rodando localmente no Ollama, com streaming
token a token e ferramentas vindas de um servidor MCP separado (`../ollama-tools`).

São duas abas de conversa:

- **Sem memória** — só a sua última mensagem é enviada. O modelo não faz ideia do que veio antes.
- **Histórico completo** — todas as mensagens anteriores vão junto em cada requisição.

Passe o mouse por cima de uma mensagem sua e um painel abre à direita mostrando **exatamente**
o que foi enviado ao modelo naquele turno, incluindo o system prompt e as ferramentas que
foram chamadas, com argumentos e retorno. Nada é salvo em cookie ou localStorage: o histórico
vive só na memória da aba, e some ao recarregar a página.

## Como rodar

Três coisas precisam estar no ar. O Ollama normalmente já está (veja abaixo), então na
prática são dois terminais:

```bash
# terminal 1 — as ferramentas (servidor MCP)
cd ../ollama-tools && npm install && npm start

# terminal 2 — o chat
npm install && npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

Suba o servidor de ferramentas **antes** de conversar.

### Variáveis de ambiente

| Variável | Padrão | O que é |
| --- | --- | --- |
| `OLLAMA_URL` | `http://localhost:11434` | Onde o Ollama escuta. |
| `OLLAMA_MODEL` | `qwen2.5:14b` | Modelo usado. Precisa suportar ferramentas. |
| `MCP_URL` | `http://localhost:4000/mcp` | Servidor MCP com as ferramentas. |

Coloque em `.env.local` se quiser mudar.

### Outros modelos que aceitam tools

Um modelo pequeno que suporta ferramentas: [llama3.2](https://ollama.com/library/llama3.2).

```bash
ollama pull llama3.2          # 3B, o padrão da página
echo 'OLLAMA_MODEL=llama3.2' >> .env.local
```

Para conferir se um modelo qualquer sabe chamar ferramenta, procure `tools` aqui:

```bash
ollama show llama3.2 | grep -i capabilities -A3
```

Quanto menor o modelo, mais ele erra a decisão de chamar a ferramenta.

## O Ollama já está rodando

Na maioria das instalações o Ollama sobe como serviço junto com o sistema. Por isso
`ollama serve` responde `bind: address already in use` — esse erro quer dizer "já está no
ar", não "falhou". Não rode.

```bash
curl -s localhost:11434/api/version   # respondeu = está no ar
sudo systemctl start ollama           # só se não estiver
```

## Monitorando

A primeira pergunta depois de alguns minutos parados demora bem mais que as outras. Não é
o chat travando: o Ollama descarrega o modelo da memória depois de ~5 minutos ocioso, e a
próxima pergunta paga o carregamento de novo. Dá para ver isso acontecendo:

```bash
watch -n1 ollama ps        # se está carregado, se está na GPU ou na CPU, e quando expira
journalctl -u ollama -f    # cada requisição chegando, mais as linhas de carga/descarga
```

`ollama ps` é o que responde "por que está demorando". Tabela vazia = modelo frio, a próxima
pergunta vai demorar. Coluna `UNTIL` com tempo = quente, responde na hora. E se o
`PROCESSOR` disser `CPU` em vez de `GPU`, o modelo não coube na placa e a resposta vai levar
minutos em vez de segundos — aí vale usar um modelo menor.

Para não descarregar no meio de uma demonstração, mande o modelo ficar na memória em
`src/app/api/chat/route.ts`:

```ts
body: JSON.stringify({ model: MODEL, messages: convo, tools, stream: true, keep_alive: -1 }),
```

`-1` mantém carregado até o Ollama reiniciar; `'30m'` é a versão educada.

## Como funciona por dentro

`src/app/api/chat/route.ts` é o único caminho até o modelo. Ele:

1. Abre uma conexão MCP com o `ollama-tools` e traduz as ferramentas para o formato do Ollama.
2. Chama o Ollama com `stream: true` e repassa os tokens para o navegador em NDJSON.
3. Se o modelo pedir uma ferramenta, executa via MCP, devolve o resultado para a conversa e
   chama o modelo de novo — no máximo `MAX_ROUNDS` vezes, senão ele fica em loop.
4. Segura os primeiros tokens de cada rodada por `HOLD_MS`. Modelos pequenos costumam
   rascunhar em voz alta antes de decidir chamar a ferramenta, às vezes em outro idioma;
   se a chamada aparecer, esse rascunho é descartado em vez de piscar na tela.

`src/app/page.tsx` é o cliente inteiro: estado em memória, leitura do stream, e o painel
lateral. O system prompt fica **no cliente**, de propósito, para que o painel mostre a carga
real enviada, sem nada escondido no servidor.
