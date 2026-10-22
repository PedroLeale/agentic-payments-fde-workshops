# Simulador de idempotência

Demo ao vivo da apresentação *Idempotência em APIs de Pagamento*.

```bash
npm install
npm run dev     # API em :3001 + front em http://localhost:5173
npm test        # os 4 cenários do slide, direto contra a API
```

## Como usar na apresentação

Os botões do topo rodam os 4 cenários do slide "Demo ao vivo":

| # | Cenário | Sem idempotência | Com idempotência |
|---|---------|------------------|------------------|
| 1 | Sem chave + timeout | cobrança dupla | — |
| 2 | Com chave + timeout | — | 1 cobrança só (resposta salva devolvida) |
| 3 | Clique duplo | 2 cobranças | `409 Conflict`, nada duplicado |
| 4 | Mesma chave, outro valor | — | `422 Unprocessable` |

**Forçar erro manualmente:** clique no fio entre "App do cliente" e "API de pagamento". O fio fica tracejado (⚡) e a
**próxima** resposta é perdida: a API cobra, mas o cliente recebe erro de rede e faz retry (backoff exponencial + jitter).

## API

| Rota | O que faz |
|------|-----------|
| `POST /api/sem-idempotencia/pagamentos` | Cobra sempre. |
| `POST /api/com-idempotencia/pagamentos` | Exige `Idempotency-Key`. Chave nova → 201; concluída → mesma resposta (`Idempotent-Replayed: true`); em processamento → 409; outro payload → 422. |
| `GET /api/estado` | Cobranças e tabela de chaves. |
| `DELETE /api/estado` | Reseta tudo. |

Header `X-Simular-Falha: perder-resposta` faz a API processar e cortar a conexão antes de entregar a resposta.
Estado em memória (em produção: `UNIQUE(cliente, chave)` + hash do payload + TTL).
