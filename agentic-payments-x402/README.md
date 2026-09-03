# Workshop 05 — Agentic Payments com x402

Um agente de viagens com **carteira própria** que compra inteligência premium
sob demanda, pagando por request via **x402**.

A tese da demo:

> O agente gasta centavos em informação para melhorar decisões de centenas ou
> milhares de dólares. E quando a informação não muda a decisão, ele não compra.

Este projeto implementa o escopo descrito em
[`agentic-travel-x402-workshop.md`](./agentic-travel-x402-workshop.md), rodando
inteiro em localhost.

---

## O que é real e o que é mock

Essa distinção é o ponto central do workshop.

| Camada | Status |
|---|---|
| Protocolo x402 v2 (402, `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`) | **real** — pacotes `@x402/*` oficiais |
| Assinatura EIP-712 / autorização EIP-3009 | **real** — assinada pela chave da carteira com `viem` |
| Verificação da assinatura no facilitator | **real** — `verifyTypedData`, checagem de valor, destinatário, janela de validade e replay de nonce |
| Liquidação do pagamento | **simulada** por padrão (ledger em memória) — ou **real** na Base Sepolia com uma variável de ambiente, veja [Modo testnet](#modo-testnet-liquidação-real-na-base-sepolia) |
| Dados de viagem (voos, hotéis, risco, tarifas) | **mock** — fixtures determinísticas |
| Agente | **real** — AWS Strands Agents (TypeScript) com tool calling |
| Interface | **real** — React + Vite, acompanha a execução por Server-Sent Events |

Trocar a liquidação simulada pela real é uma variável de ambiente:
`FACILITATOR_MODE=testnet` aponta para o facilitator público da x402.org e
liquida de verdade na Base Sepolia, com hash no explorer. O código do agente e
dos sellers não muda — e sua carteira só precisa de USDC, não de ETH.

---

## Arquitetura

```text
            ┌──────────────────────────────────────────┐
            │  INTERFACE (:5173)                       │
            │  EventSource("/api/run")                 │
            └───────────────▲──────────────────────────┘
                            │ Server-Sent Events
                            │ tool · 402 · purchase · budget
            ┌───────────────┴──────────────────────────┐
            │  AGENTE (:4022)  Strands Agents + wallet │
            │                                          │
            │  tools gratuitas   tool paga             │
            │  search_flights    buy_premium_insight   │
            │  get_premium_price                       │
            │                                          │
            │  BudgetPolicy  ·  x402Client  ·  Wallet  │
            └───────────────┬──────────────────────────┘
                            │
              1. GET /premium/connection-risk
                            │
            ┌───────────────▼──────────────────────────┐
            │  MARKETPLACE (:4021)                     │
            │  express + paymentMiddleware do x402     │
            │                                          │
            │  /free/*      grátis                     │
            │  /premium/*   $0.01 a $0.04 por request  │
            └───────────────┬──────────────────────────┘
                            │
              2. 402 Payment Required
                 PAYMENT-REQUIRED: <preço, rede, payTo>
                            │
              3. agente decide: vale a pena?
              4. assina autorização EIP-3009
                 PAYMENT-SIGNATURE: <autorização assinada>
                            │
            ┌───────────────▼──────────────────────────┐
            │  FACILITATOR (:4020)                     │
            │  /verify   confere a assinatura          │
            │  /settle   move o saldo no ledger        │
            │  /ledger   estado das contas             │
            └───────────────┬──────────────────────────┘
                            │
              5. 200 OK + dados
                 PAYMENT-RESPONSE: <recibo da liquidação>
```

---

## Pré-requisitos

- Node.js 20 ou superior
- Um navegador (a interface roda em <http://localhost:5173>)
- Uma opção de acesso a modelo: [Ollama](https://ollama.com/) com um modelo
   baixado (para o roteiro completo, use `qwen3:4b` ou maior) **ou** acesso à
   AWS com credenciais para usar o Amazon Bedrock. Veja [Modelos](#modelos).

Nenhuma conta AWS, carteira com fundos ou RPC é necessária no modo padrão.

---

## Setup

```bash
npm install
cp .env.example .env
```

O `.env` já vem pronto para rodar em localhost. A chave privada do agente é a
conta #0 do Anvil — uma chave de teste pública, **nunca use com fundos reais**.

---

## Como rodar

Em um terminal, suba tudo — facilitator, marketplace, agente e interface:

```bash
npm run dev
```

Abra <http://localhost:5173>. A interface acompanha a execução ao vivo por
Server-Sent Events: cada tool call, cada `402`, cada pagamento com link para o
explorer, e o orçamento sendo consumido.

| Serviço | Porta | O que é |
|---|---|---|
| Interface | 5173 | React + Vite, consome o SSE |
| Agente | 4022 | `GET /api/run` e `GET /api/demo` (SSE), `GET /api/config` |
| Marketplace | 4021 | rotas grátis e rotas protegidas por x402 |
| Facilitator | 4020 | `/verify`, `/settle`, `/supported`, `/ledger` |

Prefere terminal? Em outro terminal, veja o cenário completo do documento
rodando de ponta a ponta:

```bash
npm run demo
```

E depois solte o agente no mesmo problema:

```bash
npm run agent
```

Ou passe um pedido diferente:

```bash
npm run agent -- "Quero ir de GRU para Toquio gastando pouco, mas sem risco de perder conexão"
```

### Outros comandos

| Comando | O que faz |
|---|---|
| `npm run demo` | roteiro determinístico do cenário da seção 7, sem LLM |
| `npm run agent` | o agente resolvendo o mesmo problema por conta própria |
| `npm run pay-once` | **um** ciclo x402 isolado: 402 → decisão → pagamento → dados |
| `npm run wallet` | endereço e saldo da carteira do agente |
| `npm run wallet:new` | gera uma carteira nova (para usar em testnet) |
| `npm run ledger` | saldos e liquidações no facilitator |
| `npm run typecheck` | verifica os tipos de todos os pacotes |

Os três primeiros formam uma escada didática:

1. **`pay-once`** — o protocolo isolado, em 4 passos. Comece aqui.

   ```bash
   npm run pay-once -- connection-risk
   ```

2. **`demo`** — a narrativa inteira (busca grátis → incerteza → 402 → compra →
   decisão), com as decisões escritas em código. Todos os pagamentos são x402 de
   verdade: mesmo cliente, mesma política de orçamento, mesma liquidação. Só o
   raciocínio é que não vem de uma LLM.

3. **`agent`** — o mesmo problema, agora decidido pelo modelo. É aqui que dá
   para comparar: o agente chega sozinho ao roteiro do passo 2?

O `demo` reproduz os números do documento: $0.04 de ConnectionRisk, $0.03 de
FarePulse, $0.07 gastos de um orçamento de $0.20.

---

## A interface

```text
  ┌─ Objetivo ───────┐ ┌─ Linha do tempo ─────────┐ ┌─ Recomendação ─┐
  │ prioridades      │ │ GRATIS  search_flights   │ │ texto do       │
  │ [Rodar agente]   │ │ 402     ConnectionRisk   │ │ agente,        │
  │ [Rodar roteiro]  │ │         cobra $0.040     │ │ conforme       │
  │                  │ │ $0.040  Comprado ↗ tx    │ │ chega          │
  │ orçamento ▓▓░░░░ │ │ 402     FarePulse        │ │                │
  │ $0.07 de $0.20   │ │ $0.030  Comprado ↗ tx    │ │                │
  └──────────────────┘ └──────────────────────────┘ └────────────────┘
```

Os dois botões usam o mesmo stream SSE e os mesmos eventos:

- **Rodar agente** — o modelo decide. É a demo real, e com modelo pequeno a
  linha do tempo pode terminar sem nenhuma compra (veja
  [Sobre o tamanho do modelo](#sobre-o-tamanho-do-modelo)).
- **Rodar roteiro** — as decisões vêm do código, mas as compras são x402 de
  verdade. Garante que a demo mostre o fluxo inteiro em qualquer máquina.

Eventos amarelos custam dinheiro; azuis são grátis. No modo testnet o hash da
liquidação vira link clicável para o explorer.

### Por que SSE

O fluxo é de mão única (servidor → navegador) e dura só o tempo da execução.
`EventSource` já traz reconexão e parsing prontos, e o stream é legível no
DevTools e no `curl`:

```bash
curl -N "http://localhost:4022/api/run?goal=Viagem%20GRU%20para%20HND"
```

```text
event: quote
data: {"type":"quote","provider":"ConnectionRisk","priceUsd":0.04,...}

event: purchase
data: {"type":"purchase","provider":"ConnectionRisk","transaction":"0x...",...}
```

O contrato de eventos vive em `packages/agent/src/events.ts`, com uma cópia dos
tipos em `packages/web/src/types.ts` — a interface não importa nada do agente,
que carrega o SDK do Strands e o viem.

## O que observar

**No terminal do agente**, as linhas marcadas com `$` são as que gastam dinheiro:

```text
  -> search_flights {"origin":"GRU","destination":"HND"}
    <- {"options":[{"id":"A","priceUsd":920,...
$ -> buy_premium_insight {"apiId":"connection-risk",...
    <- {"comprado":true,"precoUsd":0.04,"transacao":"0x...
```

**No terminal dos serviços**, o par verify/settle de cada compra:

```text
[verify] ok recurso=http://localhost:4021/premium/connection-risk
[settle] ok tx=0xc6faf63b06... valor=$0.040
```

**No `npm run ledger`**, para onde o dinheiro foi:

```text
SALDOS
  Agente                  $9.790  0xf39fd6e5...
  ConnectionRisk          $0.080  0x3c44cddd...
```

---

## Estrutura do projeto

```text
packages/
├── shared/        tipos, catálogo do marketplace, conversão de USD ↔ unidades atômicas
├── facilitator/   facilitator x402 local
│   ├── ledger.ts              saldos, nonces consumidos e liquidações
│   ├── local-exact-evm.ts     verificação EIP-3009 + liquidação no ledger
│   └── server.ts              /verify /settle /supported /faucet /ledger
├── sellers/       marketplace de APIs
│   ├── fixtures/travel.ts     dados mock determinísticos
│   └── server.ts              rotas grátis + rotas protegidas por x402
├── agent/         o agente
│   ├── wallet.ts              carteira a partir de AGENT_PRIVATE_KEY
│   ├── chain.ts               saldo on-chain e links do explorer
│   ├── x402-client.ts         quote (402) e purchase (pagamento)
│   ├── budget.ts              política de orçamento
│   ├── session.ts             impõe o funil: grátis antes de premium
│   ├── tools.ts               tools do Strands
│   ├── agent.ts               modelo + system prompt
│   ├── events.ts              contrato de eventos da execução
│   ├── run.ts                 executa o agente publicando eventos
│   ├── demo-run.ts            roteiro determinístico publicando eventos
│   ├── server.ts              SSE: /api/run, /api/demo, /api/config
│   ├── cli.ts                 execução do agente no terminal
│   ├── demo.ts                roteiro no terminal
│   └── pay-once.ts            um ciclo x402 isolado
└── web/           interface da demo
    ├── useAgentRun.ts         assina o EventSource e acumula o estado
    ├── types.ts               cópia do contrato de eventos
    └── App.tsx                linha do tempo, orçamento e recomendação
```

---

## Como o x402 aparece no código

**Vendedor** (`packages/sellers/src/server.ts`) — declarar o preço é tudo o que
a API paga precisa fazer:

```ts
const routes = {
  "GET /premium/connection-risk": {
    accepts: [{ scheme: "exact", price: "$0.04", network: "eip155:84532", payTo }],
  },
};

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url }))
  .register(NETWORK, new ExactEvmScheme());

app.use(paymentMiddleware(routes, resourceServer));
```

**Comprador** (`packages/agent/src/x402-client.ts`) — o agente separa de
propósito as duas metades que o wrapper normalmente esconde:

```ts
// 1. descobrir o preço sem pagar: para no 402 e lê o cabeçalho
const response = await fetch(url);              // 402 Payment Required
const paymentRequired = decodePaymentRequiredHeader(
  response.headers.get("PAYMENT-REQUIRED")!,
);

// 2. decidir, e só então pagar
const paidFetch = wrapFetchWithPayment(fetch, client);
const paid = await paidFetch(url);              // 200 OK + PAYMENT-RESPONSE
```

É nesse intervalo entre 1 e 2 que mora o workshop inteiro.

---

## Onde as regras são impostas

O prompt sugere o comportamento, mas as garantias estão no código:

| Regra | Onde |
|---|---|
| Nenhuma compra acima do orçamento restante | `budget.ts` — verificado antes de assinar |
| Nenhum pagamento isolado acima do orçamento total | `x402-client.ts` — `spendControls` do `x402Client` |
| Sem premium antes de consultar as fontes gratuitas | `session.ts` |
| Sem comprar duas vezes a mesma consulta | `session.ts` |
| Sem gastar o saldo de outra pessoa | assinatura EIP-712, verificada no facilitator |

Um modelo pode se enganar sobre quanto já gastou. A política, não.

O que o código **não** decide: qual informação comprar, em que ordem, quantas
consultas fazer, se vale o preço e quando parar. Isso é do agente. O system
prompt (`packages/agent/src/agent.ts`) dá o critério — *a informação pode mudar
a recomendação? quanto custa errar?* — e um método sugerido, explicitamente não
obrigatório. Não há sequência de passos prescrita, e não comprar nada é um
resultado válido.

---

## Modelos

O provider é configurável em `MODEL_PROVIDER`.

| Provider | Configuração | Observação |
|---|---|---|
| `ollama` (padrão) | `OLLAMA_MODEL`, `OLLAMA_BASE_URL` | local, sem custo |
| `bedrock` | `BEDROCK_MODEL_ID`, `AWS_REGION`, `AWS_PROFILE` | exige credenciais AWS válidas |
| `openai` | `OPENAI_MODEL`, `OPENAI_API_KEY` | |

> **O `.env` é lido quando o processo sobe.** Depois de mudar `MODEL_PROVIDER`
> (ou qualquer outra variável), **reinicie o `npm run dev`**. O `tsx watch`
> recarrega o código, não o ambiente — sem o restart, a execução continua no
> provider antigo. O cabeçalho da interface e o log de startup do agente sempre
> mostram o provider realmente ativo; é onde conferir.

Um valor desconhecido em `MODEL_PROVIDER` interrompe a execução com uma mensagem
explícita, em vez de cair no provider padrão em silêncio.

### Usando Bedrock

```bash
aws sso login --profile <seu-perfil>   # se você usa SSO
```

E no `.env`:

```bash
MODEL_PROVIDER=bedrock
AWS_PROFILE=<seu-perfil>
AWS_REGION=us-east-1
```

Reinicie o `npm run dev`. Sem credenciais válidas a execução falha com
`Could not load credentials from any providers` — a aplicação traduz esse erro
com o comando de login a rodar.

### Sobre o tamanho do modelo

O agente não recebe um roteiro: recebe seis tools, um critério de decisão e um
orçamento, e precisa planejar sozinho quantas consultas fazer, quais, e quando
parar. Isso separa bem os modelos.

**Com `bedrock` + `claude-sonnet-4-6`** o funil completo acontece sem nenhum
passo prescrito — execução real:

```text
search_flights + search_hotels + list_premium_catalog     grátis
get_premium_price ×3   → 402 revela os preços             grátis
buy_premium_insight    ConnectionRisk (LAX)               $0.04
buy_premium_insight    ConnectionRisk (JFK)               $0.04
buy_premium_insight    EventsNow                          $0.01
get_budget_status
────────────────────────────────────────────────────────────────
gasto $0.09 de $0.20 — sobraram $0.11
```

Ele consultou o preço antes de comprar, ligou a prioridade #1 do viajante
("evitar conexões arriscadas") às duas opções de conexão curta, comprou o risco
das duas — e parou, deixando orçamento na mesa. É exatamente o comportamento que
o documento pede.

**Com `qwen3:1.7b`** (o padrão local) o comportamento observado em várias
execuções foi diferente:

- as tool calls saem no formato certo e os pagamentos, quando acontecem,
  funcionam de ponta a ponta;
- mas o modelo quase sempre **para depois da busca gratuita**, e às vezes
  descreve na resposta final uma compra que nunca fez.

A infraestrutura é a mesma nos dois casos; o que muda é a capacidade de
sustentar o raciocínio multi-etapa. Para a apresentação, use Bedrock (ou
`qwen3:4b`/`8b` localmente, com paciência — em CPU o thinking do Qwen3 deixa a
execução lenta). Sem isso, `npm run demo` mostra a narrativa inteira com
pagamentos reais e sem depender do modelo.

### Usando Bedrock

```bash
aws sso login --profile <seu-perfil>   # se você usa SSO
```

E no `.env`:

```bash
MODEL_PROVIDER=bedrock
AWS_PROFILE=<seu-perfil>
AWS_REGION=us-east-1
```

Reinicie o `npm run dev`. Sem credenciais válidas a execução falha com
`Could not load credentials from any providers` — a aplicação traduz esse erro
com o comando de login a rodar.

### Sobre o tamanho do modelo

Esta é a parte honesta do README.

O agente não recebe um roteiro: recebe seis tools, um critério de decisão e um
orçamento, e precisa planejar sozinho quantas consultas fazer, quais, e quando
parar. Isso é exigente para um modelo pequeno, e o comportamento observado com
`qwen3:1.7b` em várias execuções foi:

- as tool calls saem no formato certo e os pagamentos, quando acontecem,
  funcionam de ponta a ponta;
- mas o modelo quase sempre **para depois da busca gratuita**, e às vezes
  descreve na resposta final uma compra que nunca fez.

Ou seja: a infraestrutura funciona, o modelo é que não sustenta o raciocínio
multi-etapa. Para ver o agente completar o funil sozinho, use um modelo maior —
`qwen3:4b` ou `qwen3:8b` localmente (precisa de RAM e paciência: em CPU o
thinking do Qwen3 deixa a execução lenta), ou Bedrock:

```bash
MODEL_PROVIDER=bedrock
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6
```

Enquanto isso, `npm run demo` mostra a narrativa inteira com pagamentos reais e
sem depender do modelo — e vira o alvo do exercício: fazer o agente chegar lá.

---

## Modo testnet (liquidação real na Base Sepolia)

No modo `local` a liquidação é simulada. No modo `testnet` ela é uma transação
de verdade, com hash rastreável no explorer — é a versão da demo que convence.

O facilitator público da x402.org está ativo e anuncia exatamente o que
precisamos:

```json
{ "x402Version": 2, "scheme": "exact", "network": "eip155:84532" }
```

**O detalhe que torna isso fácil:** quem submete a `transferWithAuthorization` e
paga o gas é o facilitator, não você. O signer dele
(`0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf`) já processou mais de 1,8 milhão de
transações. Sua carteira precisa **só de USDC. Zero ETH.**

### Passo a passo

1. Gere uma carteira nova — a chave do Anvil que vem no `.env.example` é pública
   e serve só para o ledger local:

   ```bash
   npm run wallet:new
   ```

2. Cole a `AGENT_PRIVATE_KEY` no `.env` e mude o modo:

   ```bash
   FACILITATOR_MODE=testnet
   ```

3. Pegue USDC de teste em <https://faucet.circle.com> (selecione **Base
   Sepolia**). O faucet dá 10 USDC — suficiente para ~250 consultas de $0.04.

4. Confirme o saldo:

   ```bash
   npm run wallet
   ```

5. Rode normalmente. `npm run dev`, `npm run pay-once`, `npm run demo` e
   `npm run agent` funcionam igual — o que muda é que cada compra agora imprime
   um link do explorer:

   ```text
   pago $0.040  https://sepolia.basescan.org/tx/0x...
   ```

`npm run ledger` passa a ler os saldos on-chain em vez do ledger em memória, e
`npm run wallet` mostra o endereço no explorer.

### Quando o link do explorer aparece

A regra vive em um lugar só (`packages/agent/src/chain.ts`) e vale para toda
saída da aplicação:

| Modo | `EXPLORER_BASE_URL` | O que é exibido |
|---|---|---|
| `testnet` | definida (padrão) | `https://sepolia.basescan.org/tx/<hash>` |
| `testnet` | vazia | só o hash |
| `local` | qualquer | só o hash |

No modo local o hash é sintético — gerado pelo ledger em memória — então linkar
para o basescan levaria a uma página inexistente. `EXPLORER_BASE_URL` aceita
qualquer explorer (Blockscout, por exemplo) e a barra final é normalizada.

### O que muda no código

Nada. `FACILITATOR_MODE` só troca a URL do facilitator; o cliente x402, o
`paymentMiddleware`, a assinatura EIP-3009 e a política de orçamento são os
mesmos nos dois modos. É a mesma aplicação com um backend de liquidação
diferente.

### Detalhes

- **Ver o USDC chegar na sua carteira:** os `payTo` padrão são endereços de
  teste do Anvil (bons para ver o extrato separado por provider). Para receber
  você mesmo, defina `SELLER_PAY_TO=0x...` — todos os providers passam a pagar
  esse endereço.
- **A liquidação deixa de ser instantânea:** no modo local é uma escrita em
  memória; na Base Sepolia é um bloco (~2s). O `maxTimeoutSeconds` das rotas já
  é 300s, com folga.
- **O facilitator público não tem SLA.** É explicitamente para desenvolvimento e
  testnet. Para mainnet, use um facilitator de produção (CDP, Fireblocks e
  outros estão listados em <https://docs.x402.org/dev-tools/facilitators>).
- **Nunca use uma chave com fundos reais** neste projeto.

## Problemas comuns

**`Facilitator ... não respondeu`** — o `npm run dev` não está rodando, ou a
porta 4020 está ocupada.

**O agente não compra nada** — comportamento esperado com `qwen3:1.7b`, veja
[Sobre o tamanho do modelo](#sobre-o-tamanho-do-modelo). Confirme que o pipeline
está bom com `npm run pay-once` e `npm run demo`.

**`ECONNREFUSED 127.0.0.1:11434`** — o Ollama não está rodando (`ollama serve`).

**Mudei `MODEL_PROVIDER` e nada mudou** — o `.env` só é lido na subida do
processo. Reinicie o `npm run dev` e confira o provider no cabeçalho da
interface.

**`Could not load credentials from any providers`** — `MODEL_PROVIDER=bedrock`
sem sessão AWS ativa. Rode `aws sso login --profile <perfil>`, defina
`AWS_PROFILE` no `.env` e reinicie.

**Saldo insuficiente** — o faucet credita uma vez por carteira por execução do
facilitator. Reinicie o `npm run dev` para zerar o ledger.

---

## Exercícios sugeridos

1. **Baixe o orçamento** para `$0.05` e observe o agente ser recusado pela
   política ao tentar a segunda compra.
2. **Adicione uma API ao catálogo** (`packages/shared/src/catalog.ts` + rota e
   fixture no seller) e veja o agente descobri-la sozinha via
   `list_premium_catalog`.
3. **Encareça a ConnectionRisk** para `$0.50` e veja se o agente decide que não
   vale mais a pena.
4. **Quebre a assinatura**: em `local-exact-evm.ts`, veja o que cada validação
   protege. Adultere um campo da autorização antes de enviá-la ao `/verify` e
   observe as recusas reais:

   | Adulteração | Motivo devolvido |
   |---|---|
   | valor da autorização | `invalid_exact_evm_payload_signature` |
   | destinatário | `invalid_exact_evm_payload_recipient_mismatch` |
   | `validBefore` no passado | `invalid_exact_evm_payload_authorization_valid_before` |
   | reenviar o mesmo nonce | `invalid_exact_evm_payload_authorization_nonce` |
5. **Faça o agente alcançar o `demo`**: compare `npm run demo` com
   `npm run agent` e ajuste o system prompt (`packages/agent/src/agent.ts`) ou o
   modelo até o agente chegar sozinho ao mesmo roteiro.
6. **Implemente o cenário de disruption** da seção 8 do documento: um voo
   atrasa e o agente precisa comprar informação nova em runtime.
