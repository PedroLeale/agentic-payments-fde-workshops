# Agentic Travel — Pay-per-Intelligence com x402

## 1. Ideia do projeto

Construir um **agente de viagens com wallet própria** capaz de montar e otimizar itinerários utilizando APIs gratuitas e **APIs premium pagas por request via x402**.

A proposta não é o agente comprar passagens ou hotéis diretamente. O foco é permitir que ele **compre inteligência premium sob demanda** para tomar decisões melhores durante o planejamento da viagem.

Exemplos:

- prever se o preço de uma passagem tende a cair;
- avaliar risco de perder uma conexão;
- consultar pontualidade histórica de um voo;
- verificar disponibilidade real de assentos;
- identificar eventos que podem pressionar preço de hotéis;
- consultar filas ou congestionamento em atrações;
- avaliar risco climático;
- encontrar alternativas durante atrasos ou cancelamentos.

A principal tese do projeto é:

> **O agente pode gastar centavos em informações premium para melhorar decisões que envolvem centenas ou milhares de dólares.**

---

## 2. Por que Agentic Payments agrega valor

No modelo tradicional, o desenvolvedor do agente precisaria previamente:

1. escolher os provedores;
2. criar contas;
3. contratar planos ou assinaturas;
4. obter API keys;
5. integrar billing;
6. manter contratos mesmo para serviços pouco utilizados.

Com x402, uma API premium pode ser consumida de forma muito mais granular:

```text
Agent
  |
  | GET /premium-resource
  v
Provider
  |
  | 402 Payment Required
  | Price: $0.03
  v
Agent
  |
  | Vale a pena pagar?
  |
  +-- não --> busca alternativa
  |
  +-- sim --> pagamento x402
                |
                v
            Provider
                |
                | 200 OK + premium data
                v
              Agent
```

O agente passa a adquirir capacidades **apenas quando a necessidade surge**.

---

## 3. Cenário principal

Exemplo de pedido do usuário:

> Quero viajar de São Paulo para Tóquio entre 10 e 20 de outubro. Tenho flexibilidade de dois dias. Quero minimizar custo, mas evitar conexões arriscadas. Monte a melhor opção.

O agente começa com informações gratuitas:

```text
Opção A
GRU -> LAX -> HND
US$ 920
Conexão: 1h35

Opção B
GRU -> DOH -> HND
US$ 1.080
Conexão: 3h10

Opção C
GRU -> JFK -> NRT
US$ 870
Conexão: 1h20
```

Preço sozinho não é suficiente.

O agente então decide quais informações premium justificam o custo antes de recomendar a melhor opção.

---

## 4. Comportamento esperado do agente

O agente deve receber:

```text
Goal
+ preferências do viajante
+ restrições
+ orçamento para APIs premium
```

Exemplo:

```text
Objetivo:
Planejar viagem para Tóquio

Budget de inteligência:
US$ 0,25

Prioridades:
1. evitar conexões arriscadas
2. minimizar preço
3. evitar grande chance de atraso
```

### Fluxo de decisão

1. Interpretar o objetivo do usuário.
2. Buscar alternativas usando dados gratuitos.
3. Identificar incertezas relevantes.
4. Consultar o catálogo de APIs premium disponíveis.
5. Avaliar:
   - relevância da informação;
   - preço;
   - budget restante;
   - potencial impacto na decisão.
6. Chamar a API escolhida.
7. Receber `HTTP 402 Payment Required`.
8. Decidir se vale a pena pagar.
9. Executar pagamento via x402.
10. Consumir o resultado.
11. Atualizar o budget restante.
12. Reavaliar o plano.
13. Parar de comprar informações quando já houver evidência suficiente.
14. Produzir a recomendação final.
15. Mostrar quais informações premium foram compradas e quanto foi gasto.

---

## 5. Marketplace de APIs premium

O marketplace pode ser apenas um catálogo de APIs independentes. Não é necessário construir checkout, cadastro de sellers ou subscriptions.

### 5.1 FarePulse

**Capacidade:** previsão de preço de passagens.

```http
GET /fare-forecast
```

Preço hipotético:

```text
US$ 0,03 / request
```

Exemplo de resposta:

```json
{
  "currentPrice": 1080,
  "currency": "USD",
  "dropProbability72h": 0.73,
  "expectedRange": {
    "min": 940,
    "max": 990
  },
  "recommendation": "WAIT"
}
```

Uso pelo agente:

> A passagem está custando US$ 1.080. Vale comprar agora ou esperar?

---

### 5.2 ConnectionRisk

**Capacidade:** estimar risco de perder uma conexão.

```http
GET /connection-risk
```

Preço:

```text
US$ 0,04 / request
```

Entrada:

```text
Airport: LAX
Inbound flight: AA123
Outbound flight: JL456
Connection time: 1h35
```

Resposta:

```json
{
  "missProbability": 0.28,
  "recommendedMinimumConnection": "2h20",
  "risk": "HIGH"
}
```

Uso pelo agente:

> A opção mais barata possui conexão curta. Vale economizar US$ 160 assumindo esse risco?

---

### 5.3 FlightReliability

**Capacidade:** histórico de pontualidade e cancelamentos.

```http
GET /flight-reliability
```

Preço:

```text
US$ 0,02 / request
```

Resposta:

```json
{
  "onTimeRate": 0.71,
  "averageDelayMinutes": 38,
  "cancellationRate": 0.03
}
```

---

### 5.4 SeatWatch

**Capacidade:** disponibilidade e pressão de inventário.

```http
GET /seat-availability
```

Preço:

```text
US$ 0,02 / request
```

Resposta:

```json
{
  "availableSeats": 7,
  "fareClass": "Economy",
  "inventoryPressure": "HIGH"
}
```

Uso:

> Há risco de a tarifa atual desaparecer nas próximas horas?

---

### 5.5 AirportPulse

**Capacidade:** congestionamento, filas e delays no aeroporto.

```http
GET /airport-status
```

Preço:

```text
US$ 0,01 / request
```

Resposta:

```json
{
  "securityWaitMinutes": 52,
  "congestion": "HIGH",
  "departureDelayIndex": 0.74
}
```

---

### 5.6 HotelRatePro

**Capacidade:** inteligência de preço e disponibilidade de hotéis.

```http
GET /hotel-rate-intelligence
```

Preço:

```text
US$ 0,03 / request
```

Resposta:

```json
{
  "currentAverageRate": 210,
  "expectedRateIn48h": 245,
  "occupancyPressure": "HIGH",
  "recommendation": "BOOK_NOW"
}
```

---

### 5.7 EventsNow

**Capacidade:** eventos relevantes no destino e impacto esperado.

```http
GET /destination-events
```

Preço:

```text
US$ 0,01 / request
```

Resposta:

```json
{
  "events": [
    {
      "name": "Tokyo International Event",
      "expectedAttendance": 85000
    }
  ],
  "hotelDemandImpact": "HIGH"
}
```

---

### 5.8 AttractionPulse

**Capacidade:** previsão de filas e lotação de atrações.

```http
GET /attraction-forecast
```

Preço:

```text
US$ 0,01 / request
```

Exemplo:

```json
{
  "attraction": "teamLab",
  "monday": {
    "expectedQueueMinutes": 140
  },
  "tuesday": {
    "expectedQueueMinutes": 25
  }
}
```

O agente pode reorganizar o itinerário automaticamente.

---

### 5.9 WeatherRisk

**Capacidade:** risco climático especializado para o período da viagem.

```http
GET /weather-risk
```

Preço:

```text
US$ 0,02 / request
```

Exemplo:

```json
{
  "heavyRainProbability": 0.64,
  "typhoonRisk": "LOW",
  "recommendation": "MOVE_OUTDOOR_ACTIVITY"
}
```

---

### 5.10 EntryRules

**Capacidade:** regras migratórias e de trânsito internacional.

```http
GET /entry-rules
```

Preço:

```text
US$ 0,01 / request
```

Pode responder requisitos relacionados a:

- entrada no país;
- trânsito em conexão;
- documentação;
- vistos;
- regras específicas da rota.

---

## 6. Estratégia de uso das APIs

O agente não deve comprar todas as informações disponíveis.

Um comportamento desejado é trabalhar como um funil.

```text
50 opções possíveis
        |
        | dados gratuitos
        v
10 boas opções
        |
        | APIs premium baratas
        v
3 finalistas
        |
        | inteligência premium mais específica
        v
1 recomendação
```

Exemplo:

```text
Budget inicial: $0.25

ConnectionRisk       $0.04
FarePulse            $0.03
FlightReliability    $0.02
EventsNow            $0.01
HotelRatePro         $0.03
--------------------------
Total gasto          $0.13

Budget restante      $0.12
```

O agente não é recompensado por gastar todo o budget.

Ele deve buscar:

> **melhor decisão possível pelo menor custo de inteligência razoável.**

---

## 7. Exemplo end-to-end

Usuário:

> Planeje minha viagem de São Paulo para Tóquio. Quero economizar, mas não quero correr muito risco com conexões. Budget premium: US$ 0,20.

### Etapa 1 — Busca gratuita

```text
A: GRU -> LAX -> HND
Preço: $920
Conexão: 1h35

B: GRU -> DOH -> HND
Preço: $1.080
Conexão: 3h10
```

### Etapa 2 — Identificação de incerteza

O agente observa:

```text
A é $160 mais barata,
mas possui conexão curta em LAX.
```

Decisão:

```text
ConnectionRisk custa $0.04.

Impacto potencial:
evitar perda de conexão em uma viagem de ~$1.000.

Comprar.
```

Resultado:

```text
Missed connection probability: 28%
Risk: HIGH
```

### Etapa 3 — Avaliação da alternativa B

O agente quer descobrir se os US$ 1.080 representam um bom preço.

Compra:

```text
FarePulse
$0.03
```

Resultado:

```text
73% de chance de queda de preço nas próximas 72h.
Faixa esperada: $940-$990.
```

### Etapa 4 — Decisão

O agente recomenda:

```text
Não reservar a opção A devido ao alto risco de conexão.

Esperar até 72h antes de reservar a opção B,
pois há alta probabilidade de queda de preço.
```

### Resultado financeiro da inteligência

```text
Premium APIs utilizadas:

ConnectionRisk    $0.04
FarePulse         $0.03
-----------------------
Total             $0.07

Budget disponível $0.20
Budget restante   $0.13
```

A mensagem da demo:

> O agente gastou US$ 0,07 para melhorar uma decisão de aproximadamente US$ 1.000.

---

## 8. Cenário avançado — Travel Disruption Recovery

Uma evolução interessante é utilizar o mesmo marketplace após a viagem já ter começado.

Evento:

```text
FLIGHT DELAYED: +2h15
```

O agente detecta que existe risco de perder a próxima conexão.

Pode adquirir:

```text
ConnectionRisk          $0.02
AlternativeFlights      $0.03
SeatInventory           $0.03
AirportStatus            $0.01
HotelAvailability        $0.02
GroundTransportation     $0.01
```

Possível fluxo:

```text
Flight delayed
      |
      v
ConnectionRisk
      |
      | $0.02
      v
92% chance of missed connection
      |
      v
AlternativeFlights
      |
      | $0.03
      v
3 alternatives
      |
      v
SeatInventory
      |
      | $0.03
      v
1 viable alternative
```

Aqui a necessidade das APIs surgiu **em runtime**, reforçando ainda mais o valor de APIs pagas por uso.

---

## 9. Arquitetura conceitual

```text
                         USER
                           |
                Goal + Preferences
                Premium Budget
                           |
                           v
                 +------------------+
                 |   TRAVEL AGENT   |
                 |                  |
                 | Planner          |
                 | Travel Context   |
                 | Budget Policy    |
                 | x402 Client      |
                 | Wallet           |
                 +---------+--------+
                           |
                    Service Catalog
                           |
       +-------------------+--------------------+
       |                   |                    |
       v                   v                    v
 +-------------+     +-------------+      +-------------+
 | Flight APIs |     | Hotel APIs  |      | Local APIs  |
 |             |     |             |      |             |
 | FarePulse   |     | HotelRate   |      | EventsNow   |
 | Conn. Risk  |     | Inventory   |      | Attractions |
 | Reliability |     | Price Intel |      | Weather     |
 +------+------+     +------+------+      +------+------+
        |                   |                    |
        +-------------------+--------------------+
                            |
                           x402
                            |
                         Payment
```

---

## 10. Escopo sugerido para o workshop

Para manter o workshop pequeno e funcional:

### Buyer

- 1 Travel Agent;
- 1 wallet;
- budget configurável;
- x402 client;
- catálogo simples de APIs.

### Sellers

Implementar apenas 3 ou 4 APIs:

1. **FarePulse**
2. **ConnectionRisk**
3. **FlightReliability**
4. **HotelRatePro** ou **EventsNow**

Os dados podem ser mocks/fixtures.

O objetivo técnico não é construir integrações reais com companhias aéreas.

O objetivo é mostrar:

```text
discover
-> evaluate
-> 402
-> pay
-> consume
-> reason
```

---

## 11. Possível desafio do workshop

> # Build an AI Travel Agent with a Wallet
>
> Seu agente precisa montar a melhor viagem possível para o usuário.
>
> Ele pode utilizar fontes gratuitas e possui um pequeno orçamento para adquirir informações premium.
>
> Cada API premium cobra individualmente por request usando **x402**.
>
> O agente deve decidir:
>
> - qual informação precisa;
> - qual provider utilizar;
> - se a informação vale o preço;
> - quando parar de gastar.
>
> O objetivo não é gastar todo o budget.
>
> O objetivo é **tomar a melhor decisão possível dentro dele**.

---

## 12. Mensagem central da demo

> **Agentic Payments permite que agentes adquiram inteligência especializada no momento em que a necessidade aparece, pagando apenas pelo recurso utilizado.**

No contexto de viagens:

> **Spend cents on intelligence to make better decisions about a thousand-dollar trip.**

Ou, de forma ainda mais direta:

> **Subscriptions give software access to providers. Agentic Payments give agents the ability to acquire capabilities on demand.**
