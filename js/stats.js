/* ==========================================================================
   SmokeCount — Motor estatístico
   Funções puras. Nenhuma toca no DOM nem no armazenamento.
   ========================================================================== */

export const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

export const median = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const quantile = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};

export const variance = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
};

export const sd = a => Math.sqrt(variance(a));

export const mode = a => {
  if (!a.length) return 0;
  const c = {};
  a.forEach(x => c[x] = (c[x] || 0) + 1);
  return Number(Object.entries(c).sort((x, y) => y[1] - x[1])[0][0]);
};

export const skewness = a => {
  const m = mean(a), s = sd(a);
  if (!s || a.length < 3) return 0;
  return a.reduce((t, x) => t + ((x - m) / s) ** 3, 0) / a.length;
};

export const kurtosis = a => {
  const m = mean(a), s = sd(a);
  if (!s || a.length < 4) return 0;
  return a.reduce((t, x) => t + ((x - m) / s) ** 4, 0) / a.length - 3;
};

/** Índice de dispersão. =1 → Poisson puro. >1 → superdisperso (há gatilhos). */
export const dispersionIndex = a => {
  const m = mean(a);
  return m ? variance(a) / m : 0;
};

/** Regressão OLS sobre o índice. Retorna coeficientes, R², erro padrão e t. */
export const ols = y => {
  const n = y.length;
  if (n < 3) return { a: 0, b: 0, r2: 0, se: 0, t: 0, n, resid: 0 };
  const x = y.map((_, i) => i);
  const mx = mean(x), my = mean(y);
  const sxy = x.reduce((s, xi, i) => s + (xi - mx) * (y[i] - my), 0);
  const sxx = x.reduce((s, xi) => s + (xi - mx) ** 2, 0);
  const b = sxx ? sxy / sxx : 0;
  const a = my - b * mx;
  const yh = x.map(xi => a + b * xi);
  const ssr = y.reduce((s, yi, i) => s + (yi - yh[i]) ** 2, 0);
  const sst = y.reduce((s, yi) => s + (yi - my) ** 2, 0);
  const resid = Math.sqrt(ssr / (n - 2));
  const se = resid / Math.sqrt(sxx || 1);
  return { a, b, r2: sst ? 1 - ssr / sst : 0, se, t: se ? b / se : 0, n, resid };
};

/** Autocorrelação no lag k. */
export const acf = (y, lag) => {
  const n = y.length, m = mean(y);
  const d = y.reduce((s, v) => s + (v - m) ** 2, 0);
  if (!d || lag >= n) return 0;
  let c = 0;
  for (let i = lag; i < n; i++) c += (y[i] - m) * (y[i - lag] - m);
  return c / d;
};

/** Banda de significância da ACF (±1,96/√n). */
export const acfBand = n => (n > 0 ? 1.96 / Math.sqrt(n) : 0);

/** ANOVA de uma via. Retorna F e eta² (proporção da variância explicada). */
export const anova = groups => {
  const gs = groups.filter(g => g.length);
  if (gs.length < 2) return { F: 0, eta2: 0, df1: 0, df2: 0 };
  const all = gs.flat(), N = all.length, k = gs.length, gm = mean(all);
  const ssb = gs.reduce((s, g) => s + g.length * (mean(g) - gm) ** 2, 0);
  const ssw = gs.reduce((s, g) => {
    const m = mean(g);
    return s + g.reduce((t, x) => t + (x - m) ** 2, 0);
  }, 0);
  if (N - k <= 0) return { F: 0, eta2: 0, df1: k - 1, df2: 0 };
  const F = (ssb / (k - 1)) / ((ssw / (N - k)) || 1);
  return { F, eta2: (ssb + ssw) ? ssb / (ssb + ssw) : 0, df1: k - 1, df2: N - k };
};

/** Coeficiente de Gini. 0 = perfeitamente distribuído, 1 = tudo em um ponto. */
export const gini = a => {
  const s = [...a].sort((x, y) => x - y), n = s.length;
  const t = s.reduce((x, y) => x + y, 0);
  if (!t || !n) return 0;
  let c = 0;
  s.forEach((v, i) => c += (2 * (i + 1) - n - 1) * v);
  return c / (n * t);
};

/** Herfindahl-Hirschman: concentração das causas. */
export const hhi = shares => shares.reduce((s, p) => s + p ** 2, 0);

/** Valor crítico de t (bicaudal, 95%). Tabela até gl=30, depois normal. */
const T95 = [12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23,
             2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09,
             2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05, 2.04];
export const tCrit = df => df <= 0 ? 0 : df > 30 ? 1.96 : T95[df - 1];

/** Valor crítico de qui-quadrado (α=0,05) para gl de 1 a 20. */
const CHI95 = [3.84, 5.99, 7.81, 9.49, 11.07, 12.59, 14.07, 15.51, 16.92,
               18.31, 19.68, 21.03, 22.36, 23.68, 25.00, 26.30, 27.59,
               28.87, 30.14, 31.41];
export const chiCrit = df =>
  df <= 0 ? Infinity : df <= 20 ? CHI95[df - 1] : df + 1.645 * Math.sqrt(2 * df);

/**
 * Valor crítico de F (α=0,05) por tabela com interpolação em 1/df2.
 * Um limiar fixo (tipo "F > 2,2") erra nos dois sentidos: com poucas semanas
 * de dados o crítico real é bem maior (falso positivo), com meses é menor
 * (falso negativo). df1 coberto até 6 — a ANOVA do app compara os 7 dias da
 * semana, logo df1 = 6.
 */
const F95_DF2 = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 30, 60, Infinity];
const F95 = [ // linhas: df1 = 1..6 · colunas: df2 de F95_DF2
  [161.4, 18.51, 10.13, 7.71, 6.61, 5.99, 5.59, 5.32, 4.96, 4.75, 4.54, 4.35, 4.17, 4.00, 3.84],
  [199.5, 19.00,  9.55, 6.94, 5.79, 5.14, 4.74, 4.46, 4.10, 3.89, 3.68, 3.49, 3.32, 3.15, 3.00],
  [215.7, 19.16,  9.28, 6.59, 5.41, 4.76, 4.35, 4.07, 3.71, 3.49, 3.29, 3.10, 2.92, 2.76, 2.60],
  [224.6, 19.25,  9.12, 6.39, 5.19, 4.53, 4.12, 3.84, 3.48, 3.26, 3.06, 2.87, 2.69, 2.53, 2.37],
  [230.2, 19.30,  9.01, 6.26, 5.05, 4.39, 3.97, 3.69, 3.33, 3.11, 2.90, 2.71, 2.53, 2.37, 2.21],
  [234.0, 19.33,  8.94, 6.16, 4.95, 4.28, 3.87, 3.58, 3.22, 3.00, 2.79, 2.60, 2.42, 2.25, 2.10]
];
export const fCrit = (df1, df2) => {
  if (df1 <= 0 || df2 <= 0) return Infinity;
  const row = F95[Math.min(df1, 6) - 1];
  if (df2 >= F95_DF2[F95_DF2.length - 2] * 4) return row[row.length - 1];
  let i = 0;
  while (i < F95_DF2.length - 1 && F95_DF2[i + 1] <= df2) i++;
  if (F95_DF2[i] === df2 || i === F95_DF2.length - 1) return row[i];
  // Interpola em 1/df2: a curva de F é quase linear nessa escala.
  const a = 1 / F95_DF2[i], b = 1 / F95_DF2[i + 1], x = 1 / df2;
  const t = (x - a) / (b - a);
  return row[i] + t * (row[i + 1] - row[i]);
};

/** Intervalo de confiança 95% da média. */
export const ciMean = a => {
  const n = a.length;
  if (n < 2) return { lo: null, hi: null, half: null };
  const m = mean(a), half = tCrit(n - 1) * sd(a) / Math.sqrt(n);
  return { lo: m - half, hi: m + half, half };
};

/**
 * Sigma robusto via amplitude móvel (MR-bar / 1,128).
 *
 * O desvio padrão comum é calculado contra a média global, então uma tendência
 * ou uma mudança de patamar o inflam artificialmente — e limites de controle
 * inflados não detectam nada. A amplitude móvel usa apenas diferenças entre
 * pontos *consecutivos*, o que a torna insensível a deriva de longo prazo e
 * é o estimador padrão em cartas de controle para observações individuais.
 */
export const sigmaMR = y => {
  if (y.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < y.length; i++) s += Math.abs(y[i] - y[i - 1]);
  return (s / (y.length - 1)) / 1.128;   // d2 para n=2
};

/**
 * Carta de controle EWMA.
 *
 * Ponto crítico: os parâmetros de controle (centro e sigma) precisam vir de um
 * PERÍODO-BASE, não da série inteira. Estimar o centro sobre todos os dados faz
 * a própria mudança que queremos detectar contaminar os parâmetros: o centro
 * assenta no meio dos dois patamares e o sigma incha, abrindo limites tão largos
 * que nenhum ponto cai fora. É a carta se cegando com o próprio sinal.
 *
 * Aqui a base são os primeiros `baseline` pontos (padrão: 40% da série, no
 * mínimo 7 e no máximo 30 dias). O restante é testado contra esse padrão de
 * referência — é isso que responde à pergunta real do usuário: "o meu consumo
 * mudou em relação a como eu era antes?"
 *
 * @param {number[]} y      série diária
 * @param {number}   lambda peso do dado novo (0,3 = padrão da literatura)
 * @param {number}   L      largura dos limites em sigmas (3 = padrão)
 */
export const ewmaChart = (y, lambda = 0.3, L = 3, baseline = null) => {
  const n = y.length;
  if (n < 3) {
    return { z: [...y], mu: mean(y), sd: 0, limit: () => 0, out: [],
             baselineN: 0, belowNow: false, aboveNow: false };
  }

  const nb = baseline ?? Math.min(30, Math.max(7, Math.round(n * 0.4)));
  const base = y.slice(0, Math.min(nb, n));

  const mu = mean(base);
  // Usa o maior entre sigma-MR e sigma amostral da base: o MR protege contra
  // deriva, mas se a base for muito curta pode subestimar. Um piso pequeno
  // evita limites degenerados quando a base é constante.
  const s = Math.max(sigmaMR(base), sd(base), 0.35);

  const z = [];
  let cur = mu;
  y.forEach(v => { cur = lambda * v + (1 - lambda) * cur; z.push(cur); });

  const limit = i =>
    L * s * Math.sqrt((lambda / (2 - lambda)) * (1 - (1 - lambda) ** (2 * (i + 1))));

  const out = [];
  z.forEach((v, i) => {
    if (i < base.length) return;          // a base define o normal; não se julga
    const l = limit(i);
    if (v > mu + l || v < mu - l) out.push(i);
  });

  const last = n - 1;
  const lastLim = limit(last);
  return {
    z, mu, sd: s, limit, out,
    baselineN: base.length,
    belowNow: z[last] < mu - lastLim,
    aboveNow: z[last] > mu + lastLim
  };
};

/** Kaplan-Meier sobre os intervalos (sem censura: todo evento é observado). */
export const survival = (gaps, tMax = 200, step = 4) => {
  const s = [...gaps].sort((a, b) => a - b);
  const n = s.length || 1;
  const pts = [];
  for (let t = 0; t <= tMax; t += step) {
    pts.push([t, s.filter(g => g > t).length / n]);
  }
  return pts;
};

/** Função de risco discreta: P(evento na faixa | sobreviveu até ela). */
export const hazard = (gaps, binWidth = 20, bins = 10) => {
  const s = [...gaps].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < bins; i++) {
    const a = i * binWidth, b = a + binWidth;
    const atRisk = s.filter(g => g >= a).length;
    const events = s.filter(g => g >= a && g < b).length;
    out.push(atRisk ? events / atRisk : 0);
  }
  return out;
};

/** Curva de Lorenz para um vetor de contagens. */
export const lorenz = counts => {
  const s = [...counts].sort((a, b) => a - b);
  const total = s.reduce((a, b) => a + b, 0) || 1;
  const pts = [[0, 0]];
  let cum = 0;
  s.forEach((v, i) => { cum += v; pts.push([(i + 1) / s.length, cum / total]); });
  return pts;
};

/** Matriz de transição de Markov entre categorias, dentro de cada sequência. */
export const markov = (sequences, states) => {
  const M = {};
  states.forEach(a => { M[a] = {}; states.forEach(b => M[a][b] = 0); });
  sequences.forEach(seq => {
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], b = seq[i];
      if (states.includes(a) && states.includes(b)) M[a][b]++;
    }
  });
  const P = {}, totals = {};
  states.forEach(a => {
    const t = states.reduce((s, b) => s + M[a][b], 0);
    totals[a] = t;
    P[a] = {};
    states.forEach(b => P[a][b] = t ? M[a][b] / t : 0);
  });
  // Elo mais forte, exigindo massa mínima para não celebrar ruído.
  let best = { from: null, to: null, p: 0, n: 0 };
  states.forEach(a => states.forEach(b => {
    if (totals[a] >= 4 && P[a][b] > best.p) {
      best = { from: a, to: b, p: P[a][b], n: M[a][b] };
    }
  }));
  return { counts: M, probs: P, totals, best };
};

/** Qui-quadrado de independência com resíduos padronizados. */
export const chiSquare = observed => {
  const rows = observed.length, cols = observed[0]?.length || 0;
  const rowT = observed.map(r => r.reduce((a, b) => a + b, 0));
  const colT = Array.from({ length: cols }, (_, j) =>
    observed.reduce((s, r) => s + r[j], 0));
  const N = rowT.reduce((a, b) => a + b, 0) || 1;
  let chi = 0;
  const resid = observed.map((r, i) => r.map((o, j) => {
    const E = rowT[i] * colT[j] / N;
    if (E <= 0) return 0;
    chi += (o - E) ** 2 / E;
    return (o - E) / Math.sqrt(E);
  }));
  const df = (rows - 1) * (cols - 1);
  return { chi, df, crit: chiCrit(df), significant: chi > chiCrit(df), resid, rowT, colT, N };
};

/* ==========================================================================
   Agregações de domínio
   ========================================================================== */

export const dayKey = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Série diária contínua, com zeros nos dias sem registro. */
export const dailySeries = records => {
  if (!records.length) return { days: [], values: [] };
  const m = {};
  records.forEach(r => {
    const k = dayKey(r.ts);
    m[k] = (m[k] || 0) + 1;
  });
  const keys = Object.keys(m).sort();
  const start = new Date(keys[0] + 'T00:00:00');
  const end = new Date(keys[keys.length - 1] + 'T00:00:00');
  const days = [], values = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
    values.push(m[dayKey(d)] || 0);
  }
  return { days, values };
};

/** Intervalos entre cigarros consecutivos, em minutos, dentro do mesmo dia. */
export const intervals = records => {
  const byDay = {};
  records.forEach(r => {
    const k = dayKey(r.ts);
    (byDay[k] = byDay[k] || []).push(new Date(r.ts));
  });
  const gaps = [];
  Object.values(byDay).forEach(list => {
    list.sort((a, b) => a - b);
    for (let i = 1; i < list.length; i++) {
      gaps.push((list[i] - list[i - 1]) / 60000);
    }
  });
  return gaps;
};

/** Distribuição por hora do dia (24 posições). */
export const hourHistogram = records => {
  const h = new Array(24).fill(0);
  records.forEach(r => h[new Date(r.ts).getHours()]++);
  return h;
};

/** Minutos decorridos desde o cigarro mais recente. null se não houver registros. */
export const minutesSinceLast = (records, now = new Date()) => {
  const tNow = now.getTime();
  let last = -Infinity;
  records.forEach(r => {
    const t = new Date(r.ts).getTime();
    if (t <= tNow && t > last) last = t;
  });
  return last === -Infinity ? null : (tNow - last) / 60000;
};

/**
 * Ritmo típico deste dia da semana até o horário atual.
 *
 * Para o mesmo dia da semana de `now`, olha cada ocorrência anterior (excluindo
 * hoje) e conta quantos cigarros foram fumados até o mesmo horário — os minutos
 * decorridos desde a meia-noite. Um dia observado em que nada foi fumado até ali
 * conta como zero, puxando a média para baixo: é a comparação honesta com
 * "como eu costumo estar a esta hora, neste dia da semana".
 */
export const weekdayPace = (records, now = new Date()) => {
  const dow = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayKey = dayKey(now);
  const total = {}, upTo = {};
  records.forEach(r => {
    const d = new Date(r.ts);
    if (d.getDay() !== dow) return;
    const k = dayKey(d);
    if (k === todayKey) return;
    total[k] = (total[k] || 0) + 1;
    if (d.getHours() * 60 + d.getMinutes() <= nowMin) upTo[k] = (upTo[k] || 0) + 1;
  });
  const days = Object.keys(total);
  const counts = days.map(k => upTo[k] || 0);
  const full = days.map(k => total[k]);
  return {
    dow,
    nDays: days.length,
    avgUpToNow: counts.length ? mean(counts) : null,
    avgFullDay: full.length ? mean(full) : null
  };
};

/** Matriz dia-da-semana × bloco de 2h, normalizada por número de dias. */
export const weekHourMatrix = records => {
  const M = Array.from({ length: 7 }, () => new Array(12).fill(0));
  const dayCount = new Array(7).fill(0);
  const seen = new Set();
  records.forEach(r => {
    const d = new Date(r.ts);
    M[d.getDay()][Math.floor(d.getHours() / 2)]++;
    const k = dayKey(d);
    if (!seen.has(k)) { seen.add(k); dayCount[d.getDay()]++; }
  });
  const norm = M.map((row, d) => row.map(v => dayCount[d] ? v / dayCount[d] : 0));
  return { counts: M, norm, dayCount };
};

/** Primeiro e último cigarro de cada dia, em horas decimais. */
export const firstLast = records => {
  const byDay = {};
  records.forEach(r => {
    const k = dayKey(r.ts);
    (byDay[k] = byDay[k] || []).push(new Date(r.ts));
  });
  const firsts = [], lasts = [];
  Object.values(byDay).forEach(l => {
    l.sort((a, b) => a - b);
    firsts.push(l[0].getHours() + l[0].getMinutes() / 60);
    const x = l[l.length - 1];
    lasts.push(x.getHours() + x.getMinutes() / 60);
  });
  return { firsts, lasts };
};

/** Sequências diárias de causas, para a cadeia de Markov. */
export const causeSequences = records => {
  const byDay = {};
  records.forEach(r => {
    const k = dayKey(r.ts);
    (byDay[k] = byDay[k] || []).push(r);
  });
  return Object.values(byDay).map(l =>
    l.sort((a, b) => new Date(a.ts) - new Date(b.ts)).map(r => r.cause)
  );
};

/** Soma `n` dias a uma data local, devolvendo nova instância (sem mutar). */
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/**
 * Painel de custo financeiro (§3.1).
 *
 * Custo por cigarro = price/perPack. Todo valor monetário é número em R$;
 * a formatação (vírgula decimal) é responsabilidade da UI. Se price/perPack
 * estiverem ausentes ou inválidos (≤0, não numéricos), os campos monetários
 * voltam null — as CONTAGENS continuam preenchidas, para a UI poder mostrar
 * "configure o preço" sem esconder o dado real.
 *
 * Janelas por dia-calendário local: `today` é o dia de `now`; `week` são os
 * últimos 7 dias corridos (hoje + 6 anteriores); `month`, os últimos 30.
 * Registros com ts futuro em relação a `now` são ignorados (mesmo contrato
 * de minutesSinceLast).
 *
 * Vieses declarados:
 * - `daysTracked` vai do dia do primeiro registro até HOJE (inclusive), mesmo
 *   que o último registro seja antigo — parar de registrar não zera o hábito,
 *   e excluir os dias recentes inflaria a média. O dia de hoje é parcial e
 *   entra no denominador, subestimando levemente `perDayAvg` no início do dia.
 * - `projectedYear` extrapola o ritmo MÉDIO observado, de propósito: não
 *   projeta tendência de queda nem promete economia — é "quanto custa um ano
 *   como os dias já vividos".
 * - `trendScenario` é um CENÁRIO separado e opcional, não uma previsão:
 *   só existe quando a OLS sobre a série diária indica queda estatisticamente
 *   significativa (b<0 e |t| > tCrit(n−2)) com pelo menos 14 dias de série —
 *   menos que dois ciclos semanais deixa o efeito dia-da-semana se passar por
 *   tendência. O gasto projetado usa a reta com piso em zero (consumo não fica
 *   negativo) e o retorno NÃO inclui nenhuma "data de zero cigarros" (§2.6):
 *   consumo não cai linear até zero, então só se informa a diferença de gasto
 *   sob a hipótese "se a reta atual se mantivesse".
 */
export const costSummary = (records, config = {}, now = new Date()) => {
  const price = Number(config?.price);
  const perPack = Number(config?.perPack);
  const hasPrice = Number.isFinite(price) && price > 0 &&
                   Number.isFinite(perPack) && perPack > 0;
  const costPerCig = hasPrice ? price / perPack : null;

  const tNow = now.getTime();
  const past = records.filter(r => new Date(r.ts).getTime() <= tNow);

  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = dayKey(today0);
  const weekKeys = new Set(), monthKeys = new Set();
  for (let i = 0; i < 30; i++) {
    const k = dayKey(addDays(today0, -i));
    if (i < 7) weekKeys.add(k);
    monthKeys.add(k);
  }

  const counts = { today: 0, week: 0, month: 0, sinceStart: past.length };
  let firstKey = null;
  past.forEach(r => {
    const k = dayKey(r.ts);
    if (k === todayKey) counts.today++;
    if (weekKeys.has(k)) counts.week++;
    if (monthKeys.has(k)) counts.month++;
    if (!firstKey || k < firstKey) firstKey = k;
  });

  let daysTracked = 0;
  if (firstKey) {
    const first = new Date(firstKey + 'T00:00:00');
    // round absorve horas de verão (dias de 23/25h) na diferença em dias.
    daysTracked = Math.round((today0 - first) / 86400000) + 1;
  }

  const money = c => (hasPrice ? c * costPerCig : null);
  const cost = {
    today: money(counts.today),
    week: money(counts.week),
    month: money(counts.month),
    sinceStart: money(counts.sinceStart)
  };
  const perDayAvg = hasPrice && daysTracked > 0 ? cost.sinceStart / daysTracked : null;
  const projectedYear = perDayAvg === null ? null : perDayAvg * 365;

  let trendScenario = null;
  if (hasPrice) {
    const { values } = dailySeries(past);
    const n = values.length;
    if (n >= 14) {
      const fit = ols(values);
      const crit = tCrit(n - 2);
      if (fit.b < 0 && Math.abs(fit.t) > crit) {
        const HORIZON = 365;
        let projCigs = 0;
        for (let d = 1; d <= HORIZON; d++) {
          projCigs += Math.max(0, fit.a + fit.b * (n - 1 + d));
        }
        const spendAtCurrentPace = mean(values) * HORIZON * costPerCig;
        const spendIfTrendHolds = projCigs * costPerCig;
        const savings = spendAtCurrentPace - spendIfTrendHolds;
        if (savings > 0) {
          trendScenario = {
            horizonDays: HORIZON,
            spendAtCurrentPace,
            spendIfTrendHolds,
            savings,
            slopePerDay: fit.b,
            n,
            t: fit.t,
            tCrit: crit
          };
        }
      }
    }
  }

  return { costPerCig, counts, daysTracked, cost, perDayAvg, projectedYear, trendScenario };
};

/**
 * Recordes pessoais (§3.2).
 *
 * Decisões de honestidade, declaradas:
 *
 * - `longestGap` é o maior intervalo CORRIDO entre dois cigarros consecutivos,
 *   atravessando viradas de dia: para "recorde de resistência" o que importa é
 *   o tempo real sem fumar. O preço declarado: a noite de sono (e eventuais
 *   lacunas de registro de vários dias) inflam o número. Por isso existe
 *   também `longestGapSameDay`, no espírito de `intervals` — o maior intervalo
 *   dentro de um mesmo dia, imune ao sono. A UI deve apresentar os dois com os
 *   rótulos certos. O intervalo em aberto desde o último cigarro até agora é
 *   CENSURADO (ainda não terminou) e não entra; a UI pode compará-lo via
 *   minutesSinceLast contra longestGap.minutes.
 *
 * - `bestDay` percorre a série diária contígua (dailySeries): um dia sem
 *   nenhum registro DENTRO do período rastreado conta como zero — está entre
 *   o primeiro e o último registro, logo o app estava em uso. Dias fora desse
 *   período nunca existiram para o app e não entram. Como um zero interno
 *   também pode ser só esquecimento de registrar, `bestDayNonZero` dá o
 *   melhor dia com pelo menos um registro, que é imune a esse viés.
 *
 * - `bestWeek` usa semanas-calendário iniciando na segunda-feira (ISO 8601) e
 *   SÓ considera semanas com os 7 dias dentro do período rastreado: uma semana
 *   parcial de 2 dias "ganharia" por amostragem, não por mérito. Menos de uma
 *   semana completa de dados → null.
 *
 * - As sequências abaixo da meta usam a série diária contígua e PARAM no dia
 *   do último registro: dias posteriores sem registro algum podem ser abandono
 *   do app, não abstinência — estendê-los inflaria o recorde. O dia corrente,
 *   se tiver registro, entra ainda parcial (pode estourar a meta até a
 *   meia-noite); viés declarado. Meta inválida (ausente, ≤0) → streaks null.
 *
 * - Registros com ts FUTURO em relação a `now` são descartados antes de
 *   qualquer cálculo (mesmo contrato de costSummary e minutesSinceLast):
 *   um recorde ancorado num momento que ainda não aconteceu seria mentira,
 *   e um registro futuro esticaria a série diária com zeros de dias ainda
 *   não vividos — inflando bestDay e as sequências.
 *
 * - Empates são resolvidos pela ocorrência MAIS RECENTE em todos os recordes.
 */
export const personalRecords = (records, config = {}, now = new Date()) => {
  const empty = {
    longestGap: null, longestGapSameDay: null,
    bestDay: null, bestDayNonZero: null, bestWeek: null,
    longestStreakUnderGoal: null, currentStreakUnderGoal: null
  };
  const tNow = now.getTime();
  const past = records.filter(r => new Date(r.ts).getTime() <= tNow);
  if (!past.length) return empty;

  const times = past.map(r => new Date(r.ts)).sort((a, b) => a - b);

  // Maior intervalo corrido e maior intervalo dentro do mesmo dia.
  let longestGap = null, longestGapSameDay = null;
  for (let i = 1; i < times.length; i++) {
    const gap = { minutes: (times[i] - times[i - 1]) / 60000, from: times[i - 1], to: times[i] };
    if (!longestGap || gap.minutes >= longestGap.minutes) longestGap = gap;
    if (dayKey(times[i]) === dayKey(times[i - 1]) &&
        (!longestGapSameDay || gap.minutes >= longestGapSameDay.minutes)) {
      longestGapSameDay = gap;
    }
  }

  const { days, values } = dailySeries(past);

  // Melhor dia (zeros internos contam) e melhor dia não-zero.
  let bi = 0, bnz = -1;
  values.forEach((v, i) => {
    if (v <= values[bi]) bi = i;
    if (v > 0 && (bnz < 0 || v <= values[bnz])) bnz = i;
  });
  const bestDay = { date: dayKey(days[bi]), count: values[bi] };
  const bestDayNonZero = bnz >= 0 ? { date: dayKey(days[bnz]), count: values[bnz] } : null;

  // Melhor semana-calendário completa (segunda a domingo).
  const weeks = {};
  days.forEach((d, i) => {
    const k = dayKey(addDays(d, -((d.getDay() + 6) % 7)));   // segunda da semana
    const w = weeks[k] = weeks[k] || { total: 0, n: 0 };
    w.total += values[i];
    w.n++;
  });
  let bestWeek = null;
  Object.keys(weeks).sort().forEach(k => {
    const w = weeks[k];
    if (w.n < 7) return;                                     // semana parcial não compete
    const avgPerDay = w.total / 7;
    if (!bestWeek || avgPerDay <= bestWeek.avgPerDay) {
      bestWeek = {
        start: k,
        end: dayKey(addDays(new Date(k + 'T00:00:00'), 6)),
        avgPerDay,
        total: w.total
      };
    }
  });

  // Sequências de dias com contagem ≤ meta.
  const goal = Number(config?.goal);
  let longestStreakUnderGoal = null, currentStreakUnderGoal = null;
  if (Number.isFinite(goal) && goal > 0) {
    let best = { days: 0, start: null, end: null };
    let runStart = -1;
    values.forEach((v, i) => {
      if (v <= goal) {
        if (runStart < 0) runStart = i;
        const len = i - runStart + 1;
        if (len >= best.days) {
          best = { days: len, start: dayKey(days[runStart]), end: dayKey(days[i]) };
        }
      } else {
        runStart = -1;
      }
    });
    longestStreakUnderGoal = best;
    currentStreakUnderGoal = runStart >= 0
      ? { days: values.length - runStart, start: dayKey(days[runStart]), end: dayKey(days[values.length - 1]) }
      : { days: 0, start: null, end: null };
  }

  return {
    longestGap, longestGapSameDay,
    bestDay, bestDayNonZero, bestWeek,
    longestStreakUnderGoal, currentStreakUnderGoal
  };
};

/** Agregação por causa: N, participação, vontade média e IC. */
export const byCause = records => {
  const withCause = records.filter(r => r.cause);
  const agg = {};
  withCause.forEach(r => {
    const a = agg[r.cause] = agg[r.cause] || { n: 0, cravings: [] };
    a.n++;
    if (r.craving) a.cravings.push(r.craving);
  });
  const rows = Object.entries(agg).map(([cause, v]) => {
    const ci = ciMean(v.cravings);
    return {
      cause,
      n: v.n,
      pct: v.n / withCause.length * 100,
      craving: v.cravings.length ? mean(v.cravings) : null,
      ci: ci.half,
      cn: v.cravings.length
    };
  }).sort((a, b) => b.n - a.n);
  return { rows, total: withCause.length, coverage: records.length ? withCause.length / records.length * 100 : 0 };
};
