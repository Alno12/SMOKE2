# SmokeCount — Revisão do Motor Estatístico

> Auditoria de correção do `js/stats.js` e do seu consumo em `js/app.js`, em
> 15/07/2026. Cada achado traz arquivo:linha, a evidência (verificada em Node
> quando quantificável) e a correção. Complementa a §2 do `MELHORIAS.md`.

---

## Veredito geral

O motor é **sólido e, na maioria dos pontos, honesto** — raro num app de saúde.
As fases 1–3 já corrigiram vários riscos reais: `fCrit` com interpolação
substituiu o limiar fixo da ANOVA, o IC da média passou a usar `t` de Student,
e as funções novas (`costSummary`, `personalRecords`) filtram registros futuros
e projetam custo sem prometer o que não sabem.

Pontos que **já estão certos** e merecem registro (não mexer): o período-base da
carta EWMA (estimar centro/sigma sobre a série inteira cegaria a carta —
`stats.js:180-206`); o sigma robusto por amplitude móvel (`sigmaMR`); a massa
mínima do elo de Markov (`totals[a] >= 4`); o tratamento honesto de dias-zero no
`weekdayPace`; e os pares imunes a viés em `personalRecords` (gap corrido vs.
diurno, `bestDayNonZero`).

Os achados abaixo são o que resta — nenhum trava o app, mas os de severidade
alta **mentem ao usuário sobre a própria saúde**, que é o critério mais sensível
do produto.

---

## 1. ALTA — A projeção anuncia datas de "zero cigarros" sem exigir significância

`js/app.js:692-701` (`renderForecast`). A extrapolação da reta OLS calcula e
exibe a data em que o usuário atinge **5 cig/dia** e **zero**, com horizonte de
até 3650 dias (10 anos). O gate é apenas `o.b < 0` — a inclinação ser negativa.
**Não há checagem de significância**: uma queda puramente ruidosa (t abaixo do
crítico) produz uma data confiante de "você chega a zero em 12 de março de 2027".

Dois problemas:
1. **Estatístico**: consumo não cai linear até zero, e a maior parte das quedas
   de curto prazo é ruído. Anunciar uma data é a exata armadilha que o §2.6 do
   `MELHORIAS.md` já apontava.
2. **Consistência interna**: o painel de custo da Fase 3 (`costSummary`,
   `stats.js:540-570`) foi construído com o cuidado oposto — só mostra cenário
   de tendência quando `b < 0` **E** `|t| > tCrit(n-2)` **E** há ≥14 dias, e
   nunca cita "data de zero". Hoje o app é honesto num painel e não no outro,
   lado a lado.

**Correção**: condicionar a projeção à mesma barra do `costSummary` (a variável
`sigTrend` já é calculada em `renderSerie`, `app.js:493` — basta passá-la
adiante); apresentar como cenário ("se a reta atual se mantivesse"), não como
data-alvo; e encurtar o horizonte exibido. Dono: `stats-engineer` (regra) +
`ui-designer` (texto).

## 2. MÉDIA — Primeiro e último dia da série entram parciais e criam sinais falsos

`js/stats.js:326-342` (`dailySeries`) devolve a série do 1º ao último dia com
registro. O dia da instalação e o dia corrente entram com contagem **parcial**
(só a fração do dia já vivida), e todos os consumidores herdam o viés: média,
mediana, OLS, EWMA e o **índice de dispersão**.

Verificado em Node — ritmo estável de ~12/dia, adicionando um 1º dia de 3 e um
último de 4 (parciais):

| Métrica | Sem parciais | Com parciais |
|---|---|---|
| Média | 12,00 | 10,30 |
| Índice de dispersão | 0,05 | **1,30** |

O índice de dispersão salta e **cruza exatamente o limiar 1,3** que o app usa
para declarar consumo "superdisperso — existem dias de gatilho"
(`app.js:519,546`). Ou seja: dois dias de borda podem inventar "dias de gatilho"
que não existem, e mandar o usuário caçar um padrão que é só artefato de recorte.

**Correção**: marcar/excluir o primeiro e o último dia civil das estatísticas
descritivas (ou ao menos tratar "hoje" como incompleto), documentando o viés
como o resto do arquivo faz. Dono: `stats-engineer`.

## 3. MÉDIA — Kaplan-Meier ignora censura e superestima a recaída

`js/stats.js:237-246` (`survival`) e `intervals` (`344-359`). Os intervalos são
só entre cigarros consecutivos **do mesmo dia**. O último cigarro de cada dia —
a transição "parou de fumar à noite" — não tem sucessor e é simplesmente
**descartado**, não censurado à direita. Como essas são justamente as esperas
mais longas, a curva de sobrevivência cai rápido demais.

Verificado — rajadas curtas observadas (~10 min) mais as esperas longas que o
dia "engoliu":

| | S(t=100 min) |
|---|---|
| Só os gaps curtos (como é hoje) | 0,00 |
| Incluindo as esperas longas | 0,27 |

O app diz "meia hora depois você já acendeu outro em X% das vezes"
(`app.js`, `insKM`) com um X inflado — pinta o hábito como mais compulsivo do
que é.

**Correção**: incluir o intervalo censurado de cada dia (último cigarro → fim do
dia, ou → primeiro do dia seguinte) com o estimador KM tratando censura de
verdade. Dono: `stats-engineer`.

## 4. MÉDIA — O qui-quadrado engole a madrugada dentro de "Manhã"

`js/app.js:964` — `const pOf = h2 => h2 < 12 ? 0 : h2 < 18 ? 1 : 2` classifica
0h–11h como "Manhã". Um cigarro às 3h (a causa **"Insônia"** está na lista de
causas do app!) cai em "Manhã", contaminando a célula e escondendo justamente o
padrão de madrugada que o teste deveria revelar.

**Correção**: adicionar um período "Madrugada" (0–6h) — 4 colunas no lugar de 3.
Torna o resíduo padronizado de "Insônia" interpretável. Dono: `stats-engineer`
(faixas) + `ui-designer` (coluna na tabela).

## 5. MÉDIA-BAIXA — `chiCrit` é anticonservador para gl > 20

`js/stats.js:123-124` — para df > 20 usa a aproximação normal
`df + 1.645*√(2df)`, que subestima o valor crítico e **infla significância**.
Verificado contra a tabela χ² exata:

| gl | Implementação | Exato | Desvio |
|---|---|---|---|
| 21 | 31,66 | 32,67 | **−3,1%** |
| 30 | 42,74 | 43,77 | −2,4% |
| 50 | 66,45 | 67,51 | −1,6% |

Afeta só tabelas grandes (df > 20), raras neste app, mas quando ocorre pode
declarar associação causa×período que não existe.

**Correção**: aproximação de Wilson-Hilferty
(`df*(1 - 2/(9df) + z*√(2/(9df)))³`), precisa a <0,2% em toda a faixa. Dono:
`stats-engineer`.

## 6. BAIXA — Casos degenerados em `chiSquare` e `anova`

- `chiSquare([])` retorna `df = 1` (de `(0-1)*(0-1)`), semanticamente errado;
  inofensivo porque `chi=0` e `significant=false`. `stats.js:312`.
- `anova` com `ssw = 0` (grupos perfeitamente separados e constantes) tem o
  guarda `|| 1` que faz `F = ssb/(k-1)` em vez de F→∞, um **falso negativo** num
  caso degenerado. `stats.js:96`. Não ocorre com dados reais de contagem, mas
  vale um comentário ou tratamento explícito.

## 7. BAIXA — Arestas de `hazard` e do veredito "agora" da EWMA

- `hazard` (`stats.js:249-259`): intervalos > 200 min entram no `atRisk` de toda
  faixa mas nunca como evento, deprimindo levemente a última faixa; e o eixo
  rotula "180–200" enquanto qualquer coisa ≥200 some. Efeito pequeno.
- `ewmaChart` (`stats.js:227-233`): `belowNow`/`aboveNow` julgam `z[último]`
  mesmo quando a série inteira ainda está dentro do período-base (n ≤ baseline),
  isto é, julgam um ponto contra limites estimados a partir dele mesmo. Para
  séries curtas, o veredito "mudou de patamar" deveria se abster.

---

## Prioridade sugerida

| # | Achado | Severidade | Esforço |
|---|---|---|---|
| 1 | Projeção anuncia data de zero sem significância | Alta | baixo |
| 2 | Dias parciais criam falso "superdisperso" | Média | médio |
| 3 | Kaplan-Meier sem censura | Média | médio |
| 4 | Madrugada dentro de "Manhã" | Média | baixo |
| 5 | `chiCrit` anticonservador (gl>20) | Média-baixa | baixo |
| 6 | Degenerados chiSquare/anova | Baixa | baixo |
| 7 | Arestas hazard/EWMA | Baixa | baixo |

**#1, #4 e #5 são baratos e de alto retorno** — os três removem afirmações que
hoje enganam o usuário, com pouca linha de código. #2 e #3 exigem mais cuidado
(tocam em como a série e os intervalos são construídos) mas são onde o motor mais
se afasta da realidade. Todos preserváveis dentro dos princípios do produto:
funções puras, zero dependências, viés declarado em comentário.
