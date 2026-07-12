# SmokeCount — Statistical Engine

Contador de cigarros com motor estatístico. Todas as análises são calculadas
ao vivo a partir dos registros do usuário. PWA offline-first, sem backend,
sem rastreamento, sem conta.

---

## Deploy no Netlify

### Opção 1 — arrastar e soltar (mais rápido)

1. Comprima o conteúdo desta pasta em um `.zip` (o conteúdo, não a pasta em si:
   o `index.html` precisa ficar na raiz do zip).
2. Vá em [app.netlify.com/drop](https://app.netlify.com/drop).
3. Arraste o `.zip`. Pronto — o site sai no ar em segundos.

### Opção 2 — Git (recomendado, permite atualizações)

```bash
git init
git add .
git commit -m "SmokeCount"
git remote add origin git@github.com:SEU_USUARIO/smokecount.git
git push -u origin main
```

No Netlify: **Add new site → Import an existing project** → escolha o repositório.
Não há build step. As configurações já estão no `netlify.toml`:

| Campo             | Valor |
|-------------------|-------|
| Build command     | *(vazio)* |
| Publish directory | `.` |

### Opção 3 — CLI

```bash
npm i -g netlify-cli
netlify deploy --prod
```

> **HTTPS é obrigatório.** O service worker e o armazenamento persistente só
> funcionam sob HTTPS. O Netlify já entrega TLS por padrão — não desative.

---

## Camadas de persistência

Os dados são de saúde e vivem **só no dispositivo do usuário**. Nada vai para
servidor. Por isso a persistência é o ponto mais crítico do produto: se ela
falhar, o usuário perde meses de histórico e o app perde todo o sentido.

Nenhuma API de armazenamento do navegador é confiável isoladamente. IndexedDB
pode estar bloqueado; localStorage estoura cota; o modo privado derruba os dois;
e o Safari descarta dados após ~7 dias sem uso. A defesa é em profundidade:

### L1 — IndexedDB (primária)
Alta capacidade, transacional. Onde os dados normalmente vivem.

### L2 — localStorage (espelho)
Toda gravação é replicada aqui. Se o IndexedDB falhar ou corromper, o app
continua funcionando sem o usuário perceber.

### L3 — Memória (último recurso)
Se as duas anteriores estiverem bloqueadas (modo privado, cota zero), o app
**ainda funciona na sessão** em vez de quebrar — e avisa o usuário, com um
banner, que os dados somem ao fechar.

### Proteções sobre as camadas

| Mecanismo | Problema que resolve |
|---|---|
| **Checksum (FNV-1a)** por snapshot | Corrupção silenciosa e escrita parcial. Um payload adulterado é detectado e rejeitado em vez de ser carregado como se fosse válido. |
| **Escrita atômica** (temp → valida → promove) | Uma falha no meio da gravação não deixa o registro principal num estado meio escrito. |
| **Snapshots rotativos** (últimos 5) | Erro do usuário ou bug de app. Dá pontos de retorno, restauráveis pela aba *Dados*. |
| **Timestamp monotônico** | Duas gravações no mesmo milissegundo colidiriam de chave e um snapshot sobrescreveria o outro — justamente durante rajadas de edição, quando os pontos de retorno mais importam. |
| **Auto-reparo entre camadas** | Na leitura, o snapshot mais recente e válido é replicado de volta nas camadas que divergiram ou falharam. As camadas se curam sozinhas. |
| **Recuperação por backup** | Se *todas* as vias principais estiverem corrompidas, o app varre os snapshots e restaura o mais recente que passar no checksum. |
| **Flush no `visibilitychange`** | Em mobile, `beforeunload` não dispara de forma confiável. O app grava ao sair de foco. |
| **Debounce de gravação** | Rajadas de edição viram uma única escrita, evitando desgaste e condições de corrida. |
| **`navigator.storage.persist()`** | Pede ao navegador que não descarte os dados sob pressão de espaço. Sem isso, o Safari apaga o IndexedDB após dias de inatividade. |
| **Export / Import JSON** | A única defesa real contra perda do dispositivo. Nenhuma camada local protege contra o celular cair na privada. |

### O limite honesto

Armazenamento local **não é backup**. Limpar os dados do navegador, desinstalar
o PWA ou perder o aparelho apaga tudo. A aba *Dados* deixa isso explícito e
mostra a data do último export. Exportar periodicamente é a única garantia real.

O merge no import é idempotente: reimportar o mesmo arquivo não duplica nada.
Em conflito de `id`, vence o registro com `editedAt` mais recente.

---

## Motor estatístico

Em `js/stats.js` — funções puras, sem DOM, sem storage. Testado contra valores
conhecidos e casos-limite.

**Descritivas** — média, mediana, moda, desvio padrão, CV, IQR, assimetria,
curtose, e o **índice de dispersão** (variância/média): distingue consumo
Poisson puro (aleatório, ≈1) de superdisperso (>1, há dias de gatilho).

**Série temporal**
- **OLS com teste t** — a tendência é estatisticamente significativa ou você
  está lendo ruído?
- **Carta de controle EWMA** — usa **período-base** (primeiros ~40% dos dias) e
  **sigma robusto por amplitude móvel**. Estimar o centro sobre a série inteira
  seria um erro: a própria mudança que se quer detectar contaminaria os
  parâmetros, inflando os limites até que nada pudesse cair fora deles.
- **ACF (lag 1–14)** com bandas de significância — detecta ciclo semanal.
- **ANOVA de uma via** — F e η² para o efeito do dia da semana.
- **Projeção OLS** com intervalo de predição.

**Ritmo intradiário**
- **Kaplan–Meier** sobre os intervalos entre cigarros.
- **Função de risco** por faixa — revela fumo em cadeia.
- **Lorenz + Gini** — o hábito é ritualizado (alvo cirúrgico) ou difuso?

**Causas**
- Vontade média por causa com **IC 95%**.
- **HHI** de concentração.
- **Cadeia de Markov** causa → próxima causa: encontra o elo mais forte.
- **Qui-quadrado** causa × período do dia, com resíduos padronizados.

---

## Estrutura

```
index.html          markup
styles.css          estilos
js/storage.js       camadas de persistência (isolada, testável)
js/stats.js         motor estatístico (funções puras)
js/app.js           estado, render, orquestração
sw.js               service worker (offline-first)
manifest.json       PWA
netlify.toml        headers de segurança, cache, CSP
_headers            redundância para deploy drag-and-drop
```

Sem dependências, sem build, sem `node_modules`. Abre direto no navegador.

## Segurança

CSP restritiva (`connect-src 'self'` — o app não fala com servidor nenhum),
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, e `Permissions-Policy`
negando geolocalização, câmera e microfone. O `sw.js` e o `index.html` são
servidos com `must-revalidate` para o app nunca travar numa versão antiga.

## Desenvolvimento

Módulos ES exigem um servidor HTTP (não funciona via `file://`):

```bash
python3 -m http.server 8000
# http://localhost:8000
```

---

## Aviso

Ferramenta de autoconhecimento, não dispositivo médico. As estimativas de saúde
são educativas e não substituem orientação profissional. Para apoio na cessação
do tabagismo, procure um profissional de saúde ou, no Brasil, ligue **136**
(Disque Saúde).
