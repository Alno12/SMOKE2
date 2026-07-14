# SmokeCount — Documento de Melhorias

> Análise completa do aplicativo em 13/07/2026, cobrindo bugs encontrados,
> lacunas funcionais, rigor estatístico, UX, acessibilidade, PWA, privacidade
> e qualidade de código. Cada item indica arquivo e linha quando aplicável.

---

## Sumário executivo

O SmokeCount é um PWA sólido e incomum: motor estatístico real (EWMA, ACF,
ANOVA, Kaplan–Meier, Markov, qui-quadrado), persistência com defesa em
profundidade e zero dependências. A arquitetura em três arquivos
(`storage.js` / `stats.js` / `app.js`) é limpa e testável.

Os maiores problemas encontrados, em ordem de impacto:

1. **Funcionalidade prometida e não entregue** — preço do maço e cigarros por
   maço são configuráveis mas **nunca usados em cálculo algum**; o atalho
   "Registrar cigarro" do manifest **não faz nada**.
2. **Ausência total de testes** — o README afirma que o motor estatístico é
   "testado contra valores conhecidos", mas não existe nenhum arquivo de teste
   no repositório.
3. **Fragilidades pontuais de persistência** — uma gravação pode ser
   silenciosamente descartada em condição de corrida; o journal existe mas
   nunca é usado para recuperação.
4. **Rigor estatístico inconsistente** — a ANOVA usa limiar fixo `F > 2.2` em
   vez do F-crítico pelos graus de liberdade; o IC da média usa z=1,96 mesmo
   com n pequeno, apesar de `tCrit` já existir no código.
5. **Privacidade parcialmente contraditória** — o app promete "sem
   rastreamento", mas carrega fontes do Google (o IP do usuário vaza a cada
   visita não cacheada).

---

## 1. Bugs e defeitos confirmados

### 1.1 Atalho do PWA não funciona — ALTA ✅ corrigido
`manifest.json:22` define o shortcut `./index.html?action=log`, mas nenhum
código lê `location.search`. Quem usa o atalho da tela inicial ("Registrar
cigarro") só abre o app — o sheet de registro não abre. **Correção:** no
`boot()` (`js/app.js:86`), ler o parâmetro e chamar `openSheet('now')`.

### 1.2 Preferências de preço são coletadas e ignoradas — ALTA
`config.price` e `config.perPack` (`js/app.js:22`, `1141–1142`) são salvos e
exibidos no formulário (`index.html:281–284`), mas **nenhuma estatística de
custo existe**: nada de gasto diário/mensal/anual, nada de "quanto você
economizaria". Ou se implementa o painel de custo (ver §3.1) ou se removem os
campos — hoje é promessa quebrada na cara do usuário.

### 1.3 Gravação pode ser descartada em condição de corrida — ALTA ✅ corrigido
`js/storage.js:355`: se `saveRecords` é chamado enquanto `this.saving === true`,
o método marca `dirty = true` e **retorna sem agendar nova tentativa**. Se
nenhuma outra gravação vier depois (ex.: usuário edita e fecha o app entre o
debounce e o flush), a última alteração se perde nas camadas duráveis.
**Correção:** ao terminar uma gravação com `dirty === true`, reagendar
imediatamente `saveRecords(this._pending)`.

### 1.4 `beforeunload` sempre exibe diálogo de confirmação — MÉDIA ✅ corrigido
`js/storage.js:269–275`: quando há gravação pendente, além do flush síncrono o
código chama `e.preventDefault()`, o que faz o navegador exibir "Deseja sair do
site?" a cada fechamento dentro da janela de debounce (400 ms após qualquer
registro). Como `_flushSync()` já resolve o problema, o diálogo é atrito sem
benefício. **Correção:** flush síncrono sem `preventDefault`.

### 1.5 `_flushSync` não valida nem rotaciona backup — MÉDIA
`js/storage.js:405–411` grava direto em `localStorage` sem a rotação de
snapshot nem a escrita atômica usadas no caminho normal. Um fechamento no meio
da serialização pode sobrescrever o registro principal do localStorage com um
snapshot que nunca foi validado. Aceitável como último recurso, mas deveria ao
menos preservar o snapshot anterior em `backup:` antes de sobrescrever.

### 1.6 Journal é escrito e nunca lido para nada útil — MÉDIA
`js/storage.js:440–455`: toda mutação alimenta o journal (custo de I/O em cada
gravação), mas ele não participa de nenhuma recuperação — apenas `getJournal()`
existe e ninguém a chama. Ou implementar replay do journal na recuperação
(valor real: reconstruir estado após corrupção das vias principais), ou remover
e economizar uma escrita por operação.

### 1.7 Ícone iOS errado — BAIXA ✅ corrigido
`index.html:13` aponta `apple-touch-icon` para `./icons/icon-192.png`, mas o
arquivo dedicado `./icons/apple-touch-icon.png` existe no repositório e não é
referenciado por ninguém.

### 1.8 Contador "hoje" conta registros futuros — BAIXA ✅ corrigido
`js/app.js:1176`: `records.filter(r => r.ts >= t)` inclui registros com data
futura (possíveis via lançamento retroativo com data errada). Filtrar também
por `r.ts < amanhã`.

### 1.9 Eixo do hazard não bate com os dados — BAIXA ✅ corrigido
`js/stats.js:220` gera 10 faixas de 20 min (0–200), mas o eixo em
`index.html:166` rotula a última como "180+". A última faixa é 180–200, não
"180 ou mais" — intervalos ≥200 min simplesmente somem do gráfico.

### 1.10 Redirect SPA pode cachear HTML como JS — BAIXA
`netlify.toml:61–64` redireciona `/*` para `/index.html` com status 200. Um
request a um asset inexistente (ex.: `js/app.js` com nome errado após deploy
parcial) recebe HTML com HTTP 200, e o service worker (`sw.js:73–77`) o cacheia
como se fosse o asset. **Correção:** restringir o redirect a rotas sem extensão
ou usar `force = false` com regras explícitas por pasta.

### 1.11 Assets do SW incompletos — BAIXA ✅ corrigido
`sw.js:16–26` não pré-cacheia `icons/icon-maskable-512.png` nem
`icons/apple-touch-icon.png`. Offline, o sistema pode não conseguir renderizar
o ícone maskable.

---

## 2. Rigor estatístico

O motor é bom — estes ajustes o deixariam defensável de ponta a ponta:

### 2.1 Significância da ANOVA com limiar fixo ✅ corrigido
`js/app.js:397`: `const sig = F > 2.2` ignora os graus de liberdade. Com 7
grupos e poucas semanas de dados, o F-crítico a 95% pode ser bem maior que 2,2
(falso positivo); com meses de dados, menor (falso negativo). `stats.js` já tem
tabela de qui-quadrado e t — adicionar `fCrit(df1, df2)` (ou aproximação de
Wilson–Hilferty) e usar.

### 2.2 IC 95% da média com z em vez de t ✅ corrigido
`js/app.js:234–238` usa `1.96 * se` para o intervalo do hero. Com n = 4–15 dias
(o caso típico de usuário novo), o correto é `tCrit(n-1)`, que já existe em
`js/stats.js:117`. Diferença prática: com n=5, o IC verdadeiro é ~40% mais
largo do que o exibido — o app afirma mais precisão do que tem.

### 2.3 Primeiro e último dia da série são parciais
`js/stats.js:297–313`: o dia em que o usuário instala o app entra na série com
contagem parcial (só os cigarros após a instalação), puxando média, OLS e EWMA
para baixo no início — exatamente onde o período-base da EWMA é estimado.
**Correção:** descartar (ou marcar) o primeiro dia civil da série, e considerar
tratar "hoje" como incompleto nas estatísticas descritivas.

### 2.4 Kaplan–Meier com censura ignorada
`js/stats.js:209`: o comentário admite "sem censura", mas o último intervalo de
cada dia É censurado (o dia acabou sem o próximo cigarro). Ignorar censura
enviesa a curva para baixo (superestima a rapidez da recaída). Incluir os
intervalos censurados (último cigarro → fim do dia) com o estimador KM real
melhoraria a honestidade da curva.

### 2.5 Períodos do qui-quadrado engolem a madrugada
`js/app.js:709`: `pOf` classifica 0h–11h como "Manhã". Um cigarro às 3h da
manhã (insônia — que é uma causa listada!) cai em "Manhã", poluindo o teste.
Adicionar período "Madrugada" (0–6h) tornaria o resíduo padronizado da causa
"Insônia" interpretável.

### 2.6 Projeção OLS linear até zero
`js/app.js:437`: extrapolar reta por 30+ dias (e anunciar a data de "zero
cigarros") é estatisticamente frágil — consumo não cai linear até zero. Mínimo:
limitar a extrapolação exibida (~30 dias, já feito no gráfico, mas o texto
anuncia datas a até 10 anos). Melhor: ajuste exponencial/log para a mensagem de
data-alvo, ou apresentar como cenário ("se o ritmo linear se mantivesse").

---

## 3. Funcionalidades novas (em ordem de valor)

### 3.1 Painel de custo financeiro — o dado já existe
Preço e cigarros/maço já são configurados (§1.2). Implementar:
- Gasto de hoje / semana / mês / desde o início.
- Projeção anual no ritmo atual (a OLS já existe).
- "Se a tendência de queda continuar, você economiza R$ X até dezembro."
- Card no topo da aba Série ou nova seção na aba Dados.
É a melhoria de maior razão valor/esforço do backlog: só apresentação, zero
estatística nova.

### 3.2 Marcos de saúde e de abstinência
O app sabe o horário do último cigarro. Com isso:
- Linha do tempo de recuperação (20 min: pressão; 12 h: CO; 2 sem: circulação;
  1 ano: risco cardíaco) ancorada no último registro — conteúdo educativo
  padrão OMS/INCA, com o disclaimer que o app já usa.
- Recordes pessoais: maior intervalo entre cigarros, melhor dia, melhor semana,
  sequência de dias abaixo da meta. Reforço positivo custa pouco e é o que
  falta na UX — hoje o app só constata, não celebra.

### 3.3 Modo "quero parar" (metas progressivas)
Hoje a meta é um número fixo. Um plano de redução gradual (ex.: −10% por
semana, gerado a partir da média atual) daria propósito às análises: a carta
EWMA passa a responder "estou cumprindo meu plano?" em vez de só "mudei?".

### 3.4 Lembrete de backup
`config.lastExport` já é rastreado (`js/app.js:851`), mas nada acontece quando
ele envelhece. Banner discreto quando: último export > 30 dias **e** houver
> N registros novos desde então. Para um app cujo modo de falha número 1 é
perda do dispositivo, é a proteção mais barata que existe.

### 3.5 Busca e filtro nos registros
`js/app.js:766` corta a lista em 14 dias sem alternativa de acesso ao restante.
Adicionar "carregar mais", filtro por causa e busca em notas. Os dados estão em
memória; é só renderização.

### 3.6 Exportar CSV
Além do JSON (backup), um CSV simples (`ts,cause,mood,craving,note`) permite ao
usuário levar os dados para planilha/médico. ~15 linhas de código.

### 3.7 Anotação de eventos de vida na série
"Comecei adesivo de nicotina", "mudei de emprego" — marcos verticais na carta
EWMA transformariam anomalias detectadas em anomalias explicadas. É o elo que
falta entre a estatística e a vida do usuário.

---

## 4. UX e interface

### 4.1 Registro rápido de verdade
O botão `+` abre o sheet completo. Para o caso mais comum (registrar agora, sem
detalhes), considerar: toque simples registra na hora com toast + "Desfazer" e
"Adicionar detalhes"; toque longo abre o sheet completo. Menos fricção = mais
registros = melhor estatística (o app depende de cobertura, como a própria aba
Causas admite).

### 4.2 Janela de desfazer muito curta
`js/app.js:1093`: o toast (única via de desfazer) some em 3,4 s. Para exclusão,
aumentar para ~6–8 s ou pausar o timer enquanto o dedo está sobre o toast.

### 4.3 Sheet sem gesto de arrastar
Existe o `grab` visual (`index.html:306`), mas não há gesto de swipe-down para
fechar — o affordance mente. Implementar com pointer events (~20 linhas).

### 4.4 Modo escuro
Não há `prefers-color-scheme` no CSS (verificado: apenas
`prefers-reduced-motion`). Para um app usado a qualquer hora — inclusive de
madrugada, caso de uso literal do produto (causa "Insônia") — tela clara às 3h
é hostil. A paleta é toda em tokens CSS (`--r1`, `--g1`…), então o custo é
baixo. Atualizar também `theme-color` no manifest/HTML.

### 4.5 Feedback tátil
`navigator.vibrate(10)` ao registrar (com verificação de suporte) daria
confirmação física no mobile, onde o toast pode passar despercebido.

### 4.6 Números tabulares nos contadores ao vivo
O painel "Agora" atualiza a cada 30 s; se a fonte não usa dígitos tabulares,
o layout "respira" a cada troca. `font-variant-numeric: tabular-nums` nos
valores resolve.

---

## 5. Acessibilidade

- **Abas sem semântica**: `index.html:37–43` usa botões simples. Adicionar
  `role="tablist"/"tab"/"tabpanel"`, `aria-selected` e navegação por setas.
- **Gráficos invisíveis para leitores de tela**: os SVGs não têm `role="img"`
  nem `aria-label`. As frases dos cards `.ins` já são o resumo perfeito —
  ligar cada SVG ao seu insight via `aria-labelledby` é quase de graça.
- **Chips sem teclado**: `buildChips` (`js/app.js:896`) cria `<span>` com
  `onclick` — invisíveis para teclado e leitores de tela. Trocar por `<button
  type="button" aria-pressed>`.
- **Diálogo sem gestão de foco**: o sheet tem `role="dialog"` mas não move o
  foco ao abrir, não prende o foco dentro, nem devolve ao fechar.
- **`confirm()`/`alert()` nativos**: funcionam, mas quebram a linguagem visual
  e, em alguns webviews de PWA instalado, comportam-se mal. Substituir por
  diálogo próprio (o sheet já dá o padrão).
- **Contraste**: auditar tons `--soft`/`--faint` sobre `#FBFBF9` (provável
  reprovação em WCAG AA para texto pequeno de 9–10px usado nas tabelas).

---

## 6. Privacidade e segurança

### 6.1 Google Fonts contradiz "sem rastreamento" — ALTA
`index.html:15–17` carrega Inter e JetBrains Mono do Google. Cada visita sem
cache envia IP + user-agent ao Google — em um app de dado sensível de saúde que
promete "sem rastreamento, sem conta". **Correção:** self-host dos WOFF2 (são
~4 arquivos), remover `fonts.googleapis.com`/`gstatic` da CSP
(`netlify.toml:19`) e do SW (`sw.js:54`). Bônus: o app fica 100% offline de
verdade no primeiro uso e a CSP vira `default-src 'self'` pura.

### 6.2 Escapes de HTML incompletos — MÉDIA
`js/app.js:793` injeta `r.note` em atributo `title` escapando apenas `"`.
Hoje o risco real é baixo (a nota é do próprio usuário e o app não tem
backend), mas um backup JSON importado de terceiros é vetor de HTML arbitrário
em `innerHTML`. Criar helper `esc()` e usá-lo em toda interpolação de dado do
usuário (`note`, e por higiene também `cause`/`mood`, que hoje vêm de lista
fixa mas podem vir de import).

### 6.3 Validação de import superficial — MÉDIA
`js/storage.js:515` aceita qualquer `r.id`/`r.ts` truthy. Um backup malformado
(ts inválido, craving fora de 1–5, note gigante) entra no estado e pode quebrar
renderizações. Validar tipo/faixa por campo e descartar (contando) os
inválidos: "Importados 132 · 3 ignorados por formato".

### 6.4 `integrity` do export não é verificável
`js/storage.js:501–503`: o checksum é calculado sobre o corpo **sem** o campo
`integrity` e depois o campo é adicionado — mas `importJSON` nunca o confere, e
um verificador externo não conseguiria reproduzir o hash sem saber remover o
campo primeiro. Ou verificar no import (removendo o campo e recalculando), ou
remover a pretensão.

---

## 7. PWA e plataforma

- **Tratamento do `?action=log`** — ver §1.1; sem isso o shortcut do manifest e
  qualquer futura integração de widget não funcionam.
- **Share target / protocol handler** — baixa prioridade, mas registrar
  `share_target` permitiria "compartilhar nota para o SmokeCount".
- **Screenshots no manifest** — `screenshots` e `description` longa melhoram o
  prompt de instalação no Android (rich install UI).
- **Badging API** — `navigator.setAppBadge(nHoje)` mostraria o contador do dia
  no ícone (suportado em Android/desktop; degrada silencioso onde não há).
- **Detecção de múltiplas abas** — duas abas abertas escrevem no mesmo storage
  com estados divergentes; a última a salvar vence e desfaz a outra (o merge
  por `editedAt` só roda no import). `BroadcastChannel` para sincronizar (ou ao
  menos avisar) custa ~10 linhas e fecha um buraco real de perda de edição.
- **`navigation preload`** no SW e `type: 'module'` no registro são
  modernizações menores.

---

## 8. Qualidade de código e engenharia

### 8.1 Testes — a maior dívida
Não existe nenhum teste no repositório, e o README afirma o contrário
(`README.md:98`). `js/stats.js` é 100% funções puras — testá-lo é trivial e de
altíssimo retorno (é onde um erro silencioso mente para o usuário sobre a
própria saúde). Plano mínimo, sem tocar na filosofia "sem build":
1. `node --test` (nativo, zero dependências) + `tests/stats.test.js`:
   valores conhecidos para `mean/median/ols/acf/anova/gini/chiSquare/ewmaChart`
   e casos-limite (série vazia, constante, n=1).
2. `tests/storage.test.js` com mocks de `localStorage`/IndexedDB (ou rodando o
   contrato só sobre `MemLayer` + `envelope/unwrap`).
3. GitHub Actions com `node --test` — o repositório já vive no GitHub e hoje
   não tem nenhum CI.

### 8.2 `app.js` monolítico
1211 linhas misturando estado, render de 5 abas, sheet e SW. Sem exigir
framework: extrair `js/render/serie.js`, `ritmo.js`, `causas.js`,
`registros.js`, `dados.js` e um `ui.js` (toast/sheet/tabs). Reduz conflito de
merge e torna cada view testável.

### 8.3 Duplicações pequenas
- Parse de data/hora do formulário duplicado (`js/app.js:974–976` e `987–989`).
- `renderLive` recalcula "último registro" com varredura própria
  (`js/app.js:158`) quando `records` já está ordenado por `ts` desc.
- Cores hex repetidas em JS (`HEAT`, `CC`, cores de gráfico) que já existem
  como tokens CSS — centralizar num módulo `theme.js` (pré-requisito do modo
  escuro, §4.4).

### 8.4 Versionamento de schema
`envelope.v = 1` e `doc.schema = 1` existem mas nenhum leitor os confere. Antes
da primeira mudança de formato, adicionar o gate (`if (env.v > 1) …`) — depois
que houver backups antigos circulando é tarde.

### 8.5 Ferramentas
Sem lint/format. `npm i -D eslint prettier` (só dev; runtime continua sem
dependências) + config mínima + CI pega erros de sintaxe antes do deploy — que
hoje só seriam descobertos pelo usuário, pois não há build que falhe.

---

## 9. Roteiro sugerido

| Fase | Itens | Esforço | Critério |
|---|---|---|---|
| **1 — Correções** ✅ | §1.1 shortcut, §1.3 corrida de gravação, §1.4 beforeunload, §2.1 F-crit, §2.2 t no IC, §1.8, §1.9 | ~1 dia | Bugs visíveis e riscos de perda de dados zerados |
| **2 — Confiança** ✅ | §8.1 testes + CI, §6.1 fontes locais, §6.3 validação de import, §3.4 lembrete de backup | 2–3 dias | O que o README promete passa a ser verdade |
| **3 — Valor** ✅ | §3.1 painel de custo, §3.2 marcos/recordes, §4.2 undo maior (§4.1 registro rápido adiado) | 3–4 dias | Motivo para o usuário voltar todo dia |
| **4 — Alcance** | §4.4 modo escuro, §5 acessibilidade, §3.5 busca, §3.6 CSV, §7 badging/multi-aba | contínuo | App confortável para qualquer usuário, a qualquer hora |

**Princípios preservados em todas as fases:** zero backend, zero rastreamento,
zero dependências de runtime, zero build step. Nada aqui exige abrir mão do que
torna o produto o que ele é.
