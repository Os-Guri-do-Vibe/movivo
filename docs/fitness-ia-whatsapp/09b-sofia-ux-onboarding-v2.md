# 09b — UX do Onboarding v2: wizard de 3 etapas e telas de sucesso (US-6.1)

**Autora:** Sofia Almeida (Senior Product Designer / UX-UI — agente #09)
**Data:** 2026-08-10
**Tipo:** extensão do `09-relatorio-sofia.md` (não o substitui). Onde este documento e o 09 divergirem, **este vale** para o onboarding v2.
**Escopo:** US-6.1 da `sprint/sprint-6-onboarding-em-etapas.md` — TASK-6.1.1 a 6.1.4.
**Consumidor primário:** Felipe (US-6.10 e US-6.11). **Consumidor secundário:** Leonardo (contratos que a UI precisa receber — §9).
**Design system:** "O Pulso" (Kimura, tokens em `09-relatorio-sofia.md` §15). **Nenhum token, cor, fonte ou componente novo de marca é criado aqui.**

---

## 0. Como ler / regras de leitura para o Felipe

1. Tudo que está entre aspas em bloco `> copy:` é **texto final**. Não reescrever, não "melhorar", não traduzir para outro tom. Se algo parecer errado, é ticket para Sofia/Lucas, não edição no código.
2. Onde eu escrevi **PENDÊNCIA**, o valor não está fechado. Implementar com o valor provisório indicado e deixar o valor em constante nomeada num único lugar, para trocar sem caçar string. Não inventar.
3. Nenhum comportamento de UI aqui substitui validação de servidor. Toda regra abaixo (18+, limite de 2 ênfases, consentimento travando bloco de saúde, escolha da variante de sucesso) é **UX de antecipação de erro**; a autoridade é o backend.
4. O texto dos consentimentos **vem do backend** (US-6.2/6.4). Este documento especifica **a forma**, nunca o conteúdo jurídico. Não hardcodar texto de consentimento no front.

---

## 1. Decisão central do fluxo: o que a barra de progresso mede

### 1.1 A decisão

A barra de progresso representa **3 etapas rotuladas**, e a etapa 2 tem **sub-progresso interno visível apenas quando o usuário está dentro dela**.

Motivo: são ~40 campos. Uma barra de 3 passos secos deixa o usuário 20 minutos "no passo 2" sem nenhum sinal de avanço — é exatamente o ponto onde formulário longo morre. E uma barra de 8 passos (3 + 5 seções) na primeira tela comunica "isso é enorme" e mata a conversão na entrada. A composição resolve os dois: **fora da etapa 2 o usuário vê 3 passos; dentro dela vê onde está entre 5 seções.**

```
┌──────────────────────────────────────────┐
│  Você  ·  Sua rotina de treino  ·  Saúde │   ← rótulos, sempre os 3 visíveis
│  ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░  │   ← barra macro (0-100%)
│  Passo 2 de 3 · Objetivos (1 de 5)       │   ← linha de contexto (só na etapa 2)
└──────────────────────────────────────────┘
```

**Rótulos das 3 etapas** (curtos, cabem em 360px):

| Etapa | Rótulo na barra | Conteúdo |
|---|---|---|
| 1 | **Você** | cadastro pessoal, 18+, WhatsApp + verificação por código, consentimentos |
| 2 | **Sua rotina de treino** | anamnese em 5 seções |
| 3 | **Saúde** | PAR-Q + 3 confirmações finais |

> Nota de copy: a etapa 3 se chama **"Saúde"**, não "PAR-Q" (sigla não significa nada para o usuário) e não "Avaliação de risco" (soa clínico). A seção 4 da etapa 2 (dores) vive dentro de "Sua rotina de treino" — não abrimos um rótulo "dor" na barra, porque nomear a dor na navegação a torna a moldura da experiência inteira.

### 1.2 Fórmula da barra macro

Progresso é **linear por sub-passo concluído**, não por etapa:

```
sub-passos totais = 1 (etapa 1) + 5 (seções da etapa 2) + 1 (etapa 3) = 7
progresso % = (sub-passos concluídos / 7) * 100
```

A verificação de WhatsApp **não conta como sub-passo** (é um gate dentro da etapa 1, não conteúdo). A barra **nunca chega a 100% antes do FINALIZAR AVALIAÇÃO** — o último 1/7 só fecha na submissão da etapa 3. Progresso que chega a 100% e ainda pede ação é quebra de confiança.

Animação: transição de largura 240ms `ease-out`. Respeitar `prefers-reduced-motion` (troca instantânea, sem transição).

### 1.3 Navegação

- **Avançar:** botão `CONTINUAR` no rodapé de cada sub-passo. Um sub-passo = uma tela. Nunca duas seções na mesma tela.
- **Voltar:** seta `←` no canto superior esquerdo, **sempre disponível a partir do segundo sub-passo**, e nunca destrutiva — voltar preserva tudo que foi digitado, inclusive na tela atual (salvar antes de navegar).
- **Voltar do primeiro sub-passo da etapa 2** leva ao último estado da etapa 1 em **modo revisão**: campos preenchidos, editáveis, exceto o telefone verificado (§4.6).
- **Voltar não desfaz side-effects de servidor.** Voltar da etapa 3 para a 2 não apaga o PAR-Q já respondido; ele reaparece preenchido se o usuário avançar de novo.
- **Sem navegação livre por clique nos rótulos da barra.** A barra é indicador, não menu. Permitir pular para a etapa 3 antes da 2 cria estados parciais que o backend recusa e o usuário não entende. Os rótulos não são interativos (`aria-hidden` no decorativo, o estado real vai no `aria-valuetext` da barra — §8).
- **Sem botão "pular"**. Campo opcional se resolve deixando vazio e apertando CONTINUAR; a copy do campo diz "(opcional)".

### 1.4 Salvamento e retomada — como isso aparece na tela

O mecanismo já existe (token opaco, 72h, `PATCH /anamnesis/{token}/step/{n}`). O que falta é **o usuário saber que existe**, porque quem não sabe que pode voltar não sai — abandona.

Três momentos, todos discretos:

**(a) Toast de confirmação, na transição de sub-passo.** Aparece por 2,5s no rodapé, acima do botão, após cada `PATCH` bem-sucedido:

> copy: **Salvo. Dá pra sair e voltar depois.**

Só a partir do **segundo** sub-passo salvo (no primeiro o usuário ainda não investiu nada e o toast vira ruído). Nunca bloqueia interação. `role="status"`, `aria-live="polite"`.

**(b) Linha permanente no rodapé da etapa 2 e 3**, abaixo dos botões, tipografia label 13px, cor Musgo:

> copy: **Suas respostas ficam salvas por 3 dias. Você pode continuar de onde parou.**

**(c) Tela de retomada**, quando o usuário abre o link com token válido e `lastStep > 1`:

```
┌───────────────────────────────┐
│  Bem-vindo de volta, Bruno.   │
│                               │
│  Você parou em                │
│  "Sua rotina de treino".      │   ← nome do sub-passo, não "passo 2"
│  Suas respostas estão aqui.   │
│                               │
│  [  Continuar de onde parei ] │   primário
│  [  Revisar desde o começo  ] │   secundário (leva ao sub-passo 1, dados intactos)
└───────────────────────────────┘
```

**(d) Falha de salvamento.** Se o `PATCH` falhar, **não navegar**. Banner Coral inline acima do botão:

> copy: **Não consegui salvar agora. Tenta de novo em instantes — o que você digitou está aqui.**

Botão vira `TENTAR DE NOVO`. Nunca perder o estado local. Nunca deixar o usuário avançar achando que salvou.

**(e) Token expirado (>72h).** Tela dedicada, tom de transparência, não de erro:

> copy:
> **Esse link expirou.**
> Por segurança dos seus dados, cadastros que ficam mais de 3 dias sem terminar são apagados. É rápido recomeçar — a maior parte você já sabe de cor.
> `[ Começar de novo ]`

---

## 2. Etapa 1 — Você

Sub-passo único, mas com **três blocos verticais** na mesma tela (identificação → WhatsApp → consentimentos). O gate de verificação do WhatsApp acontece **dentro** dessa tela, em overlay (§4).

### 2.1 Campos

| Campo | Tipo | Especificação |
|---|---|---|
| Nome | texto | label "Como te chamamos?", `autocomplete="given-name"`, primeiro nome basta. Foco automático ao carregar. |
| Data de nascimento | data | **3 campos numéricos separados** `DD / MM / AAAA`, `inputmode="numeric"`, avanço automático de foco entre eles. **Não usar `<input type="date">`** aqui: o date picker nativo abre no mês atual e obriga o usuário a rolar ~25 anos para trás. `autocomplete="bday-day/bday-month/bday-year"`. |
| Sexo biológico | seleção única (chips) | Rótulo: **"Sexo biológico"** + linha de ajuda: *"Usamos isso só para calibrar as referências de carga e volume do seu treino."* Opções conforme enum de Leonardo. A justificativa de finalidade na tela não é cortesia — é minimização visível (Alexandre, US-6.2). |
| WhatsApp | telefone | máscara `(xx) xxxxx-xxxx`, `inputmode="tel"`, `autocomplete="tel-national"`. Prefixo `+55` fixo, não editável, à esquerda do campo. Converter para E.164 no envio. Label de apoio: *"É por aqui que seu treino chega."* |
| E-mail | e-mail | label **"Seu e-mail (opcional)"**, `autocomplete="email"`, `inputmode="email"`. |
| Consentimentos | checkboxes | §2.3 |

### 2.2 Gate 18+

A validação de idade dispara **no blur do campo de ano**, não no CONTINUAR — descobrir aos 40 campos depois que você nunca poderia entrar é a pior forma de saber.

Menor de 18: a tela **não navega para lugar nenhum**. Substitui o formulário por um card centrado, fundo Petróleo Vivo, texto Névoa:

```
┌───────────────────────────────┐
│  No momento, a Movivo está    │   ← mensagem EXATA do fundador,
│  disponível apenas para       │      não alterar uma vírgula
│  maiores de 18 anos.          │
│                               │
│  Obrigada por querer treinar  │   ← acréscimo permitido (não altera
│  com a gente. Volte quando    │      a mensagem, complementa)
│  fizer 18.                    │
└───────────────────────────────┘
```

Sem botão de retry, sem "editar data" (isso ensina a mentir a idade). Um link secundário discreto: `Digitei minha data errado` → volta ao formulário com o campo focado. Uma volta apenas; o servidor é a autoridade de qualquer forma.

`role="alert"` no card, foco movido para ele.

### 2.3 Consentimentos — forma (o conteúdo é de Alexandre)

- Renderizar **exatamente** o array de consentimentos que o backend devolver, na ordem que vier. O front **não** conhece os tipos, não hardcoda textos, não reordena.
- **Nunca pré-marcado.** Nenhum `defaultChecked`, em nenhuma circunstância, nem em ambiente de teste/seed.
- Cada item: checkbox 24×24px real (alvo de toque 44×44 incluindo o label), texto em corpo 16px Grafite, links de Termos/Política abrindo em nova aba (`rel="noopener"`), **sem** tirar o usuário do formulário.
- Item **opcional** (newsletter) recebe o sufixo visual `(opcional)` em Musgo e fica **visualmente separado** por um divisor de 1px dos obrigatórios. O usuário precisa enxergar de relance o que é obrigação e o que é escolha.
- Item de **ciência** (IA supervisionada por CREF), se Alexandre o mantiver como item marcável, recebe o ícone de selo CREF do vocabulário de Kimura à esquerda. É o guardrail de marca aparecendo na tela mais legalista do produto — deve parecer credencial, não letra miúda.
- Botão `CONTINUAR` **desabilitado** (estado Musgo) até que todos os obrigatórios estejam marcados. Um botão desabilitado sem explicação é fricção cega — abaixo dele, quando desabilitado:

> copy: **Falta marcar as confirmações obrigatórias acima.**

  Essa linha tem `aria-live="polite"` e some quando a condição é satisfeita. O botão desabilitado permanece **focável** (`aria-disabled="true"` em vez de `disabled`) para que leitor de tela alcance a explicação.

### 2.4 Ordem dentro da etapa 1

Identificação → WhatsApp (+ verificação) → consentimentos → CONTINUAR.

A verificação do número acontece **antes** dos consentimentos, não depois do CONTINUAR. Motivo: verificar posse do canal é a coisa mais próxima de "prova de identidade" que temos, e ela precisa acontecer antes de o usuário assinar qualquer coisa. Também evita o pior estado possível — usuário aceita 4 consentimentos, aperta continuar, e aí descobre que precisa pegar o celular.

---

## 3. Etapa 2 — Sua rotina de treino (5 seções)

Um sub-passo por seção. Ordem e rótulos:

| # | Rótulo (linha de contexto) | Conteúdo |
|---|---|---|
| 2.1 | **Objetivos** | objetivo principal (9 + Outro), até 2 regiões de ênfase (11), data/evento importante |
| 2.2 | **Seu histórico** | treina hoje?, experiência com musculação, atividades já praticadas, barreiras de consistência |
| 2.3 | **Sua rotina** | dias/semana, quais dias, tempo por treino, onde treina, período preferido, outro esporte |
| 2.4 | **Dores e limitações** | seção sensível — §5 |
| 2.5 | **Preferências** | exercício que não quer fazer |

**Cada seção abre com uma linha de propósito**, uma frase, Musgo, 14px, acima do primeiro campo. Não é decoração: é o que faz um formulário longo parecer uma conversa com propósito em vez de um interrogatório.

> 2.1 — *"Pra onde estamos indo."*
> 2.2 — *"De onde você está partindo."*
> 2.3 — *"O que cabe na sua semana de verdade."*
> 2.4 — *"Isso é o que mantém seu treino seguro."*
> 2.5 — *"O que você prefere não fazer."*

### 3.1 Objetivo principal — 9 opções + Outro

Seleção única em **lista de cards verticais** (não chips): 9 opções com texto de 2 a 5 palavras não cabem em chips lado a lado em 360px sem quebrar de forma feia. Cada card: 100% de largura, min-height 56px, radio semântico, borda 1px Musgo, selecionado = borda 2px Verde Pulso + fundo Petróleo Vivo com texto Névoa.

`Outro` é o 10º card. Ao selecioná-lo, revela **imediatamente abaixo dele** (não no fim da lista) um campo de texto:

> copy do label: **Conta em poucas palavras qual é seu objetivo.**
> placeholder: *ex.: voltar a jogar bola sem cansar*
> limite: 120 caracteres, contador visível a partir de 100.

Desmarcar `Outro` limpa o campo e o remove (com confirmação implícita: se havia texto, o campo colapsa mas o texto é mantido em memória por se o usuário voltar — não fazer o usuário redigitar por um toque errado).

### 3.2 Regiões de ênfase — máximo 2, com ícone

Ver §6 (componente `BodyRegionPicker`) para a especificação completa. Regra de seleção aqui:

- Limite **2**. Ao atingir 2, as demais opções vão para estado **desabilitado visual** (opacidade 45%, sem borda de hover) e ganham `aria-disabled="true"` — **mas continuam focáveis e clicáveis**. Clicar numa opção desabilitada **não** faz nada silenciosamente: mostra a mensagem de limite.

  > copy (aria-live polite, aparece abaixo da grade): **Dá pra escolher até 2. Toque numa das que já escolheu para trocar.**

  Bloquear o clique sem dizer nada é o erro clássico aqui — o usuário acha que quebrou.
- **"Corpo todo, sem preferência"** é **mutuamente exclusiva**: selecioná-la limpa as outras duas e desabilita a grade inteira; selecionar qualquer região limpa "Corpo todo". Isso é comportamento de UI que espelha a regra de dado. **PENDÊNCIA #7 do documento de sprint** — o fundador precisa confirmar a exclusividade. **UX assume exclusiva** (é a leitura óbvia de "sem preferência") e recomendo confirmar, não redesenhar. Se a decisão vier ao contrário, o único ajuste é remover a limpeza mútua.
- Contador acima da grade, sempre visível: `Escolhidas: 0 de 2` (mono para os números, vocabulário do design system).
- Campo é **opcional**: 0 seleções é resposta válida e o CONTINUAR fica ativo. Nunca exigir ênfase.

### 3.3 Campos condicionais — a regra anti-pulo

Sete condicionais na etapa 2 (parado→há quanto tempo; evento→data+descrição; outro esporte→qual+dias; dor→seção 4 inteira; diagnóstico→qual; recomendação→o quê; exercício indesejado→qual). O risco é o layout "saltar" e o usuário perder o lugar.

**Regras obrigatórias, valem para todos os condicionais:**

1. O campo revelado aparece **imediatamente abaixo do gatilho**, dentro do mesmo card visual, com uma barra vertical de 2px Verde Pulso na margem esquerda ligando visualmente pergunta e follow-up. O usuário precisa ver que o campo novo é *filho* da resposta que ele acabou de dar.
2. **Nada abaixo se move de forma abrupta.** Revelação: altura 0→auto em 180ms `ease-out` + fade-in. Ocultação: 120ms. Com `prefers-reduced-motion`, sem animação (aparecimento instantâneo — o salto é preferível ao movimento para quem pediu para não ter movimento).
3. **Sem scroll automático.** Não roubar o scroll do usuário. O follow-up cabe acima da dobra na esmagadora maioria dos casos porque cada seção tem poucos campos; se não couber, o usuário rola — isso é esperado e não desorienta. Scroll programático em formulário é o que desorienta.
4. **Foco:** o foco **não** pula automaticamente para o campo revelado (roubaria o foco de quem navega por teclado no radio group). Em vez disso, o container do follow-up tem `aria-live="polite"` e anuncia o rótulo do novo campo. A ordem de tabulação natural leva ao campo revelado como próximo alvo — que é exatamente o comportamento desejado.
5. **Ocultar preserva o valor em memória**, mas **não envia ao servidor**. Se o usuário responde "sim, tenho dor", preenche, e depois volta para "não", o payload enviado **não** contém a seção 4. Reverter para "sim" traz de volta o que foi digitado. Nunca enviar dado de saúde de uma resposta que o usuário retirou.
6. Um follow-up revelado e não preenchido **bloqueia o CONTINUAR** com validação inline, igual a qualquer campo obrigatório. Revelar é tornar obrigatório.

### 3.4 Descrições dos níveis de experiência

A spec do fundador traz descrições escritas para iniciante/intermediário/avançado, e o documento de sprint diz explicitamente que essa copy **não pode ser reescrita**. Renderizar como card de seleção única em **duas linhas**: título (nível, 16px semibold) + descrição (14px Musgo, até 3 linhas, **sem truncar e sem "ler mais"**). O usuário se autoclassifica errado quando a descrição está escondida, e esse campo é o que finalmente alimenta `UserConstraints.level` — errar aqui contamina o protocolo inteiro. Vale a altura de tela.

### 3.5 Dias da semana × dias por semana

`Dias por semana` (1-7) e `quais dias` (seg-dom, múltipla) podem divergir. **PENDÊNCIA #7** — decisão do fundador.

**Comportamento de UI enquanto não houver decisão (implementar assim):** divergência **não bloqueia**, apenas informa, abaixo do seletor de dias:

> copy: **Você marcou 5 dias e disse que treina 3 vezes por semana. Tudo bem — vamos montar 3 treinos e você escolhe os dias.**

(números interpolados). Tom: sem erro, sem Coral, texto Musgo com ícone de informação. Se o fundador decidir que precisa bater, a mesma linha vira erro Coral e trava o CONTINUAR — a mudança é de severidade, não de layout.

---

## 4. Verificação do WhatsApp por código

### 4.1 Por que ela existe, dito ao usuário

O usuário não pediu para digitar código nenhum. Se a fricção não se justificar na hora, ela é lida como burocracia. **Antes** de disparar o código, texto de apoio permanente abaixo do campo de telefone:

> copy: **Seu treino chega por esse número. Vamos mandar um código no WhatsApp só para confirmar que ele é seu.**

Isso enquadra a verificação como proteção do que o usuário quer (o treino), não como desconfiança dele.

### 4.2 Fluxo e estados

Estado A → B → (C | D | E). Tudo acontece **dentro da etapa 1**, em um card/overlay que cobre o formulário, com o número visível no topo.

**Estado A — antes do envio.** Botão secundário ao lado/abaixo do campo de telefone: `ENVIAR CÓDIGO`. Habilitado só com telefone em formato válido e completo.

**Estado B — aguardando código:**

```
┌───────────────────────────────┐
│ ←                             │   ← volta a editar o número
│  Mandamos um código no seu    │
│  WhatsApp                     │
│                               │
│  +55 (11) 98888-7777          │   mono, com [ Trocar número ]
│                               │
│  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐     │   6 dígitos
│  │  ││  ││  ││  ││  ││  │     │   mono, 24px, alvo 48×56
│  └──┘└──┘└──┘└──┘└──┘└──┘     │
│                               │
│  Não chegou? Reenviar em 0:47 │   contador regressivo
│                               │
│  [  Confirmar  ]              │
└───────────────────────────────┘
```

- **Campo:** 6 caixas de 1 dígito. Implementar como **um único `<input>` real** (`inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength=6`, `aria-label="Código de 6 dígitos"`) com as caixas renderizadas por cima. Seis inputs separados quebram colar, quebram autofill de SMS/OTP e quebram leitor de tela. Um input, seis caixas visuais.
  - `autocomplete="one-time-code"` é obrigatório: em iOS o código aparece na sugestão do teclado. É a maior redução de fricção disponível aqui e custa um atributo.
- **Colar** um código de 6 dígitos preenche tudo.
- **Auto-submeter** ao completar o 6º dígito. O botão `Confirmar` continua existindo (para quem colou, para quem navega por teclado, e para retry), mas o caminho feliz não exige tocá-lo.
- **Estado de envio em curso:** botão com Pulso respirando (motion de Kimura), texto `Confirmando...`, campo bloqueado.

**Estado C — sucesso.** O overlay fecha, e o campo de telefone na etapa 1 ganha um selo Verde Pulso à direita: `✓ Verificado` (ícone + rótulo textual, nunca só cor). O número fica **somente leitura** com um link `Trocar número` (§4.6). Toast: **Número confirmado.**

**Estado D — código errado.**

> copy: **Esse código não confere. Confira os 6 dígitos e tenta de novo.**

Coral, inline abaixo do campo, `role="alert"`. Campo limpo e refocado. **Nunca** dizer quantas tentativas sobraram até restar a última (§4.4).

**Estado E — código expirado.**

> copy: **Esse código expirou. Pede um novo, leva um segundo.**

O botão principal vira `ENVIAR NOVO CÓDIGO`, habilitado imediatamente (o contador de reenvio não se aplica a um código já expirado — segurar o usuário nesse estado é fricção sem ganho de segurança).

### 4.3 Reenvio

- Contador de **60s** entre reenvios. Texto: `Não chegou? Reenviar em 0:47` → ao zerar vira link ativo `Reenviar código`.
- Clique duplo no reenvio **não** dispara dois envios: o botão desabilita no primeiro clique e o backend é idempotente na janela (US-6.5). A UI reflete isso reiniciando o contador e mostrando:

  > copy: **Enviamos de novo. Dá uma olhada no seu WhatsApp.**

- Após o **3º reenvio**, oferecer saída de suporte — usuário sem saída abandona o produto, não a tela:

  > copy: **Ainda não chegou? Confira se o número está certo ou fale com a gente.**
  > `[ Trocar número ]` `[ Falar com a gente ]`

### 4.4 Limite de tentativas atingido (rate limit)

Estado terminal temporário, precisa ser explícito e ter saída:

> copy:
> **Muitas tentativas seguidas.**
> Por segurança, espera alguns minutos antes de tentar de novo. Seus dados estão salvos.
> `[ Trocar número ]`

Nunca deixar o usuário preso sem nenhuma ação disponível. Nunca revelar se o número existe/está cadastrado (evita enumeração — Sato, US-6.5).

### 4.5 TTL do código — **PENDÊNCIA #9** (Sofia + Sato)

**Recomendação de UX: 10 minutos.** Justificativa: o usuário está com o celular na mão e o WhatsApp é o app mais aberto do aparelho — a mediana de leitura é de segundos. 10 min cobre o caso real de "o celular estava carregando na outra sala" sem manter uma credencial viva por tempo desnecessário. Abaixo de 5 min gera expiração no meio de uso real; acima de 15 min não melhora conclusão e só amplia janela de ataque. **Sato tem a palavra final e pode reduzir sem impacto de UX até 5 min.**

Não mostrar contador regressivo de expiração do código. Um relógio correndo em cima de uma pessoa digitando 6 dígitos gera erro. A expiração se comunica **quando acontece** (estado E), não antes.

### 4.6 Trocar número depois de verificado

Permitido, e obrigatoriamente **invalida a verificação**: o selo `✓ Verificado` some, o novo número precisa de novo código. Confirmação antes:

> copy: **Trocar o número? Você vai precisar confirmar o novo com um código.**
> `[ Trocar ]` `[ Cancelar ]`

---

## 5. Seção 4 — Dores e limitações

A seção mais delicada da etapa 2. Três decisões de UX:

**(a) Abre com uma pergunta-porta, não com a grade.**

> copy: **Você sente alguma dor hoje que atrapalha ou preocupa na hora de treinar?**
> `Sim` / `Não`

`Não` → o resto da seção não existe (nem renderiza), CONTINUAR direto. A esmagadora maioria dos usuários termina a seção 4 em um toque. Só quem tem dor vê o bloco inteiro. Isso é o condicional de maior impacto do formulário.

**(b) Tom.** Nenhuma copy desta seção pode sugerir avaliação clínica. Depois de `Sim`:

> copy: **Obrigada por contar. Isso é o que deixa seu treino seguro.**

Nada de "vamos entender seu problema", "sintomas", "quadro". A palavra **dor** é a única palavra clínica permitida aqui, porque é a palavra que a pessoa usa.

**(c) Campos** (todos revelados por `Sim`, nesta ordem): regiões de dor (múltipla, 10 opções — §6.3) → intensidade 0-10 (§7) → tendência (melhorando / estável / piorando / não sei) → o que provoca (texto livre, opcional, 300 caracteres) → diagnóstico profissional (sim/não → qual, 200 caracteres) → acompanhamento médico ou fisioterapêutico (sim/não) → recomendação de evitar algum movimento (sim/não → o quê, 200 caracteres).

Nota de copy sobre o campo de diagnóstico: o rótulo **não** pergunta "qual seu diagnóstico?" — pergunta pelo que o usuário **recebeu de um profissional**, o que mantém a MOVIVO fora do papel de quem diagnostica:

> copy do gatilho: **Algum profissional de saúde já te explicou o que é essa dor?**
> copy do follow-up: **O que ele te disse? (com suas palavras, tudo bem não lembrar o nome exato)**

Fecho da seção, sempre visível abaixo do último campo, com o ícone de cadeado/LGPD do vocabulário de Kimura:

> copy: **Isso fica guardado de forma protegida e só o profissional de Educação Física responsável tem acesso.**

Se o consentimento de saúde não tiver sido dado, a seção **não é renderizada** e o wizard segue direto para a seção 5 (o backend recusa a coleta de qualquer forma — regra 4 da sprint). Não mostrar seção travada com cadeado: isso convida o usuário a voltar e mudar um consentimento por curiosidade, o que é exatamente o oposto de consentimento livre.

---

## 6. Componente novo: `BodyRegionPicker` (ícones de região corporal)

### 6.1 A decisão de ícone — e por que não é um icon set pronto

`lucide-react` já está no projeto (`apps/web/package.json`) e é o vocabulário de ícones do produto. **Lucide não tem grupos musculares** — não tem peitoral, dorsal, posterior de coxa. Nenhum icon set genérico tem, e comprar/adicionar um pack de anatomia é dependência nova para 21 desenhos.

**Especificação: um único arquivo SVG com silhueta compartilhada + camada de destaque por região.**

```
<svg viewBox="0 0 48 64" aria-hidden="true">
  <path class="silhouette" d="…" />        ← 1 desenho, reusado nas 21 opções
  <path class="highlight" d="…" />         ← 1 path por região, trocado por prop
</svg>
```

- Silhueta: corpo humano de frente, traço 2px, cantos arredondados, cor Musgo — **mesmo vocabulário de Kimura** (linha, stroke 2px, grid 24px reescalado para 48×64).
- Destaque: preenchimento Verde Pulso com 20% de opacidade + contorno 2px Verde Pulso na região correspondente.
- Estado selecionado do botão: silhueta em Névoa sobre fundo Petróleo Vivo, destaque em Verde Pulso sólido.
- Costas (dorsais, posterior de coxa, glúteos, panturrilha) usam a **mesma silhueta frontal** com o destaque na posição anatômica correspondente. Duas silhuetas (frente/costas) dobrariam o trabalho de desenho e o usuário lê perfeitamente a região pelo rótulo + posição. **Se houver ambiguidade em teste, a única exceção candidata é "costas", que pode ganhar uma silhueta de dorso.**
- **O ícone nunca aparece sozinho.** Todo botão tem **ícone + rótulo textual**. O ícone acelera o reconhecimento; o rótulo é a informação. Isso não é preferência estética — é WCAG 1.4.1 e é o que impede que "quadríceps" e "posterior de coxa" virem adivinhação.

Entregável para o Felipe: `apps/web/src/components/anamnese/body-regions.tsx` com um mapa `regionId → path`. Único arquivo, sem dependência nova.

### 6.2 As 11 regiões de ênfase

Grade **2 colunas** em mobile, 3 em ≥640px. Card: ícone 48×64 no topo, rótulo 14px centralizado abaixo, min-height 104px, alvo de toque muito acima dos 44px.

`Corpo todo, sem preferência` **não tem ícone de região** — usa a silhueta inteira destacada, e ocupa a **largura total** na primeira linha da grade, acima das 10 regiões específicas, separada por um divisor. Posicionar a opção "não quero escolher" antes das escolhas é o que evita 10 leituras desnecessárias para quem não tem preferência.

### 6.3 As 10 regiões de dor (seção 4)

**Mesmo componente, mesma silhueta, mapa de regiões diferente** — regiões de dor são articulares/segmentares (pescoço, ombro, cotovelo, punho, lombar, torácica, quadril, joelho, tornozelo/pé, outra), enquanto as de ênfase são musculares. Uma prop `set="emphasis" | "pain"` resolve; não são dois componentes.

Diferenças de comportamento no modo `pain`:
- **Sem limite** de seleção.
- Destaque em **Coral Vivo** (não Verde Pulso) — o vocabulário de cor separa "onde quero focar" de "onde dói" sem nenhuma palavra a mais.
- `Outra` abre campo de texto (100 caracteres).

---

## 7. Componente novo: escala de intensidade de dor 0-10

### 7.1 A decisão

**`<input type="range" min="0" max="10" step="1">` nativo, estilizado**, com leitura numérica grande em mono, marcas de 11 pontos e rótulos-âncora nas extremidades e no meio.

Por quê não 11 botões: onze alvos de toque numa linha em 360px dá ~30px cada — abaixo do mínimo de 44px, e erro de toque em dado clínico é inaceitável. Por quê não um slider custom: o range nativo já é operável por teclado (setas ±1, Home/End), já é anunciado corretamente por leitor de tela, já funciona em qualquer navegador. Escrever um em div é reintroduzir bugs de acessibilidade resolvidos há 15 anos.

```
        ┌─────┐
        │  7  │              ← mono 40px, Coral Vivo, atualiza ao vivo
        └─────┘
  Nenhuma dor      A pior dor que já senti
  ├──┼──┼──┼──┼──┼──┼──●──┼──┼──┤
  0                              10
```

- Trilha 8px, altura do polegar 32×32 (bem acima do alvo mínimo), polegar Coral Vivo com anel Petróleo.
- 11 marcas discretas de 2px na trilha — mostram que a escala é inteira, não contínua.
- Valor numérico grande acima, em mono (vocabulário de número do design system).
- **Sem valor inicial.** O range **não** começa em 0 nem em 5 com o polegar posicionado: começa em estado `sem resposta`, polegar centralizado em cinza Musgo e leitura `—`. Um slider que já mostra um número é um número que o usuário não deu — e aqui isso é dado de saúde. O campo só é considerado respondido após interação; enquanto não for, o CONTINUAR mostra a validação inline.
- **Rótulos-âncora textuais**, não só números: `0 · Nenhuma dor` e `10 · A pior dor que já senti`. A escala numérica pura é interpretada de formas muito diferentes entre pessoas.
- **Uma escala por região de dor selecionada**, não uma escala global. Se o usuário marcou joelho e lombar, ele responde duas escalas, cada uma titulada com a região (`Joelho`, `Lombar`). Uma intensidade média entre duas dores diferentes não é informação clínica útil e o RT precisa da granularidade.

### 7.2 Acessibilidade do range

- `aria-label` = `Intensidade da dor no joelho, de 0 a 10`.
- **`aria-valuetext` obrigatório**: `"7 de 10"` — sem ele, leitor de tela anuncia só "7", que fora do contexto não significa nada. Nos extremos: `"0 de 10, nenhuma dor"` e `"10 de 10, a pior dor que já senti"`.
- Estado não-respondido: `aria-valuetext="sem resposta"`.
- O valor numérico visual tem `aria-hidden="true"` (o range já anuncia; duplicar gera leitura dupla).
- Alternativa por teclado já é nativa. Nada a implementar.

---

## 8. Etapa 3 — Saúde (PAR-Q) e as 3 confirmações

O conjunto de perguntas é reuso puro (`parq-2026-07-v1`) — **não se toca**. O que este documento define é o enquadramento.

**Abertura da etapa 3**, tela própria antes da primeira pergunta:

> copy:
> **Última parte: sua segurança.**
> São 9 perguntas rápidas, sim ou não. É o mesmo questionário que qualquer profissional de Educação Física usa antes de montar um treino. Se alguma resposta for "sim", não tem problema nenhum — quer dizer só que o profissional responsável vai olhar seu caso antes de o treino ser preparado.
> `[ Começar ]`

Dizer **antes** o que acontece se houver um "sim" é o que impede a resposta desonesta. Quem teme ser barrado, mente — e aí o gate de segurança vira decoração.

**Perguntas:** uma por tela, `Sim` / `Não` como dois botões grandes lado a lado, mesmo peso visual (`Sim` **não** é destaque nem alerta — nenhuma cor de alarme). Contador `Pergunta 4 de 9` em mono. Q9=Sim revela o campo de motivo obrigatório, seguindo as regras de condicional da §3.3.

Ao marcar `Sim` em qualquer pergunta, microcopy imediata abaixo, Musgo, sem ícone de alerta:

> copy: **Anotado. Obrigada por ser honesto.**

**Barra de progresso** durante o PAR-Q: a barra macro fica congelada nos 6/7 e o progresso das 9 perguntas aparece na linha de contexto (`Passo 3 de 3 · Pergunta 4 de 9`). Não fazer a barra macro se mexer a cada pergunta — 9 micro-avanços de 1,6% cada é ruído.

**3 confirmações finais:** tela própria após a 9ª pergunta, checkboxes nunca pré-marcadas, texto exato conforme Alexandre entregar (US-6.2/6.8), mesma forma da §2.3. Botão `FINALIZAR AVALIAÇÃO` (rótulo do fundador, manter em caixa alta como os demais CTAs do wizard), desabilitado até as 3.

**Estado de submissão:** o `FINALIZAR AVALIAÇÃO` dispara a decisão do PAR-Q no servidor. Tela de transição com o Pulso respirando e:

> copy: **Guardando suas respostas com segurança...**

Nunca escrever "analisando" nesta tela — a análise humana pode ou não acontecer, e prometer análise para quem vai cair na V1 é ruído. Se a chamada demorar >8s, adicionar `Já vai. Não feche essa página.` Se falhar, erro com retry que **não** perde o PAR-Q respondido.

---

## 9. Contratos que a UI precisa (para Leonardo)

A UI não deriva estado clínico. Ela **lê**. Três contratos:

1. **`GET /onboarding/{token}`** devolve: `currentStep` (1..3), `currentSection` (1..5, quando step=2), `phoneVerified` (bool), `consents[]` (tipo, versão, texto verbatim, obrigatório sim/não, ordem), e os dados já preenchidos por etapa. É isso que alimenta a tela de retomada (§1.4c) e a renderização dos consentimentos (§2.3).
2. **Escolha da variante da tela de sucesso:** a resposta da submissão da etapa 3 (e o `GET` da tela de sucesso) devolve um campo de **status derivado no servidor** — algo como `outcome: "READY" | "PENDING_REVIEW"` — mapeado dos enums existentes (`BLOCKED_PENDING_CLEARANCE` → `PENDING_REVIEW`). A UI **nunca** avalia PAR-Q, **nunca** lê query string para decidir a variante (US-6.11.2), e **nunca** recebe as respostas do PAR-Q de volta para inferir.
3. **A UI não recebe o motivo do bloqueio.** A V2 não diz qual resposta gerou a revisão, e o front não deve nem ter esse dado. Devolver isso ao cliente convidaria a exibi-lo, e exibi-lo se aproxima perigosamente de devolutiva clínica.

---

## 10. As 2 telas de sucesso

Ambas: fundo Névoa, card central, Pulso animado no topo (Lottie leve de Kimura, degrada para estático com `prefers-reduced-motion`), primeiro nome interpolado, botão primário `ABRIR O WHATSAPP` (deep link `wa.me`), e o selo CREF no rodapé.

### 10.1 V1 — perfil liberado

```
┌───────────────────────────────┐
│         ●  (pulso animado)    │
│                               │
│  Tudo pronto, Bruno!          │
│                               │
│  Seu treino está sendo        │
│  preparado com a metodologia  │
│  do Prof. Leonardo Souza      │
│  (CREF 000000-G/SP).          │
│                               │
│  O que acontece agora:        │
│  1  Salve o contato da MOVIVO │
│  2  Seu treino chega no seu   │
│     WhatsApp em até 2 horas   │
│  3  Qualquer dúvida, é só     │
│     perguntar por lá          │
│  4  Toda semana a gente faz   │
│     um check-in rápido        │
│                               │
│  [  ABRIR O WHATSAPP        ] │
│  [  Salvar contato          ] │
│                               │
│  🛡 Metodologia e supervisão   │
│     de profissional CREF      │
└───────────────────────────────┘
```

> **copy final da V1:**
> **Tudo pronto, [NOME]!**
> Seu treino está sendo preparado com a metodologia do Prof. [NOME RT] (CREF [NÚMERO]).
>
> **O que acontece agora**
> **1.** Salve o contato da MOVIVO — é de lá que tudo chega.
> **2.** Seu treino chega no seu WhatsApp em até 2 horas.
> **3.** Qualquer dúvida sobre um exercício, é só perguntar por lá.
> **4.** Toda semana a gente faz um check-in rápido pra ajustar o que precisar.
>
> `ABRIR O WHATSAPP` · `Salvar contato`
>
> Metodologia e supervisão de profissional de Educação Física registrado no CREF.

Nota de guardrail: "preparado com a metodologia do Prof. X" — **nunca** "a IA montou seu treino" nem "seu treino foi prescrito".

### 10.2 V2 — perfil em análise

Esta é a tela mais delicada do produto. Três regras de design antes da copy:

1. **Visualmente ela é a V1, não um estado de erro.** Mesmo layout, mesmo Pulso animado, mesmo fundo Névoa, mesmo botão primário Verde Pulso. **Zero** Coral, zero ícone de alerta, zero fundo escuro dramático. No instante em que a V2 parece diferente da V1, ela vira rejeição — o corpo lê a cor antes de ler o texto.
2. **A palavra "análise" só aparece ligada a uma pessoa**, nunca ao sistema: "o professor vai olhar", não "seu caso está em análise".
3. **Nenhuma menção ao que o usuário respondeu.** Nem "por causa de uma das suas respostas". Isso soa como veredito.

```
┌───────────────────────────────┐
│         ●  (pulso animado)    │
│                               │
│  Recebemos suas informações,  │
│  Bruno!                       │
│                               │
│  Pelo que você contou, o      │
│  Prof. Leonardo Souza         │
│  (CREF 000000-G/SP) vai olhar │
│  o seu caso pessoalmente      │
│  antes de o seu treino ser    │
│  preparado.                   │
│                               │
│  Isso é o normal por aqui —   │
│  é assim que a gente garante  │
│  que o seu treino faz sentido │
│  pra você.                    │
│                               │
│  O que acontece agora:        │
│  1  Salve o contato da MOVIVO │
│  2  O professor te responde   │
│     no WhatsApp em até        │
│     1 dia útil                │  ← PENDÊNCIA SLA (§11)
│  3  Ele pode te fazer mais    │
│     alguma pergunta por lá    │
│                               │
│  [  ABRIR O WHATSAPP        ] │
│  [  Salvar contato          ] │
│                               │
│  🛡 Metodologia e supervisão   │
│     de profissional CREF      │
└───────────────────────────────┘
```

> **copy final da V2:**
> **Recebemos suas informações, [NOME]!**
> Pelo que você contou, o Prof. [NOME RT] (CREF [NÚMERO]) vai olhar o seu caso pessoalmente antes de o seu treino ser preparado.
>
> Isso é o normal por aqui — é assim que a gente garante que o seu treino faz sentido pra você.
>
> **O que acontece agora**
> **1.** Salve o contato da MOVIVO — é de lá que tudo chega.
> **2.** O professor te responde no seu WhatsApp em até [SLA].
> **3.** Ele pode te fazer mais alguma pergunta por lá antes de montar o treino.
>
> `ABRIR O WHATSAPP` · `Salvar contato`
>
> Metodologia e supervisão de profissional de Educação Física registrado no CREF.

**Checklist de guardrail aplicado à V2** (para a revisão de Lucas/Alexandre em TASK-6.11.3):

| Risco | Como a copy evita |
|---|---|
| Soar como diagnóstico | Nenhuma palavra sobre condição, sintoma, risco ou saúde do usuário. A tela fala do **processo**, não da pessoa. |
| Soar como rejeição | "Recebemos suas informações" + "isso é o normal por aqui". Nada de "não podemos", "infelizmente", "pendente", "bloqueado". |
| Soar como problema | O passo 3 apresenta a conversa com o professor como continuidade, não como obstáculo. |
| IA decidindo sozinha | A IA não é mencionada. Quem age na tela é uma pessoa, nomeada, com CREF. |
| Promessa não cumprível | O prazo é o SLA de §11, e ele é da **resposta do professor**, não do treino pronto. Prometer treino em X é prometer o que depende da análise. |
| Termos proibidos | Zero ocorrências de prescrever/diagnóstico/tratamento/cura/garantido. |

**Nunca escrever na V2:** "aguardando análise", "pendente", "seu cadastro foi sinalizado", "identificamos", "por segurança não podemos", "atestado médico" (essa conversa é do professor, no WhatsApp, com contexto — não de uma tela automática).

> Observação sobre o rótulo do fundador `AGUARDANDO ANÁLISE PROFISSIONAL`: ele é o **nome do status no sistema** e serve perfeitamente no painel CREF e nos logs. **Não é copy de usuário** — "aguardando" coloca a pessoa numa fila e "análise" sem sujeito soa institucional. Na tela do usuário vale a copy acima. Isso não corta nada da spec: o status existe, com o nome dele, do lado de dentro.

### 10.3 Diferenças estruturais entre V1 e V2 (resumo para o Felipe)

| | V1 | V2 |
|---|---|---|
| Título | Tudo pronto, [NOME]! | Recebemos suas informações, [NOME]! |
| Parágrafo de contexto | 1 (metodologia) | 2 (professor vai olhar + normalização) |
| Passos | 4 | 3 |
| Prazo prometido | treino em até 2h | resposta do professor em até [SLA] |
| Cor / layout / motion | **idênticos** | **idênticos** |
| Origem da variante | `outcome` do servidor (§9.2) | idem |

Um único componente com duas configurações de conteúdo. Não são duas páginas.

---

## 11. Proposta de SLA da análise humana (PENDÊNCIA #8) — **não confirmado**

**Isto é uma proposta de UX, não uma decisão.** Precisa de confirmação escrita do fundador e do RT antes de ir a produção.

**Proposta: "em até 1 dia útil", com janela de atendimento declarada em dias úteis.**

Raciocínio:

- **Há um único profissional (Leonardo/RT), que não faz disso o trabalho principal.** Qualquer promessa em horas assume disponibilidade contínua de uma pessoa só, e a primeira falha acontece no primeiro sábado.
- **"1 dia útil" é honesto e ainda é rápido.** Compara bem com a alternativa real do usuário (marcar uma consulta), e é folgado o bastante para absorver o volume inicial. O custo de superprometer aqui é altíssimo: é um usuário com dor ou condição de saúde esperando por uma resposta que não vem.
- **Não usar "24 horas"** — sugere relógio corrido e inclui madrugada e domingo.
- **Não usar "o mais rápido possível"** — não é prazo, é evasiva, e reduz confiança exatamente onde ela é mais necessária.
- **Recomendação operacional (para Lucas):** só prometa o que houver monitor para medir. Instrumentar o tempo entre `BLOCKED_PENDING_CLEARANCE` e a primeira ação humana no painel (Sprint 5) desde o dia 1, e revisar o SLA com dados reais depois de 30 casos. Se o p90 real ficar consistentemente abaixo de 4h, apertar o prazo público é uma melhoria barata e segura — apertar antes de medir não é.
- **Reforço de confiança sem custo:** enviar uma mensagem automática de reconhecimento no WhatsApp imediatamente após a V2 ("Recebemos suas informações. O Prof. X vai te responder por aqui."). Isso transfere a espera do vazio da tela para o canal, e é o que reduz a ansiedade de fato. Fica registrado como recomendação para a US-6.11/Leonardo, fora do escopo mínimo da tela.

**Implementação enquanto pendente:** o prazo é **uma constante única** (`REVIEW_SLA_LABEL = "1 dia útil"`), consumida pela V2. Trocar o valor deve ser uma linha. Se o RT não confirmar até o merge, a tela vai para produção com esse texto **e a pendência fica aberta como bloqueador de lançamento**, não de dev.

---

## 12. Acessibilidade (WCAG 2.2 AA) — o que é novo nesta sprint

O §14 do relatório 09 continua valendo integralmente. Adições específicas dos componentes novos:

**Barra de progresso (§1)**
`role="progressbar"` com `aria-valuenow/min/max` **e** `aria-valuetext="Passo 2 de 3, Objetivos"` — a porcentagem sozinha não informa. Rótulos das etapas são decorativos (`aria-hidden`), já que o texto real vai no `valuetext`. Progresso também comunicado por texto visível, nunca só pela barra (1.4.1).

**`BodyRegionPicker` (§6)**
- Grupo semântico: `role="group"` + `aria-labelledby` apontando para a pergunta. Cada opção é um `<input type="checkbox">` real com label visível — não `<div role="checkbox">`.
- **Ícone é sempre `aria-hidden`**; o nome acessível vem do rótulo textual. Nenhuma informação existe só no ícone (1.1.1, 1.4.1).
- Estado de limite atingido: `aria-disabled="true"` (não `disabled`, que remove do tab order e esconde a explicação de quem usa leitor de tela). A mensagem de limite é `aria-live="polite"`.
- Contador `Escolhidas: 1 de 2` é texto real, dentro do grupo, lido pelo leitor.
- Seleção **nunca** indicada só por cor: além da borda Verde Pulso, um ✓ no canto do card (1.4.1).
- Contraste: rótulo em Grafite sobre Névoa (13:1). Verde Pulso e Coral **só** como borda/preenchimento/ícone grande, nunca como texto — regra herdada de Kimura.
- Alvo de toque: card de 104px de altura, muito acima do mínimo 24×24 (2.5.8) e do nosso padrão de 44×44.

**Escala de dor (§7)**
Coberta pelo range nativo. Obrigatórios: `aria-valuetext`, rótulos-âncora textuais, valor visual `aria-hidden`, foco visível (anel Verde Pulso 2px, 2.4.7).

**Campo de código OTP (§4)**
Um input real com `autocomplete="one-time-code"` e `aria-label` explícito. Erro com `role="alert"` (anúncio imediato). Contador de reenvio em `aria-live="polite"` **atualizado a cada 10s, não a cada segundo** — um live region que dispara 60 vezes torna a tela inutilizável com leitor de tela. Sem timeout que penalize (2.2.1): a expiração do código é recuperável em um toque e está explicada.

**Condicionais (§3.3)**
Container do follow-up com `aria-live="polite"`; foco **não** é roubado; ordem de tabulação natural.

**Formulário longo (3.3)**
Labels associados a todos os campos (nunca placeholder como label); mensagens de erro programáticas e descritivas via `aria-describedby`; `autocomplete` em todo campo de identificação (1.3.5); erro no submit move o foco para o **primeiro** campo inválido e o resume no topo do sub-passo.

**Botões desabilitados**
Padrão do wizard: `aria-disabled="true"` + explicação em `aria-live`, nunca `disabled` mudo (3.3.1). Vale para CONTINUAR, FINALIZAR AVALIAÇÃO e ENVIAR CÓDIGO.

**Movimento (2.3.3)**
Pulso animado, transição da barra, revelação de condicionais e estado "Confirmando..." — todos respeitam `prefers-reduced-motion`.

---

## 13. Responsividade

Mobile-first real: o wizard é desenhado para 360px e cresce.

| Faixa | Comportamento |
|---|---|
| <640px | Coluna única. Grade de regiões em 2 colunas. Cards de objetivo 100%. Botões do rodapé em coluna, primário embaixo (alcance do polegar). Barra de progresso fixa no topo (`sticky`), rodapé de ações fixo. |
| 640-1023px | Card central máx. 560px. Grade de regiões em 3 colunas. Botões lado a lado. |
| ≥1024px | Card central máx. 560px (**não** esticar — linha de leitura longa mata formulário). Fundo Névoa em volta. Grade de regiões em 3 colunas. |

O rodapé fixo em mobile não pode cobrir o último campo: `padding-bottom` do conteúdo = altura do rodapé + 16px. É o bug clássico deste layout.

---

## 14. Métricas a instrumentar (Felipe + PostHog)

Sem isso, a próxima iteração é opinião:

- `onboarding_step_view` e `onboarding_step_complete` com `{step, section}` — dá o funil sub-passo a sub-passo e mostra **qual das 5 seções** derruba a conclusão.
- `otp_sent`, `otp_verified`, `otp_resent`, `otp_failed{reason}` — taxa de verificação é o novo gargalo #1 do funil, e é fricção que nós introduzimos.
- `onboarding_resumed` — mede se a retomada de 72h serve para alguma coisa.
- `emphasis_limit_hit` — se muita gente bate no limite de 2, o limite (ou a comunicação dele) está errado.
- `success_screen_view{variant}` — proporção real V1/V2. É o que dimensiona a carga do RT e valida ou derruba o SLA proposto em §11.
- Tempo até conclusão (p50/p90). Alvo: **p50 ≤ 8 min** para o caminho sem dor. Se passar de 12, cortamos campo.

---

## 15. Pendências que saem daqui

| # | Pendência | Dono | Valor provisório implementado |
|---|---|---|---|
| A | **SLA da análise humana da V2** | Fundador + RT CREF | `"1 dia útil"` (§11) — constante única |
| B | TTL do código de verificação | Sato (com recomendação de Sofia) | 10 min (§4.5) |
| C | "Corpo todo, sem preferência" é exclusiva? | Fundador | UI assume **exclusiva** (§3.2) |
| D | Dias marcados × dias/semana precisam bater? | Fundador | UI **informa, não bloqueia** (§3.5) |
| E | Textos e ordem dos consentimentos | Alexandre (US-6.2) | front renderiza o que o backend mandar (§2.3) |
| F | Nome e número do RT exibidos nas telas de sucesso | Fundador | placeholder até a ratificação do RT |

---

## 16. Resumo do que o Felipe recebe

1. Barra de progresso: 3 rótulos + 7 sub-passos + linha de contexto (§1.1-1.2).
2. Regras de navegação, salvamento visível, retomada, expiração e falha de salvamento (§1.3-1.4).
3. Etapa 1 completa: campos, gate 18+ com a mensagem exata, forma dos consentimentos, ordem (§2).
4. Fluxo de OTP com 5 estados, reenvio, rate limit, troca de número, TTL recomendado (§4).
5. Sete regras de campo condicional que valem para os 7 condicionais (§3.3).
6. `BodyRegionPicker`: um SVG, dois mapas de região, sem dependência nova (§6).
7. Escala de dor: range nativo, sem valor inicial, uma por região (§7).
8. Etapa 3: abertura, uma pergunta por tela, 3 confirmações, estado de submissão (§8).
9. Contratos que a UI precisa do backend (§9).
10. V1 e V2 com copy final, um componente, variante vinda do servidor (§10).
11. A11y dos componentes novos e responsividade (§12-13).

---

## Fontes Consultadas

Pesquisa web não foi executada nesta entrega — a instrução da US-6.1 é explicitamente para reusar o design system e os padrões já estabelecidos no projeto, e todas as decisões acima derivam de artefatos internos. **Limitação declarada:** as recomendações de padrão (OTP em input único, range nativo para escala, progresso rotulado, tela V2 visualmente idêntica à V1) vêm da minha base de conhecimento e do benchmark já registrado em `09-relatorio-sofia.md` §6, não de pesquisa nova de 2026.

Artefatos internos consultados:

- `sprint/sprint-6-onboarding-em-etapas.md` (US-6.1 a US-6.12, decisões do fundador, pendências)
- `docs/fitness-ia-whatsapp/09-relatorio-sofia.md` (design system "O Pulso" §15, guardrails de linguagem §13, a11y §14, fluxo do formulário §§8-9)
- `docs/fitness-ia-whatsapp/08-relatorio-lucas.md` (escopo do MVP, SLA de 2h)
- `apps/web/package.json` (lucide-react já disponível — base da decisão de §6.1)
- WCAG 2.2 AA: 1.1.1, 1.3.1, 1.3.5, 1.4.1, 1.4.3, 2.1.1, 2.2.1, 2.3.3, 2.4.3, 2.4.7, 2.5.8, 3.3.1, 4.1.2
