# FAQ e regras de segurança padrão (para os profissionais revisarem)

Estes itens vêm **carregados em todo deploy** (arquivo `apps/api/src/core/database/default-ai-config.ts`) e aparecem em **IA → Base de Conhecimento → FAQ** e **→ Segurança**. Quem edita, retira ou publica uma nova versão pelo painel prevalece: o padrão nunca volta por cima do que a equipe fez.

## Como funcionam

- **FAQ:** resposta pronta, sem modelo. Só vale quando a mensagem do aluno é **exatamente** a pergunta (sem acento, caixa nem pontuação final). Não pode conter "diagnóstico", "tratamento", "cura" nem "garantido", nem em negação.
- **Guardrail L1:** a única ação é **sinalizar**. A mensagem fica **retida para a equipe revisar**, e o aluno recebe o aviso padrão de que a equipe vai ver. Os sinais de saúde (dor, gestação, transtorno alimentar, saúde mental...) já são da sentinela fixa do código e não se repetem aqui.

## FAQ padrão (9)

**O que é a MOVIVO?**
> A MOVIVO é uma assessoria de treino e nutrição pelo WhatsApp. Eu sou a assistente de inteligência artificial da equipe e acompanho você seguindo a metodologia dos nossos profissionais de Educação Física, Nutrição e Medicina.

**Como funciona a MOVIVO?**
> Eu monto o seu plano de treino e de alimentação com base nas suas respostas, mando o treino do dia e acompanho o seu progresso por aqui. Se a sua semana mudar (pouco tempo, viagem, falta de equipamento), é só me contar que eu ajusto.

**Você é uma pessoa ou uma IA?**
> Sou uma inteligência artificial, e não uma pessoa. Profissionais da MOVIVO (Educação Física, Nutrição e Medicina) supervisionam o meu trabalho. Se você quiser falar com alguém da equipe, é só pedir por aqui.

**Você é um robô?**
> Sou uma inteligência artificial, e não uma pessoa. Profissionais da MOVIVO (Educação Física, Nutrição e Medicina) supervisionam o meu trabalho. Se você quiser falar com alguém da equipe, é só pedir por aqui.

**A MOVIVO substitui um médico?**
> Não. Eu oriento treino e alimentação, mas não substituo consulta médica nem exames. Se você sentir dor forte, tontura, falta de ar ou qualquer sintoma diferente, pare de treinar e procure atendimento médico.

**Quais modalidades vocês atendem?**
> Acompanho musculação, corrida, HYROX e treino híbrido (que combina essas modalidades na mesma semana), sempre com plano de treino e de alimentação.

**Como registro minha alimentação?**
> É só me contar aqui o que você comeu, em texto ou com a foto da refeição. Eu registro e uso isso para acompanhar o seu plano.

**Como troco um exercício?**
> Me diga qual exercício você quer trocar e o motivo (falta de equipamento, incômodo, não gosta ou está difícil demais). Eu sugiro um substituto parecido que caiba no seu plano.

**Meus dados estão seguros?**
> Seus dados de saúde são usados só para montar e acompanhar o seu plano, com o seu consentimento, e ficam protegidos com criptografia. Se quiser saber mais ou pedir algo sobre os seus dados, escreva por aqui que a equipe responde.

## Guardrails L1 padrão (6)

### Anabolizantes e hormônios
Avalia: mensagem do aluno e resposta da IA. Frases: `anabolizante`, `anabolizantes`, `esteroide`, `esteroides`, `testosterona`, `hormônio do crescimento`, `oxandrolona`, `trembolona`, `stanozolol`, `clenbuterol`, `sarms`.

### Remédios e canetas para emagrecer
Avalia: mensagem do aluno e resposta da IA. Frases: `ozempic`, `mounjaro`, `wegovy`, `saxenda`, `semaglutida`, `tirzepatida`, `liraglutida`, `sibutramina`, `orlistate`, `inibidor de apetite`, `remédio para emagrecer`, `remédio pra emagrecer`, `caneta para emagrecer`, `caneta pra emagrecer`.

### Menor de idade
Avalia: mensagem do aluno. Frases: `menor de idade`, `sou menor`, `ainda sou menor`, `tenho menos de 18 anos`, `sou adolescente`.

### Dieta ou desidratação extrema
Avalia: mensagem do aluno. Frases: `jejum de 36 horas`, `jejum de 48 horas`, `jejum de 72 horas`, `dieta de 500 calorias`, `dieta de 800 calorias`, `sauna para emagrecer`, `diurético`, `laxante`, `cortar a água`, `desidratar para pesar`.

### Reclamação formal ou jurídica
Avalia: mensagem do aluno. Frases: `procon`, `advogado`, `vou processar vocês`, `vou processar a movivo`, `vou te processar`, `entrar na justiça`, `danos morais`, `reclame aqui`, `denunciar no cref`, `denunciar no crn`, `ação judicial`.

### Pedido sobre dados pessoais (LGPD)
Avalia: mensagem do aluno. Frases: `lgpd`, `apagar meus dados`, `excluir meus dados`, `deletar meus dados`, `remover meus dados`, `quero meus dados`, `cópia dos meus dados`.

## O que os profissionais devem conferir

- Se as frases de cada regra são as certas e se alguma gera ruído demais na fila (o painel mostra a simulação antes de qualquer mudança).
- Se as respostas do FAQ estão de acordo com a prática da MOVIVO. Nada sobre preço, cancelamento ou prazos foi escrito de propósito: são regras de negócio que a equipe define.
