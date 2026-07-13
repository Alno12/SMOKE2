# SmokeCount — guia para o Claude Code

Contador de cigarros com motor estatístico. PWA offline-first, client-side puro.

## Princípios invioláveis do produto

- **Zero backend, zero conta, zero rastreamento** — dado de saúde vive só no dispositivo.
- **Zero dependências de runtime, zero build step** — ES modules puros, abre direto.
- **Offline sempre funciona** — registrar um cigarro sem rede é o caso de uso mínimo.
- Texto do app em **pt-BR**, números com vírgula decimal (`nf()`).
- Estatística **honesta**: valor crítico certo, vieses declarados, nunca inflar significância.

## Mapa do código

| Arquivo | Papel | Subagente dono | Modelo |
|---|---|---|---|
| `js/stats.js` | Motor estatístico — só funções puras | `stats-engineer` | fable |
| `js/storage.js` | Persistência em 3 camadas + backup/import | `storage-guardian` | opus |
| `js/app.js` | Estado, render, orquestração de UI | `ui-designer` | sonnet |
| `index.html` / `styles.css` | Markup e design system (tokens) | `ui-designer` | sonnet |
| `sw.js` / `manifest.json` / `netlify.toml` / `_headers` | PWA, cache, CSP, deploy | `pwa-platform` | sonnet |
| `tests/` | Suíte `node --test` | `qa-verifier` | sonnet |

Racional dos modelos: erro em `stats.js` é silencioso e mente ao usuário sobre
a própria saúde (raciocínio mais profundo disponível); erro em `storage.js`
perde dados irrecuperáveis (raciocínio forte sobre concorrência e falha
parcial); UI, plataforma e verificação são trabalho iterativo guiado por
convenções já embutidas nos prompts — modelo rápido rende mais ali.

## Orquestração com os subagentes (.claude/agents/)

O roteiro de evolução vive em **`MELHORIAS.md`** (fases 2–4 pendentes). Para
implementar um item:

1. Decomponha pela tabela acima e delegue cada parte ao agente dono — os
   prompts deles já carregam as convenções e armadilhas da sua camada.
2. Item que cruza camadas (ex.: painel de custo = cálculo + UI): `stats-engineer`
   primeiro (funções + testes), depois `ui-designer` consome o resultado.
3. **Sempre** feche com o `qa-verifier` antes de commitar mudança não-trivial —
   ele verifica sintaxe, roda `node --test` e exercita o app real no Chromium
   com dados semeados (protocolo de seed documentado no prompt dele).
4. Mudou qualquer arquivo do app shell? O bump de `VERSION` no `sw.js` é
   obrigatório no mesmo PR (senão apps instalados nunca recebem a mudança).

## Regras de trabalho

- Verificação mínima em qualquer mudança: `node --check` nos .js tocados.
- Nada de `node_modules`, artefatos de teste ou screenshots commitados no repo;
  trabalho auxiliar vai no scratchpad da sessão.
- Import/HTML: todo dado do usuário interpolado em HTML precisa de escape —
  backups importados são vetor de conteúdo arbitrário.
- PRs seguem o padrão do repo: seções "Resumo", "Alterações técnicas",
  "Test plan" (checklist do que foi verificado de verdade), e uma nota sobre
  impacto nos dados do usuário quando storage ou SW mudarem.
