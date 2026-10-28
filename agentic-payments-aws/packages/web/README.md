# web

Página do chat (Next.js, export estático). Em produção fica no S3 atrás do CloudFront; o
backend são as Lambdas do `agentic-payments-aws`.

- **Login:** Cognito managed login, authorization code + PKCE (`oidc-client-ts` /
  `react-oidc-context`). Sem login, a página só mostra o botão "Entrar".
- **Uma conversa = uma sessão no DynamoDB.** Só a mensagem nova vai para `POST /chat`; o
  histórico fica no servidor. A barra lateral lista as conversas, abre o histórico de cada uma
  e apaga.
- **Streaming:** a resposta chega em NDJSON (`session`, `message`, `tool`, `done`, `error`).
- Passe o mouse sobre uma mensagem sua para ver as ferramentas chamadas naquele turno, com
  argumentos e retorno. O system prompt agora fica no servidor (`packages/chat/src/prompt.ts`).

## Configuração

A página lê a configuração em runtime, então o mesmo build serve qualquer ambiente:

- **Produção:** `/config.json`, publicado pelo CDK junto do site.
- **Dev:** `/config.local.json`. Gere a partir das saídas do stack já implantado (só lê da
  AWS, com as suas credenciais):

```bash
npm run config:local -w @agentic-aws/web            # opções: --stack, --region, --profile
npm run dev -w @agentic-aws/web                      # http://localhost:3000
```

`http://localhost:3000/` já está nos callbacks do Cognito e no CORS das Lambdas. Um 401 do
próprio API Gateway (token inválido) só libera CORS para o domínio do CloudFront, então em
localhost ele aparece como erro de rede.

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run dev` | `next dev` |
| `npm run build` | gera `out/`, que o CDK publica no S3 |
| `npm run check` | testes de `turns.ts`/`api.ts`, lint, build e typecheck |
| `npm run config:local` | escreve `public/config.local.json` a partir do stack |
