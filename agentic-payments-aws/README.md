# agentic-payments-aws — o chat da loja na AWS

PoC que leva o `ollama-chat` + `ollama-tools` para a AWS:

- o modelo local vira **Claude Haiku 4.5 no Amazon Bedrock**;
- cada ferramenta vira **uma Lambda**, publicada como MCP pelo **AgentCore Gateway**;
- a rota do Next.js vira uma **Lambda com streaming** atrás do **API Gateway**;
- a memória sai do navegador e vai para o **DynamoDB** (uma sessão por conversa);
- a página fica no **S3 + CloudFront**, com login pelo **Cognito**.

Só existe o modo "histórico completo": quem guarda o histórico agora é o servidor.

---

## O que foi verificado e o que só um deploy confirma

O código foi escrito e testado **sem conta AWS**: nada foi implantado.

| Parte | Como foi verificado |
| --- | --- |
| Ferramentas (`get_time`, `list_items`) | testes da lógica e dos handlers; bundle do `cdk.out` executado |
| Cliente MCP do chat | contra um servidor MCP de verdade, em processo, com os nomes no formato do Gateway (`target___tool`) |
| Assinatura SigV4 para o Gateway | testada com credenciais fixas (serviço `bedrock-agentcore`) |
| Loop do chat, streaming NDJSON, gravação do histórico | modelo, DynamoDB e Gateway falsos; inclui recusa, corte por `max_tokens`, teto de rodadas e turnos simultâneos |
| Comandos do DynamoDB | testes do que o store envia (chaves, condições, paginação, lotes) |
| Rotas de sessão | todas as rotas, inclusive sessão de outro usuário |
| Infraestrutura | `cdk synth` + assertions no template (auth, streaming, IAM, Gateway, Cognito, S3) |
| Front | lint, `next build` com export estático, testes do leitor de NDJSON e do histórico |

**Só um deploy confirma** (é a lista do [smoke test](#smoke-test-depois-do-deploy)):

- streaming do API Gateway junto com o authorizer do Cognito (não há doc da AWS com os dois);
- o formato real do evento que o Gateway entrega às Lambdas e da resposta do `callTool`;
- se o IAM do Bedrock (`InvokeModel*` no inference profile e no modelo) basta;
- o login de ponta a ponta no navegador.

---

## Arquitetura

```text
           ┌──────────── Cognito (managed login, PKCE, cliente público)
           │ ID token
Navegador ── CloudFront ── S3 (privado, OAC): index.html + config.json
   │
   │  Authorization: Bearer <ID token>
   ▼
API Gateway REST (us-east-1, authorizer do Cognito em todo método, 10 req/s)
   ├─ POST   /chat                    → chat-fn     (STREAM, NDJSON, até 5 min)
   ├─ GET    /sessions                → sessions-fn
   ├─ GET    /sessions/{id}/messages  → sessions-fn
   └─ DELETE /sessions/{id}           → sessions-fn

chat-fn ──MCP + SigV4──▶ AgentCore Gateway (inbound AWS_IAM)
   │                         ├─ target "time"    → get-time-fn
   │                         └─ target "catalog" → list-items-fn
   ├─ Bedrock (bedrock-runtime): us.anthropic.claude-haiku-4-5-20251001-v1:0
   └─ DynamoDB: lê o histórico, grava o turno
```

**Um turno no `POST /chat`:** a página manda só `{ sessionId?, message }`. A Lambda:

1. valida o JWT (já feito pelo authorizer) e usa o `sub` como dono da sessão;
2. cria a sessão se não veio `sessionId`; manda `{"session":{"id":...}}` como primeira linha;
3. lê o histórico do DynamoDB, lista as ferramentas no Gateway e chama o Claude com
   streaming, repassando o texto em linhas `{"message":...}`;
4. se o modelo pedir ferramenta, chama via MCP, manda `{"tool":...}` e repete (até 4 rodadas);
5. grava o turno inteiro numa transação e fecha com `{"done":true}`.

**Por que o histórico é gravado assim:** cada mensagem é gravada **exatamente como veio** do
modelo, só se acrescenta, e um turno que falha (recusa, erro, corte) não grava nada, para o
histórico nunca ficar com meio turno. O TTL de 30 dias conta da criação da sessão, para a
conversa inteira vencer de uma vez.

---

## Pacotes

| Pacote | O que tem |
| --- | --- |
| `packages/shared` | chaves do DynamoDB, tipos das linhas NDJSON e da API de sessões, CORS. Sem dependências: o front importa os tipos |
| `packages/store` | sessões e mensagens no DynamoDB (usado pelo chat e pelas sessões) |
| `packages/tools` | `tools.ts` (do `ollama-tools`), um handler por ferramenta, `tool-schemas.json` — a fonte única dos esquemas que o Gateway publica |
| `packages/chat` | Lambda de streaming: Bedrock, cliente MCP do Gateway, loop de ferramentas. System prompt em `src/prompt.ts` |
| `packages/sessions` | Lambda de listar, ler e apagar conversas |
| `packages/web` | Next.js com export estático, login com Cognito — veja [`packages/web/README.md`](./packages/web/README.md) |
| `infra` | stack CDK (`lib/stack.ts`) e o teste do template |

---

## Rodando os testes

Node 22.

```bash
npm install
npm run check      # todos os pacotes: testes, typecheck, lint e build do front, teste do stack
npm run synth      # build do front + cdk synth (não precisa de credencial AWS)
```

---

## Deploy

### Antes do primeiro deploy

1. **Credenciais** de uma conta de dev/sandbox na sessão (`AWS_PROFILE` ou `aws sso login`).
2. **Acesso ao Claude Haiku 4.5 no Bedrock** em us-east-1.
3. **Bootstrap do CDK** na conta/região, uma vez:
   ```bash
   npm run cdk -w @agentic-aws/infra -- bootstrap aws://<conta>/us-east-1
   ```
4. **Prefixo do domínio de login.** É único por região em toda a AWS e não pode conter
   `aws`, `amazon` nem `cognito`. O padrão é `agentic-pay-poc-fellowship`.

### Deploy

```bash
npm run deploy                                    # outro prefixo: -- -c loginDomainPrefix=<prefixo>
```

Faz o build do front e o `cdk deploy`. As saídas que importam:

| Saída | Para quê |
| --- | --- |
| `SiteUrl` | abrir o chat |
| `UserPoolId` | criar usuários |
| `ApiUrl`, `UserPoolClientId`, `LoginDomain` | já vão no `config.json` do site |
| `GatewayUrl`, `TableName` | depurar |

### Primeiro usuário

Não há auto-cadastro. Crie pelo console do Cognito ou pela CLI (o Cognito manda uma senha
temporária por e-mail; no primeiro login a página pede uma nova):

```bash
aws cognito-idp admin-create-user --region us-east-1 \
  --user-pool-id <UserPoolId> \
  --username <email> \
  --user-attributes Name=email,Value=<email> Name=email_verified,Value=true
```

### Rodar o front local contra o stack

```bash
npm run config:local -w @agentic-aws/web   # lê as saídas do stack → public/config.local.json
npm run dev:web                            # http://localhost:3000
```

---

## Smoke test depois do deploy

- [ ] Abrir `SiteUrl`: aparece "Entrar"; o login do Cognito abre e volta para a página.
- [ ] `POST /chat` sem token → **401**.
- [ ] "Que horas são?" → o texto chega aos poucos, não de uma vez no fim; o painel lateral
      mostra `get_time` com o horário de Brasília.
- [ ] "Quanto custa o PlayStation?" → `list_items` e **R$ 4.799,00**.
- [ ] Pergunta de seguimento ("e o monitor?") usa o contexto anterior.
- [ ] Recarregar a página: a conversa aparece na barra lateral e o histórico volta igual.
- [ ] Usuário B não abre nem apaga a conversa do usuário A (**404**).
- [ ] Apagar uma conversa: some da lista; no DynamoDB a sessão e as mensagens somem.
- [ ] Nos logs do CloudWatch das Lambdas não aparece o texto de nenhuma mensagem.
- [ ] `tools/list` no Gateway devolve **só** `time___get_time` e `catalog___list_items`.

Para ver o streaming cru, pegue o `id_token` no DevTools (Session Storage, chave
`oidc.user:...`) e:

```bash
curl -N "$API_URL/chat" \
  -H "Authorization: Bearer $ID_TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"Quanto custa o monitor?"}'
```

Se o streaming não funcionar, comece pelo log da `ChatFn` e pela integração do `POST /chat`
no console do API Gateway (modo de transferência `STREAM`).

---

## Custos e limites

- **Bedrock:** por token (Claude Haiku 4.5).
- **Teto:** throttling de 10 req/s (rajada de 20) no stage; mensagem de até 4.000 caracteres;
  até 4 rodadas de ferramenta por mensagem.
- O resto (API Gateway, Lambda, DynamoDB on-demand, AgentCore Gateway, CloudFront, logs de
  2 semanas) é por uso.

---

## Removendo

Todos os recursos têm a tag `project=agentic-payments-aws`. O `cdk destroy` deixa a tabela do
DynamoDB e o User Pool do Cognito (`RETAIN`). A remoção completa, passo a passo, está no
[README da infra](./infra/README.md#remoção-completa).

---

## Decisões e limitações conhecidas

- **CORS dos erros do próprio API Gateway** (401 do authorizer, 429 do throttling) libera só o
  domínio do CloudFront. Em `localhost` esses erros aparecem como falha de rede.
- **Tokens no `sessionStorage`** (padrão do `oidc-client-ts`). Normal para SPA, mas um XSS
  leria o token. O CloudFront usa a política de security headers padrão, sem CSP.
- **Gateway sem busca semântica:** o padrão do construct ligava, e isso publica uma ferramenta
  a mais que o chat repassaria ao modelo.
- **Mensagem com erro some ao recarregar:** um turno que falha não é gravado (o histórico não
  pode ficar com meio turno), então só existe na tela até recarregar.
