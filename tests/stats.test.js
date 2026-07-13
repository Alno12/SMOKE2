/* ==========================================================================
   SmokeCount — testes do motor estatístico (js/stats.js)

   Runner: node --test (nativo, zero dependências — princípio do repo).

   Todos os valores de referência foram calculados EXTERNAMENTE (à mão ou
   conferidos contra tabelas estatísticas publicadas), nunca copiados da
   própria implementação — senão o teste só provaria que o código é igual
   a si mesmo.

   Datas dos testes de domínio são construídas com o construtor local
   (new Date(ano, mês, dia, hora, min)) para serem independentes de fuso.
   ========================================================================== */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  mean, median, quantile, variance, sd, mode, skewness, kurtosis,
  dispersionIndex, ols, acf, acfBand, anova, gini, hhi, lorenz,
  tCrit, chiCrit, fCrit, ciMean, sigmaMR, ewmaChart, survival, hazard,
  markov, chiSquare, dayKey, dailySeries, intervals, hourHistogram,
  minutesSinceLast, weekdayPace, weekHourMatrix, firstLast,
  causeSequences, byCause
} from '../js/stats.js';

/** Compara floats com tolerância; também falha se `got` for NaN/Infinity. */
const close = (got, want, eps = 1e-9, msg = '') =>
  assert.ok(Number.isFinite(got) && Math.abs(got - want) < eps,
    `${msg} esperado ≈ ${want}, veio ${got}`);

/** Timestamp local em ms (mês humano: 1–12). */
const ts = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

/** Registro mínimo do domínio. */
const rec = (t, cause, craving) => ({ ts: t, cause, craving });

/* ==========================================================================
   Descritivas
   ========================================================================== */

describe('mean', () => {
  it('média simples', () => close(mean([1, 2, 3, 4]), 2.5));
  it('valor único', () => close(mean([5]), 5));
});

describe('median', () => {
  it('n ímpar, desordenado', () => close(median([3, 1, 2]), 2));
  it('n par → média dos centrais', () => close(median([1, 2, 3, 4]), 2.5));
  it('não muta o array de entrada', () => {
    const a = [3, 1, 2];
    median(a);
    assert.deepStrictEqual(a, [3, 1, 2]);
  });
});

describe('quantile', () => {
  it('p=0 → mínimo', () => close(quantile([5, 1, 3], 0), 1));
  it('p=1 → máximo', () => close(quantile([5, 1, 3], 1), 5));
  it('p=0,5 → mediana', () => close(quantile([1, 2, 3, 4, 5], 0.5), 3));
  it('p=0,25 em n=5 cai em ponto exato', () => close(quantile([1, 2, 3, 4, 5], 0.25), 2));
  it('interpolação linear: p=0,1 em [1..5] → 1,4', () =>
    close(quantile([1, 2, 3, 4, 5], 0.1), 1.4));
  it('interpolação em n=2: p=0,5 de [10,20] → 15', () => close(quantile([10, 20], 0.5), 15));
});

describe('variance / sd (amostrais, n−1)', () => {
  // Conjunto clássico: variância amostral = 32/7 (populacional seria 4).
  const a = [2, 4, 4, 4, 5, 5, 7, 9];
  it('variância amostral 32/7', () => close(variance(a), 32 / 7));
  it('sd = √(32/7)', () => close(sd(a), Math.sqrt(32 / 7)));
});

describe('mode', () => {
  it('moda única', () => assert.strictEqual(mode([1, 2, 2, 3, 3, 3]), 3));
});

describe('skewness / kurtosis (momentos padronizados, viés não corrigido)', () => {
  it('série simétrica → skew 0 exato', () => close(skewness([1, 2, 3, 4, 5]), 0));
  // [1,1,1,5]: m=2, sd amostral=2 → skew = ((−0,5)³·3 + 1,5³)/4 = 0,75
  it('assimetria à direita conhecida', () => close(skewness([1, 1, 1, 5]), 0.75));
  // kurtosis excesso: ((0,5⁴·3 + 1,5⁴)/4) − 3 = 1,3125 − 3 = −1,6875
  it('curtose em excesso conhecida', () => close(kurtosis([1, 1, 1, 5]), -1.6875));
});

describe('dispersionIndex', () => {
  // [0,4]: média 2, variância amostral 8 → índice 4 (superdisperso)
  it('variância/média', () => close(dispersionIndex([0, 4]), 4));
});

/* ==========================================================================
   OLS
   ========================================================================== */

describe('ols', () => {
  it('reta perfeita y=2x+1: b=2, a=1, r2=1, resid=0', () => {
    const r = ols([1, 3, 5, 7, 9]);
    close(r.b, 2);
    close(r.a, 1);
    close(r.r2, 1);
    close(r.resid, 0);
    assert.strictEqual(r.n, 5);
  });

  it('série plana: b=0, a=nível, r2=0', () => {
    const r = ols([4, 4, 4, 4, 4]);
    close(r.b, 0);
    close(r.a, 4);
    close(r.r2, 0);
  });

  it('caso com ruído, valores fechados à mão', () => {
    // y=[1,2,2,3,4]: sxy=7, sxx=10 → b=0,7; a=1; ssr=0,30; sst=5,2
    const r = ols([1, 2, 2, 3, 4]);
    close(r.b, 0.7);
    close(r.a, 1.0);
    close(r.r2, 1 - 0.3 / 5.2);          // ≈ 0,942307692...
    close(r.resid, Math.sqrt(0.1));      // √(ssr/(n−2))
    close(r.se, 0.1);                    // resid/√sxx = √0,1/√10
    close(r.t, 7);                       // b/se
  });
});

/* ==========================================================================
   ACF / ANOVA / concentração
   ========================================================================== */

describe('acf / acfBand', () => {
  it('lag 0 → 1 para série não constante', () => close(acf([1, 2, 3, 4], 0), 1));
  // [1,2,3,4], m=2,5, denom=5, num(lag1)=1,25 → 0,25
  it('lag 1 de [1,2,3,4] → 0,25', () => close(acf([1, 2, 3, 4], 1), 0.25));
  it('lag ≥ n → 0', () => close(acf([1, 2, 3], 5), 0));
  it('banda = 1,96/√n', () => close(acfBand(100), 0.196));
});

describe('anova', () => {
  it('caso fechado à mão: F=21, eta²=0,875, df corretos', () => {
    // grupos [1,2,3],[2,3,4],[6,7,8]: ssb=42, ssw=6, k=3, N=9
    const r = anova([[1, 2, 3], [2, 3, 4], [6, 7, 8]]);
    close(r.F, 21);
    close(r.eta2, 0.875);
    assert.strictEqual(r.df1, 2);   // k−1
    assert.strictEqual(r.df2, 6);   // N−k
  });

  it('grupos vazios são filtrados antes de contar k', () => {
    // [[1,2],[3,4],[]] → k=2: ssb=4, ssw=1 → F=(4/1)/(1/2)=8, eta²=0,8
    const r = anova([[1, 2], [3, 4], []]);
    assert.strictEqual(r.df1, 1);
    assert.strictEqual(r.df2, 2);
    close(r.F, 8);
    close(r.eta2, 0.8);
  });

  it('N−k=0 (um ponto por grupo) → neutro com df informativos', () => {
    const r = anova([[1], [2]]);
    assert.deepStrictEqual(r, { F: 0, eta2: 0, df1: 1, df2: 0 });
  });
});

describe('gini / lorenz / hhi', () => {
  it('distribuição uniforme → gini 0', () => close(gini([3, 3, 3, 3]), 0));
  // um detentor de tudo em n=4: G=(n−1)/n = 0,75
  it('concentração máxima em n=4 → 0,75', () => close(gini([0, 0, 0, 1]), 0.75));
  it('[1,2,3,4] → 0,25 (fórmula fechada)', () => close(gini([1, 2, 3, 4]), 0.25));

  it('lorenz de [1,1,2]: pontos exatos', () => {
    const pts = lorenz([1, 1, 2]);
    assert.strictEqual(pts.length, 4);
    assert.deepStrictEqual(pts[0], [0, 0]);
    close(pts[1][0], 1 / 3); close(pts[1][1], 0.25);
    close(pts[2][0], 2 / 3); close(pts[2][1], 0.5);
    close(pts[3][0], 1);     close(pts[3][1], 1);
  });

  it('hhi soma dos quadrados das participações', () =>
    close(hhi([0.5, 0.3, 0.2]), 0.38));
  it('hhi monopólio → 1', () => close(hhi([1]), 1));
});

/* ==========================================================================
   Valores críticos (referência: tabelas publicadas, α=0,05)
   ========================================================================== */

describe('tCrit', () => {
  it('df=1 → 12,71', () => close(tCrit(1), 12.71));
  it('df=10 → 2,23', () => close(tCrit(10), 2.23));
  it('df=30 → 2,04 (borda da tabela)', () => close(tCrit(30), 2.04));
  it('df=31 → 1,96 (aproximação normal)', () => close(tCrit(31), 1.96));
  it('df=1000 → 1,96', () => close(tCrit(1000), 1.96));
  it('df≤0 → 0 (neutro)', () => assert.strictEqual(tCrit(0), 0));
});

describe('chiCrit', () => {
  it('df=1 → 3,84', () => close(chiCrit(1), 3.84));
  it('df=4 → 9,49', () => close(chiCrit(4), 9.49));
  it('df=20 → 31,41 (borda da tabela)', () => close(chiCrit(20), 31.41));
  it('df=21 → finito e maior que df=20 (aproximação normal)', () => {
    const v = chiCrit(21);
    assert.ok(Number.isFinite(v) && v > chiCrit(20), `veio ${v}`);
    // NOTA de rigor: a aproximação μ+1,645σ dá ≈31,66; o crítico exato de
    // qui-quadrado(21) a 95% é 32,67 — levemente anticonservador. Ver relatório.
  });
  it('df≤0 → Infinity (nada é significante)', () =>
    assert.strictEqual(chiCrit(0), Infinity));
});

describe('fCrit (tabela F 95% com interpolação em 1/df2)', () => {
  it('ponto exato fCrit(6,20)=2,60', () => close(fCrit(6, 20), 2.60));
  it('ponto exato fCrit(1,10)=4,96', () => close(fCrit(1, 10), 4.96));
  it('ponto exato fCrit(3,15)=3,29', () => close(fCrit(3, 15), 3.29));
  // Interpolado: entre (6,20)=2,60 e (6,30)=2,42 em 1/df2 → 2,492.
  // Valor exato da distribuição F(6,25) a 95%: 2,49.
  it('interpolado fCrit(6,25)≈2,49', () => close(fCrit(6, 25), 2.492, 0.005));
  // Interpolado entre (1,60)=4,00 e (1,∞)=3,84 → 3,936; exato: 3,936.
  it('interpolado fCrit(1,100)≈3,94', () => close(fCrit(1, 100), 3.936, 0.005));
  it('df2 muito grande → assíntota 3,84 para df1=1', () => close(fCrit(1, 500), 3.84));
  it('df1>6 é truncado em 6 (conservador para a ANOVA do app)', () =>
    close(fCrit(12, 20), fCrit(6, 20)));
  it('df inválido → Infinity', () => {
    assert.strictEqual(fCrit(0, 10), Infinity);
    assert.strictEqual(fCrit(3, 0), Infinity);
  });
});

/* ==========================================================================
   IC da média / sigma robusto / EWMA
   ========================================================================== */

describe('ciMean', () => {
  it('usa t de Student, não z: n=5 → t(4)=2,78', () => {
    // [1..5]: m=3, sd=√2,5, half = 2,78·√2,5/√5 = 2,78·√0,5
    const r = ciMean([1, 2, 3, 4, 5]);
    close(r.half, 2.78 * Math.sqrt(0.5));
    close(r.lo, 3 - 2.78 * Math.sqrt(0.5));
    close(r.hi, 3 + 2.78 * Math.sqrt(0.5));
  });
  it('n<2 → nulls (sem IC de um ponto)', () => {
    assert.deepStrictEqual(ciMean([7]), { lo: null, hi: null, half: null });
    assert.deepStrictEqual(ciMean([]), { lo: null, hi: null, half: null });
  });
});

describe('sigmaMR', () => {
  // MR-barra de [1,2,1,2] = 1; /1,128 (d2 de n=2)
  it('amplitude móvel média / 1,128', () => close(sigmaMR([1, 2, 1, 2]), 1 / 1.128));
  it('insensível a deriva linear: rampa tem MR constante', () =>
    // [0,1,2,3,4]: todas as diferenças = 1 → 1/1,128, mesmo com sd amostral ≈1,58
    close(sigmaMR([0, 1, 2, 3, 4]), 1 / 1.128));
  it('n<2 → 0', () => close(sigmaMR([5]), 0));
});

describe('ewmaChart', () => {
  it('recursão do z fechada à mão (λ=0,3, base=série)', () => {
    // y=[2,4,6]: base = série toda (nb mínimo 7 > n) → mu=4
    // z0 = 0,3·2+0,7·4 = 3,4; z1 = 3,58; z2 = 4,306
    const r = ewmaChart([2, 4, 6]);
    close(r.mu, 4);
    close(r.z[0], 3.4);
    close(r.z[1], 3.58);
    close(r.z[2], 4.306);
    assert.strictEqual(r.baselineN, 3);
    assert.deepStrictEqual(r.out, []);
  });

  it('baselineN padrão: 40% da série, mínimo 7, máximo 30', () => {
    assert.strictEqual(ewmaChart(Array(10).fill(5)).baselineN, 7);   // max(7, 4)
    assert.strictEqual(ewmaChart(Array(20).fill(5)).baselineN, 8);   // round(8)
    assert.strictEqual(ewmaChart(Array(100).fill(5)).baselineN, 30); // min(30, 40)
  });

  it('detecta subida de patamar: pontos out só após a base, aboveNow', () => {
    const y = [...Array(10).fill(10), ...Array(10).fill(20)];
    const r = ewmaChart(y, 0.3, 3, 10);
    assert.strictEqual(r.baselineN, 10);
    close(r.mu, 10);
    assert.ok(r.out.length > 0, 'a mudança de patamar deve sair dos limites');
    assert.ok(r.out.every(i => i >= r.baselineN), 'a base nunca gera pontos out');
    assert.strictEqual(r.out[0], 10, 'primeiro ponto fora é o primeiro pós-base');
    assert.strictEqual(r.aboveNow, true);
    assert.strictEqual(r.belowNow, false);
  });

  it('detecta queda de patamar: belowNow', () => {
    const y = [...Array(10).fill(10), ...Array(10).fill(0)];
    const r = ewmaChart(y, 0.3, 3, 10);
    assert.strictEqual(r.belowNow, true);
    assert.strictEqual(r.aboveNow, false);
  });

  it('base turbulenta não gera out mesmo com picos dentro dela', () => {
    const y = [0, 30, 0, 30, 0, 30, 0, 30, 0, 30, 15, 15, 15, 15, 15];
    const r = ewmaChart(y, 0.3, 3, 10);
    assert.ok(r.out.every(i => i >= 10));
  });

  it('formato do retorno e limites crescentes até o regime', () => {
    const r = ewmaChart([...Array(10).fill(5), 6, 7, 8], 0.3, 3, 10);
    assert.ok(Array.isArray(r.z) && r.z.length === 13);
    assert.strictEqual(typeof r.limit, 'function');
    assert.ok(r.limit(1) > r.limit(0), 'limite EWMA cresce com i');
    assert.ok(['mu', 'sd', 'out', 'baselineN', 'belowNow', 'aboveNow']
      .every(k => k in r));
  });
});

/* ==========================================================================
   Sobrevivência / risco / Markov / qui-quadrado
   ========================================================================== */

describe('survival (Kaplan-Meier sem censura)', () => {
  it('escada correta em caso fechado à mão', () => {
    // gaps=[10,30,50]: S(0)=1, S(20)=2/3, S(40)=1/3, S(60)=0
    const pts = survival([10, 30, 50], 60, 20);
    assert.strictEqual(pts.length, 4);
    assert.deepStrictEqual(pts[0], [0, 1]);
    close(pts[1][1], 2 / 3);
    close(pts[2][1], 1 / 3);
    close(pts[3][1], 0);
  });
  it('S(t)=P(T>t): evento exatamente em t não sobrevive a t', () => {
    const pts = survival([10], 10, 10);
    close(pts[1][1], 0);
  });
});

describe('hazard', () => {
  it('P(evento na faixa | em risco), caso fechado à mão', () => {
    // gaps=[10,30,50], faixas de 20: 1/3, 1/2, 1/1
    const h = hazard([10, 30, 50], 20, 3);
    assert.strictEqual(h.length, 3);
    close(h[0], 1 / 3);
    close(h[1], 1 / 2);
    close(h[2], 1);
  });
  it('faixa sem ninguém em risco → 0, não NaN', () => {
    const h = hazard([5], 20, 3);
    close(h[0], 1);
    close(h[1], 0);
    close(h[2], 0);
  });
});

describe('markov', () => {
  const seqs = [['a', 'b'], ['a', 'b'], ['a', 'c'], ['a', 'b'], ['b', 'a']];
  const states = ['a', 'b', 'c'];

  it('probabilidades condicionais por linha', () => {
    const r = markov(seqs, states);
    close(r.probs.a.b, 0.75);
    close(r.probs.a.c, 0.25);
    close(r.probs.b.a, 1);
    close(r.probs.c.a, 0);         // linha sem massa → 0, não NaN
    assert.strictEqual(r.totals.a, 4);
    assert.strictEqual(r.totals.b, 1);
    assert.strictEqual(r.totals.c, 0);
  });

  it('best exige massa mínima (totals≥4): b→a com p=1 não vence', () => {
    const r = markov(seqs, states);
    assert.deepStrictEqual(r.best, { from: 'a', to: 'b', p: 0.75, n: 3 });
  });

  it('estados fora da lista são ignorados nas transições', () => {
    const r = markov([['a', 'x', 'b']], ['a', 'b']);
    assert.strictEqual(r.totals.a, 0);
    assert.strictEqual(r.totals.b, 0);
  });
});

describe('chiSquare', () => {
  it('2×2 fechado à mão: chi=20/3, df=1, significativo', () => {
    // [[10,20],[20,10]]: E=15 em todas → chi = 4·(25/15) = 6,666...
    const r = chiSquare([[10, 20], [20, 10]]);
    close(r.chi, 20 / 3);
    assert.strictEqual(r.df, 1);
    close(r.crit, 3.84);
    assert.strictEqual(r.significant, true);
    close(r.resid[0][0], -5 / Math.sqrt(15));  // (O−E)/√E ≈ −1,291
    close(r.resid[0][1], 5 / Math.sqrt(15));
    assert.strictEqual(r.N, 60);
    assert.deepStrictEqual(r.rowT, [30, 30]);
    assert.deepStrictEqual(r.colT, [30, 30]);
  });

  it('tabela homogênea → chi=0, não significativo', () => {
    const r = chiSquare([[10, 10], [10, 10]]);
    close(r.chi, 0);
    assert.strictEqual(r.significant, false);
  });

  it('tabela toda zero → neutro, sem NaN', () => {
    const r = chiSquare([[0, 0], [0, 0]]);
    close(r.chi, 0);
    assert.strictEqual(r.significant, false);
    assert.ok(r.resid.flat().every(v => v === 0));
  });
});

/* ==========================================================================
   Agregações de domínio
   ========================================================================== */

describe('dayKey', () => {
  it('formato YYYY-MM-DD com zero à esquerda, data local', () => {
    assert.strictEqual(dayKey(new Date(2026, 0, 5, 14, 30)), '2026-01-05');
    assert.strictEqual(dayKey(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
  });
});

describe('dailySeries', () => {
  it('série contínua com zeros nos dias sem registro', () => {
    const recs = [
      rec(ts(2026, 1, 1, 9)), rec(ts(2026, 1, 1, 15)),   // dia 1: 2
      rec(ts(2026, 1, 3, 10))                            // dia 2: 0, dia 3: 1
    ];
    const { days, values } = dailySeries(recs);
    assert.strictEqual(days.length, 3);
    assert.deepStrictEqual(values, [2, 0, 1]);
    assert.strictEqual(dayKey(days[0]), '2026-01-01');
    assert.strictEqual(dayKey(days[1]), '2026-01-02');
    assert.strictEqual(dayKey(days[2]), '2026-01-03');
  });
  it('registros fora de ordem não mudam a série', () => {
    const { values } = dailySeries([rec(ts(2026, 1, 3, 10)), rec(ts(2026, 1, 1, 9))]);
    assert.deepStrictEqual(values, [1, 0, 1]);
  });
});

describe('intervals', () => {
  it('gaps em minutos, só dentro do mesmo dia', () => {
    const recs = [
      rec(ts(2026, 1, 1, 10, 0)), rec(ts(2026, 1, 1, 10, 30)),
      rec(ts(2026, 1, 2, 9, 0)), rec(ts(2026, 1, 2, 9, 15))
    ];
    assert.deepStrictEqual(intervals(recs).sort((a, b) => a - b), [15, 30]);
  });
  it('virada de meia-noite NÃO gera gap (viés declarado no motor)', () => {
    const recs = [rec(ts(2026, 1, 1, 23, 0)), rec(ts(2026, 1, 2, 1, 0))];
    assert.deepStrictEqual(intervals(recs), []);
  });
  it('ordena dentro do dia mesmo com entrada desordenada', () => {
    const recs = [rec(ts(2026, 1, 1, 11, 0)), rec(ts(2026, 1, 1, 10, 0))];
    assert.deepStrictEqual(intervals(recs), [60]);
  });
});

describe('hourHistogram', () => {
  it('24 posições, contagem por hora local', () => {
    const h = hourHistogram([
      rec(ts(2026, 1, 1, 9, 5)), rec(ts(2026, 1, 2, 9, 40)), rec(ts(2026, 1, 1, 14, 0))
    ]);
    assert.strictEqual(h.length, 24);
    assert.strictEqual(h[9], 2);
    assert.strictEqual(h[14], 1);
    assert.strictEqual(h.reduce((a, b) => a + b, 0), 3);
  });
});

describe('minutesSinceLast', () => {
  const now = new Date(2026, 0, 1, 12, 0);
  it('minutos desde o registro mais recente ≤ agora', () => {
    const recs = [rec(ts(2026, 1, 1, 10, 0)), rec(ts(2026, 1, 1, 11, 0))];
    close(minutesSinceLast(recs, now), 60);
  });
  it('registros no futuro são ignorados', () => {
    const recs = [rec(ts(2026, 1, 1, 11, 0)), rec(ts(2026, 1, 1, 13, 0))];
    close(minutesSinceLast(recs, now), 60);
  });
  it('só registros futuros → null', () =>
    assert.strictEqual(minutesSinceLast([rec(ts(2026, 1, 1, 13, 0))], now), null));
});

describe('weekdayPace', () => {
  it('média até o horário atual, contando dias observados com zero', () => {
    const now = new Date(2026, 0, 11, 12, 0);          // domingo
    assert.strictEqual(now.getDay(), 0, 'sanidade: 2026-01-11 é domingo');
    const recs = [
      // domingo anterior (04/01): 2 até meio-dia, 3 no dia todo
      rec(ts(2026, 1, 4, 9)), rec(ts(2026, 1, 4, 10)), rec(ts(2026, 1, 4, 15)),
      // domingo retrasado (28/12/2025): 1 no dia, 0 até meio-dia
      rec(ts(2025, 12, 28, 13)),
      // segunda-feira: outro dia da semana, ignorada
      rec(ts(2026, 1, 5, 9)),
      // hoje: excluído da referência histórica
      rec(ts(2026, 1, 11, 9))
    ];
    const r = weekdayPace(recs, now);
    assert.strictEqual(r.dow, 0);
    assert.strictEqual(r.nDays, 2);
    close(r.avgUpToNow, 1);    // (2+0)/2 — o domingo sem nada até 12h conta como 0
    close(r.avgFullDay, 2);    // (3+1)/2
  });
  it('sem histórico do dia da semana → nulls, não 0 fingido', () => {
    const r = weekdayPace([], new Date(2026, 0, 11, 12, 0));
    assert.strictEqual(r.nDays, 0);
    assert.strictEqual(r.avgUpToNow, null);
    assert.strictEqual(r.avgFullDay, null);
  });
});

describe('weekHourMatrix', () => {
  it('conta por bloco de 2h e normaliza pelo nº de dias observados', () => {
    assert.strictEqual(new Date(2026, 0, 5).getDay(), 1, 'sanidade: 05/01 é segunda');
    const recs = [
      rec(ts(2026, 1, 5, 9, 0)), rec(ts(2026, 1, 5, 9, 30)),   // seg, bloco 4
      rec(ts(2026, 1, 12, 9, 15))                              // outra seg, bloco 4
    ];
    const { counts, norm, dayCount } = weekHourMatrix(recs);
    assert.strictEqual(counts[1][4], 3);
    assert.strictEqual(dayCount[1], 2);
    close(norm[1][4], 1.5);
    assert.strictEqual(counts.length, 7);
    assert.strictEqual(counts[0].length, 12);
  });
});

describe('firstLast', () => {
  it('primeiro e último em horas decimais por dia', () => {
    const recs = [
      rec(ts(2026, 1, 1, 8, 30)), rec(ts(2026, 1, 1, 22, 15)), rec(ts(2026, 1, 1, 12, 0)),
      rec(ts(2026, 1, 2, 10, 45))
    ];
    const { firsts, lasts } = firstLast(recs);
    assert.strictEqual(firsts.length, 2);
    close(firsts[0], 8.5);
    close(lasts[0], 22.25);
    close(firsts[1], 10.75);
    close(lasts[1], 10.75);    // dia de um único cigarro: primeiro = último
  });
});

describe('causeSequences', () => {
  it('uma sequência por dia, ordenada no tempo', () => {
    const recs = [
      rec(ts(2026, 1, 1, 10, 0), 'stress'),
      rec(ts(2026, 1, 1, 9, 0), 'cafe'),     // fora de ordem de propósito
      rec(ts(2026, 1, 2, 8, 0), 'cafe')
    ];
    assert.deepStrictEqual(causeSequences(recs), [['cafe', 'stress'], ['cafe']]);
  });
});

describe('byCause', () => {
  it('N, participação, vontade média e IC por causa', () => {
    const recs = [
      rec(ts(2026, 1, 1, 9), 'stress', 3),
      rec(ts(2026, 1, 1, 10), 'stress', 4),
      rec(ts(2026, 1, 1, 11), 'stress', 5),
      rec(ts(2026, 1, 1, 12), 'cafe', 2),
      rec(ts(2026, 1, 1, 13), 'cafe'),          // sem craving
      rec(ts(2026, 1, 1, 14))                   // sem causa: fora do total
    ];
    const r = byCause(recs);
    assert.strictEqual(r.total, 5);
    close(r.coverage, 500 / 6);                 // 5 de 6 → 83,33%
    assert.strictEqual(r.rows[0].cause, 'stress');  // ordenado por n desc
    assert.strictEqual(r.rows[0].n, 3);
    close(r.rows[0].pct, 60);
    close(r.rows[0].craving, 4);                // média de [3,4,5]
    close(r.rows[0].ci, 4.30 / Math.sqrt(3));   // t(df=2)·sd(=1)/√3
    assert.strictEqual(r.rows[0].cn, 3);
    assert.strictEqual(r.rows[1].cause, 'cafe');
    assert.strictEqual(r.rows[1].n, 2);
    close(r.rows[1].craving, 2);                // só o craving informado
    assert.strictEqual(r.rows[1].ci, null);     // 1 craving não dá IC
    assert.strictEqual(r.rows[1].cn, 1);
  });
});

/* ==========================================================================
   Casos-limite obrigatórios: vazio, n=1, constante, tudo zero.
   Contrato: valor neutro (0/null/estrutura vazia), nunca NaN nem exceção.
   ========================================================================== */

describe('casos-limite: array vazio', () => {
  it('descritivas → 0', () => {
    for (const f of [mean, median, sd, variance, mode, skewness, kurtosis,
                     dispersionIndex, gini, hhi, sigmaMR]) {
      assert.strictEqual(f([]), 0, f.name);
    }
    assert.strictEqual(quantile([], 0.5), 0);
    assert.strictEqual(acf([], 1), 0);
    assert.strictEqual(acfBand(0), 0);
  });

  it('ols vazio → objeto neutro', () => {
    const r = ols([]);
    assert.deepStrictEqual(r, { a: 0, b: 0, r2: 0, se: 0, t: 0, n: 0, resid: 0 });
  });

  it('anova sem grupos → neutro', () =>
    assert.deepStrictEqual(anova([]), { F: 0, eta2: 0, df1: 0, df2: 0 }));

  it('ciMean vazio → nulls', () =>
    assert.deepStrictEqual(ciMean([]), { lo: null, hi: null, half: null }));

  it('ewmaChart vazio → estrutura neutra sem NaN', () => {
    const r = ewmaChart([]);
    assert.deepStrictEqual(r.z, []);
    assert.deepStrictEqual(r.out, []);
    assert.strictEqual(r.baselineN, 0);
    assert.ok(!Number.isNaN(r.mu) && !Number.isNaN(r.sd));
    assert.strictEqual(r.belowNow, false);
    assert.strictEqual(r.aboveNow, false);
  });

  it('survival/hazard vazios → curvas nulas sem NaN', () => {
    assert.ok(survival([], 40, 20).every(p => p[1] === 0));
    assert.ok(hazard([], 20, 5).every(v => v === 0));
  });

  it('lorenz vazio → só a origem', () =>
    assert.deepStrictEqual(lorenz([]), [[0, 0]]));

  it('markov vazio → probs 0 e best nulo', () => {
    const r = markov([], ['a', 'b']);
    assert.strictEqual(r.probs.a.b, 0);
    assert.deepStrictEqual(r.best, { from: null, to: null, p: 0, n: 0 });
  });

  it('chiSquare de tabela vazia → chi 0, não significativo, sem NaN', () => {
    const r = chiSquare([]);
    assert.strictEqual(r.chi, 0);
    assert.strictEqual(r.significant, false);
  });

  it('agregações de domínio vazias → estruturas vazias', () => {
    assert.deepStrictEqual(dailySeries([]), { days: [], values: [] });
    assert.deepStrictEqual(intervals([]), []);
    assert.ok(hourHistogram([]).every(v => v === 0));
    assert.strictEqual(minutesSinceLast([]), null);
    assert.deepStrictEqual(causeSequences([]), []);
    const bc = byCause([]);
    assert.deepStrictEqual(bc.rows, []);
    assert.strictEqual(bc.total, 0);
    assert.strictEqual(bc.coverage, 0);
    const { firsts, lasts } = firstLast([]);
    assert.deepStrictEqual(firsts, []);
    assert.deepStrictEqual(lasts, []);
    const m = weekHourMatrix([]);
    assert.ok(m.norm.flat().every(v => v === 0), 'norm sem NaN com 0 dias');
  });
});

describe('casos-limite: n=1', () => {
  it('descritivas degradam para o próprio ponto ou 0', () => {
    close(mean([5]), 5);
    close(median([5]), 5);
    close(quantile([5], 0.9), 5);
    assert.strictEqual(mode([5]), 5);
    assert.strictEqual(variance([5]), 0);
    assert.strictEqual(sd([5]), 0);
    assert.strictEqual(skewness([5]), 0);
    assert.strictEqual(kurtosis([5]), 0);
    assert.strictEqual(sigmaMR([5]), 0);
  });
  it('ols com n<3 → neutro', () => {
    const r = ols([5, 6]);
    assert.strictEqual(r.b, 0);
    assert.strictEqual(r.n, 2);
  });
  it('anova com um só grupo → neutro', () =>
    assert.deepStrictEqual(anova([[1, 2, 3]]), { F: 0, eta2: 0, df1: 0, df2: 0 }));
  it('ewmaChart com n<3 → passa-through sem julgar', () => {
    const r = ewmaChart([5, 6]);
    assert.deepStrictEqual(r.z, [5, 6]);
    assert.deepStrictEqual(r.out, []);
    assert.strictEqual(r.baselineN, 0);
  });
});

describe('casos-limite: série constante', () => {
  const c = [7, 7, 7, 7, 7];
  it('dispersões → 0, momentos → 0', () => {
    assert.strictEqual(variance(c), 0);
    assert.strictEqual(sd(c), 0);
    assert.strictEqual(skewness(c), 0);
    assert.strictEqual(kurtosis(c), 0);
    assert.strictEqual(dispersionIndex(c), 0);
    assert.strictEqual(gini(c), 0);
    assert.strictEqual(sigmaMR(c), 0);
  });
  it('acf sem variância → 0, não NaN', () => assert.strictEqual(acf(c, 1), 0));
  it('ols plano: b=0, r2=0, t=0', () => {
    const r = ols(c);
    close(r.b, 0);
    close(r.r2, 0);
    close(r.t, 0);
  });
  it('ciMean colapsa no ponto: half=0, lo=hi=7', () => {
    const r = ciMean(c);
    close(r.half, 0);
    close(r.lo, 7);
    close(r.hi, 7);
  });
  it('ewmaChart constante: piso de sigma evita limites degenerados, nada out', () => {
    const r = ewmaChart([7, 7, 7, 7, 7, 7, 7, 7, 7, 7]);
    close(r.sd, 0.35);          // piso documentado no motor
    assert.deepStrictEqual(r.out, []);
    assert.ok(r.z.every(v => v === 7));
  });
});

describe('casos-limite: tudo zero', () => {
  const z = [0, 0, 0, 0, 0];
  it('descritivas neutras, sem NaN', () => {
    assert.strictEqual(mean(z), 0);
    assert.strictEqual(sd(z), 0);
    assert.strictEqual(dispersionIndex(z), 0);   // média 0 não vira 0/0
    assert.strictEqual(gini(z), 0);              // total 0 não vira 0/0
    assert.strictEqual(skewness(z), 0);
  });
  it('ols de zeros → tudo 0', () => {
    const r = ols(z);
    assert.strictEqual(r.b, 0);
    assert.strictEqual(r.a, 0);
    assert.strictEqual(r.r2, 0);
  });
  it('lorenz de zeros → sem divisão por zero', () => {
    const pts = lorenz([0, 0, 0]);
    assert.ok(pts.every(p => !Number.isNaN(p[0]) && !Number.isNaN(p[1])));
    close(pts[pts.length - 1][1], 0);
  });
  it('ewmaChart de zeros → z tudo 0, nada out, sem NaN', () => {
    const r = ewmaChart(new Array(12).fill(0));
    assert.ok(r.z.every(v => v === 0));
    assert.deepStrictEqual(r.out, []);
    assert.ok(!Number.isNaN(r.limit(11)));
  });
});
