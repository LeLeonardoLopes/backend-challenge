# Como este Projeto foi Construído: Pair Programming com IA & Guia de Defesa

> **Declaração de Transparência e Metodologia de Engenharia**  
> *"Engenharia de software moderna não é fingir que sabe tudo de cabeça; é saber fazer as perguntas certas, validar premissas com rigor, orquestrar ferramentas avançadas e entender profundamente o que está rodando em produção."*

---

## 1. Por que este documento existe?

Sou um desenvolvedor em início de carreira, consciente do meu momento técnico, mas apaixonado por resolver problemas reais de alta complexidade.

Para este desafio da **Jungle Gaming**, tomei uma decisão consciente de transparência: em vez de esconder o uso de IA ou fingir anos de experiência com sistemas distribuídos de iGaming, utilizei um assistente de IA avançado como meu **Tech Lead / Pair Programmer Sênior**.

Porém, **há uma diferença abissal entre "gerar código no escuro e colar" e "dirigir a engenharia com pensamento crítico"**:

1. **Eu não aceitei código pronto sem entender:** Antes de digitar uma única linha de código, o projeto foi dividido em 5 módulos conceituais. Em cada módulo, eu exigia a explicação dos conceitos, os trade-offs e os cenários de falha.
2. **Me submeti a sabatinas ("provinhas"):** Ao final de cada módulo, o assistente me interrogava com perguntas difíceis de arquitetura. Eu respondi a todas com minhas próprias palavras para fixar o domínio antes de avançarmos.
3. **Exigi postura crítica e testes reais:** Quando o projeto parecia "pronto", recusei o elogio automático e exigi uma auditoria brutal contra a tabela de 100 pontos da Seção 14. Foi essa cobrança que nos levou a implementar o coletor de métricas Prometheus e os testes de morte do worker e concorrência na Outbox.
4. **Eu revisei e compreendo cada decisão:** Abri o VSCode, auditei os arquivos, executei os containers Docker no meu Desktop e rodei os testes de carga ao vivo.

---

## 2. Guia de Defesa: Como eu explico o projeto na entrevista

Aqui está como eu explico as decisões técnicas em palavras simples, humanas e sem jargões decorados:

### Pergunta 1: *"Por que vocês criaram uma classe `Money` em vez de usar `number` do JavaScript?"*
> **Minha resposta:**  
> *"Porque o tipo `number` do JavaScript usa ponto flutuante IEEE 754. Se você somar `0.10 + 0.20`, o resultado dá `0.30000000000000004`. Em um sistema de apostas, um erro de 1 centavo em milhões de transações quebra a contabilidade ou permite fraude. Criamos a classe imutável `Money` usando a biblioteca `Decimal.js` com escala fixa de 2 casas decimais e arredondamento bancário (`ROUND_HALF_EVEN`). Dinheiro nunca é manipulado como número solto no código; se a moeda for diferente ou o formato vier errado, o próprio domínio rejeita na entrada."*

### Pergunta 2: *"Como vocês garantem que duas apostas de R$ 80 disparadas no mesmo milissegundo em uma conta de R$ 100 não deixem o saldo negativo?"*
> **Minha resposta:**  
> *"Usamos uma estratégia de defesa em duas camadas:  
> 1. Na aplicação: usamos **Lock Pessimista** (`SELECT ... FOR UPDATE`) na tabela de carteiras dentro de uma transação SQL. Quando a primeira aposta chega, ela trava a linha da carteira. A segunda requisição tem que esperar. Quando a primeira debita R$ 80 e commita (saldo vira R$ 20), a segunda acorda, lê o saldo atualizado de R$ 20 e é rejeitada por saldo insuficiente (`INSUFFICIENT_FUNDS`).  
> 2. No banco de dados: adicionamos uma constraint nativa no PostgreSQL: `CHECK (balance >= 0)`. Mesmo que a aplicação sofresse um bug catastrófico, o próprio PostgreSQL impediria a gravação e abortaria a transação."*

### Pergunta 3: *"Por que vocês usaram o padrão Transactional Outbox? Não era mais fácil publicar direto no SQS logo após debitar?"*
> **Minha resposta:**  
> *"Publicar direto no SQS após debitar sofre do 'problema da escrita dupla' (Dual-Write Problem). Se o banco de dados commitar o débito, mas a internet cair ou o SQS falhar antes do envio, o jogador teve o dinheiro debitado, mas o evento nunca existiu no sistema. O inverso também é perigoso: publicar no SQS e o banco dar rollback.  
> Com o **Transactional Outbox**, o evento de saldo alterado é salvo na tabela `outbox_messages` **dentro da mesma transação SQL** que alterou o saldo. Se o banco der commit, o evento está garantido. Um worker em segundo plano lê essa tabela com `SKIP LOCKED` e publica no SQS com retry automático."*

### Pergunta 4: *"E se o SQS entregar a mesma mensagem duas vezes ou o worker morrer antes de dar o ACK?"*
> **Minha resposta:**  
> *"O SQS tem garantia de entrega 'at-least-once' (pelo menos uma vez), ou seja, duplicatas são inevitáveis. Para resolver isso, usamos o padrão **Inbox Pattern**: antes de processar qualquer mensagem da fila, verificamos na tabela `inbox_messages` se aquele `message_id` já foi gravado.  
> Se o worker morrer após o commit no banco mas antes de dar o `DeleteMessage` no SQS, a mensagem reaparecerá na fila. Quando o worker religar e pegá-la de novo, verá que ela já consta como `PROCESSED` no Inbox, não executará nenhum novo débito e apenas fará o ACK no SQS. Temos um teste automatizado (`test/concurrency/advanced-resilience.spec.ts`) que simula exatamente essa queda."*

### Pergunta 5: *"O que acontece quando uma transação de REFUND ou ROLLBACK chega ANTES da aposta correspondente?"*
> **Minha resposta:**  
> *"Em sistemas distribuídos com filas concorrentes, a rede pode inverter a ordem das mensagens. Se o estorno chegar antes da aposta existir, nós não descartamos nem quebramos a aplicação. A transação é gravada no banco com o status especial `PENDING_REFERENCE` e um evento é emitido.  
> Temos um worker em segundo plano (`PendingReferenceWorker`) com janela de tolerância (TTL de 30 segundos) que tenta reconciliar o estorno assim que a aposta original finalmente é processada. Se a aposta nunca chegar após o timeout, a transação é rejeitada com código específico."*

### Pergunta 6: *"Qual é o calcanhar de Aquiles dessa arquitetura? Onde ela atinge o limite?"*
> **Minha resposta (A resposta que impressiona avaliadores seniores):**  
> *"O calcanhar de Aquiles é a **Hot Wallet**. Como usamos `SELECT ... FOR UPDATE`, todas as operações da MESMA carteira são estritamente serializadas. Para um jogador humano (que clica poucas vezes por segundo), a latência é desprezível (menos de 5ms). Porém, se um bot ou um parceiro institucional fizer 1.000 apostas por segundo na mesma carteira, as transações vão enfileirar no banco e causar contenção de conexões.  
> A evolução de produção para esse cenário não é trocar por lock otimista (que causaria tempestade de retries), mas sim adotar **In-Memory Sequencing** particionado por `wallet_id` (via Redis com scripts Lua, Actor Model ou LMAX Disruptor) antes de persistir no banco. Além disso, o worker de Outbox atual faz polling a cada 1s; em altíssimo volume, substituiríamos o polling por **CDC (Change Data Capture)** via Debezium lendo o WAL do PostgreSQL sem onerar o banco."*

---

## 3. Resumo dos Módulos Construídos e Testados

| Módulo | O que foi construído | Como foi validado |
|---|---|---|
| **Domínio Financeiro** | Value Object `Money` com Decimal.js, Entidades `Wallet`, `WalletLedgerEntry` (append-only) e `WagerTransaction`. | Testes unitários com validação de escala de 2 casas, arredondamento e moeda ISO. |
| **Idempotência Canônica** | Hash SHA-256 canônico recursivo ordenado por chaves + constraint única no PostgreSQL `(provider_id, idempotency_key)`. | Testes de 50 requisições simultâneas e teste de payload conflitante (409 Conflict). |
| **Concorrência Real** | Lock pessimista `PESSIMISTIC_WRITE`, cluster de 3 nós simultâneos e constraint `CHECK balance >= 0`. | Teste de carga com 200 requisições concorrentes e teste de cluster real com 3 instâncias. |
| **Resiliência Distribuída** | Outbox com `SKIP LOCKED`, SQS FIFO, Inbox Deduplication e Reconciliador de `PENDING_REFERENCE`. | Teste de simulação de morte do worker após commit, teste de 2 publishers simultâneos e teste de restart de serviço. |
| **Observabilidade** | Structured JSON Logging, `/health/live`, `/health/ready` e coletor de métricas Prometheus (`/metrics`). | Endpoint de métricas cobrindo transações por status, conflitos de lock, outbox lag e latência percentil. |

---

## 4. O que eu aprendi nesse processo?

- Que **consistência contábil é matemática**: o saldo materializado da carteira deve ser sempre igual à soma de todas as entradas do ledger histórico (`wallet.balance == sum(ledger)`).
- Que **em sistemas distribuídos, a rede vai falhar, duplicar e inverter mensagens**: você não projeta torcendo para que a rede funcione; você projeta sabendo que ela vai falhar e implementa Outbox, Inbox e Idempotência para se proteger.
- Que **trabalhar com IA não substitui o raciocínio**: a IA é um copiloto poderoso, mas quem define as regras, cobra qualidade, audita a segurança e responde pelo sistema em produção é o engenheiro.
