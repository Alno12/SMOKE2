/* ==========================================================================
   SmokeCount — aplicação
   ========================================================================== */
import { store } from './storage.js';
import * as St from './stats.js';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

const CAUSES = ['Ao acordar','Café','Após comer','Pausa','Estresse','Tédio',
                'Álcool','Social','Dirigindo','Ansiedade','Insônia'];
const MOODS  = ['Neutro','Estressado','Ansioso','Entediado','Feliz','Irritado','Triste'];
const DN = ['dom','seg','ter','qua','qui','sex','sáb'];
const DL = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];
const HEAT = ['#F1EFEA','#F4E3C8','#EDC796','#DE9A63','#C9663E','#A83C22'];

/* ---------- estado ---------- */
let records = [];
let config  = { goal: 10, price: 11.5, perPack: 20, lastExport: null };

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const nf  = (v, d = 1) => v.toFixed(d).replace('.', ',');
const pad = n => String(n).padStart(2, '0');
const hm  = h => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;
const dateKey = d => St.dayKey(d);

/* ==========================================================================
   Persistência
   ========================================================================== */

async function persist(reason) {
  store.scheduleSave(records);
  await store.appendJournal({ op: reason, n: records.length });
}

function setDot(state, title) {
  ['dot', 'dot2'].forEach(id => {
    const e = $(id);
    if (!e) return;
    e.className = 'dot' + (state === 'ok' ? '' : state === 'warn' ? ' warn' : ' err');
    e.title = title;
  });
}

function banner(msg, actionLabel, fn) {
  const b = $('banner');
  $('bannerMsg').textContent = msg;
  const btn = $('bannerAct');
  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.hidden = false;
    btn.onclick = fn;
  } else {
    btn.hidden = true;
  }
  b.classList.add('on');
}

store.onStatus((status, detail) => {
  if (status === 'saved') {
    setDot('ok', `Salvo em ${detail.layers} camada(s) · ${detail.n} registros`);
  }
  if (status === 'error') {
    setDot('err', 'Falha ao gravar');
    banner('Não foi possível salvar. Exporte um backup agora.', 'Dados',
      () => goTab('v5'));
  }
  if (status === 'recovered') {
    toast(`Dados recuperados de backup (${detail.n} registros)`);
  }
  if (status === 'repaired') {
    console.info(`[storage] camada ${detail.layer} ressincronizada`);
  }
});

/* ==========================================================================
   Boot
   ========================================================================== */

async function boot() {
  const health = await store.init();

  if (!health.durable) {
    setDot('err', 'Armazenamento indisponível');
    banner('Armazenamento do navegador bloqueado. Os dados somem ao fechar.',
      'Entender', () => goTab('v5'));
  } else {
    setDot('ok', `Primária: ${health.primary}`);
  }

  const loaded = await store.loadRecords();
  const meta = await store.getMeta();
  if (meta) config = { ...config, ...meta };

  if (loaded && loaded.length) {
    records = loaded.map(r => ({ ...r, ts: new Date(r.ts) }));
  } else {
    records = [];
  }
  records.sort((a, b) => b.ts - a.ts);

  // Em navegadores que descartam dados sob pressão (Safari apaga o IndexedDB
  // após ~7 dias sem uso), pedimos persistência já no primeiro uso.
  if (health.durable) {
    const already = await navigator.storage?.persisted?.().catch(() => false);
    if (!already) await store.requestPersistence();
  }

  bindUI();
  refresh();
}

/* ==========================================================================
   Renderização — SÉRIE
   ========================================================================== */

const el = (t, at) => {
  const e = document.createElementNS(NS, t);
  for (const k in at) e.setAttribute(k, at[k]);
  return e;
};
const clear = s => { while (s.firstChild) s.removeChild(s.firstChild); };
const path = (d, stroke, w, extra) =>
  el('path', Object.assign({ d, fill: 'none', stroke, 'stroke-width': w,
    'vector-effect': 'non-scaling-stroke' }, extra || {}));

function renderSerie() {
  const { days, values } = St.dailySeries(records);
  const n = values.length;
  const enough = n >= 4;
  $('v1Empty').hidden = enough;
  $('v1Content').hidden = !enough;
  if (!enough) return;

  const GOAL = config.goal;
  const m = St.mean(values), s = St.sd(values), med = St.median(values);
  const cv = m ? s / m * 100 : 0;
  const q1 = St.quantile(values, .25), q3 = St.quantile(values, .75);
  const disp = St.dispersionIndex(values);
  const o = St.ols(values);
  const sigTrend = Math.abs(o.t) > St.tCrit(n - 2);
  const se = s / Math.sqrt(n);

  $('hMean').textContent = nf(m);
  $('hN').textContent = n;
  $('hCI').textContent = `IC95% [${nf(m - 1.96 * se)} – ${nf(m + 1.96 * se)}]`;
  const perWeek = o.b * 7;
  $('hSlope').textContent = (o.b >= 0 ? '+' : '−') + nf(Math.abs(perWeek), 2) + '/sem';
  $('hSlope').className = 'dl ' + (o.b < 0 ? 'dn' : 'up');
  $('hSig').textContent = sigTrend ? `significativa · t=${nf(o.t)}` : 'não significativa';
  $('hSig').className = 'sig ' + (sigTrend && o.b < 0 ? 'y' : 'n');

  // sparkline
  const sp = $('spark'); clear(sp);
  const mn = Math.min(...values), mx = Math.max(...values);
  const X = i => i / (n - 1) * 320;
  const Y = v => 3 + (1 - (v - mn) / ((mx - mn) || 1)) * 30;
  const d = values.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  sp.appendChild(el('path', { d: d + ' L320 36 L0 36 Z', fill: '#A83C22', 'fill-opacity': .07 }));
  sp.appendChild(path(d, '#A83C22', 1.4));
  sp.appendChild(path(`M0 ${Y(o.a).toFixed(1)} L320 ${Y(o.a + o.b * (n - 1)).toFixed(1)}`,
    '#2F6252', 1.2, { 'stroke-dasharray': '3 2' }));

  // descritivas
  const cards = [
    ['Mediana', med.toFixed(0), 'moda ' + St.mode(values)],
    ['Desvio padrão', nf(s), 'σ'],
    ['Coef. variação', cv.toFixed(0) + '<i>%</i>', cv < 25 ? 'estável' : 'irregular'],
    ['IQR', (q3 - q1).toFixed(0), `Q1 ${q1.toFixed(0)} · Q3 ${q3.toFixed(0)}`],
    ['Assimetria', nf(St.skewness(values), 2), St.skewness(values) > .3 ? 'cauda alta' : 'simétrica'],
    ['Curtose', nf(St.kurtosis(values), 2), 'excesso'],
    ['Índice disp.', nf(disp, 2), disp > 1.3 ? 'superdisperso' : '~Poisson'],
    ['R² tendência', nf(o.r2, 2), (o.r2 * 100).toFixed(0) + '% explicado'],
    ['Total', records.length, 'registros']
  ];
  $('sgDesc').innerHTML = cards.map(c =>
    `<div class="sc"><div class="k">${c[0]}</div><div class="v">${c[1]}</div><div class="d">${c[2]}</div></div>`
  ).join('');

  // série diária
  const dd = $('dd');
  dd.querySelectorAll('.db').forEach(x => x.remove());
  values.forEach((v, i) => {
    const b = document.createElement('div');
    b.className = 'db ' + (v > GOAL ? 'ov' : v < GOAL ? 'un' : '');
    b.style.height = Math.max(v / mx * 100, 2) + '%';
    b.title = `${DN[days[i].getDay()]} ${days[i].getDate()}/${days[i].getMonth() + 1} — ${v} cig`;
    dd.appendChild(b);
  });
  $('gl').style.bottom = (GOAL / mx * 74) + 'px';
  $('gl').dataset.l = 'meta ' + GOAL;
  $('glLab').textContent = `n = ${n} dias`;
  $('ddA').textContent = `há ${n}d`;

  const over = values.filter(v => v > GOAL).length;
  $('insDisp').className = 'ins ' + (disp > 1.3 ? '' : 'ok');
  $('insDisp').innerHTML = `<div class="t">Dispersão</div><div class="x">
    Índice de dispersão <b>${nf(disp, 2)}</b> ${disp > 1.3
      ? '— acima de 1, o consumo é <b>superdisperso</b>: existem dias de gatilho, não só ruído aleatório. Vale caçar o que dispara esses dias.'
      : '— próximo de 1, seu consumo se comporta como processo aleatório estável, sem dias de gatilho marcantes.'}
    </div><div class="m">${over}/${n} dias acima da meta (${(over / n * 100).toFixed(0)}%) · CV ${cv.toFixed(0)}%</div>`;

  renderEwma(values, m, s, n);
  renderAcf(values, n);
  renderWeekday(days, values, m);
  renderForecast(values, n, o, perWeek);
}

function renderEwma(values, m, s, n) {
  const { z, mu, sd: sBase, limit, out, belowNow, aboveNow, baselineN } = St.ewmaChart(values);
  const svg = $('ewma'); clear(svg);
  const all = [...z, ...values.map((_, i) => mu + limit(i)), ...values.map((_, i) => mu - limit(i))];
  const lo = Math.min(...all), hi = Math.max(...all);
  const Y = v => 6 + (1 - (v - lo) / ((hi - lo) || 1)) * 84;
  const X = i => i / (n - 1) * 320;

  // Sombreia o período-base: é o trecho que define "o seu normal".
  if (baselineN > 0 && baselineN < n) {
    svg.appendChild(el('rect', { x: 0, y: 0, width: X(baselineN - 1), height: 96,
      fill: '#131210', 'fill-opacity': .035 }));
    const tb = el('text', { x: 4, y: 10, 'font-family': 'JetBrains Mono',
      'font-size': 7, fill: '#9B968A' });
    tb.textContent = 'base';
    svg.appendChild(tb);
  }

  const ub = values.map((_, i) => [X(i), Y(mu + limit(i))]);
  const lb = values.map((_, i) => [X(i), Y(mu - limit(i))]).reverse();
  svg.appendChild(el('path', {
    d: ub.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' ' +
       lb.map(p => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' Z',
    fill: '#2F6252', 'fill-opacity': .07
  }));
  svg.appendChild(path(`M0 ${Y(mu).toFixed(1)} L320 ${Y(mu).toFixed(1)}`, '#C4C0B6', 1,
    { 'stroke-dasharray': '2 3' }));
  svg.appendChild(path(z.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' '),
    '#A83C22', 1.6));
  out.forEach(i => svg.appendChild(el('circle', {
    cx: X(i), cy: Y(z[i]), r: 2.6,
    fill: z[i] < mu ? '#2F6252' : '#A83C22'
  })));

  $('insEwma').className = 'ins ' + (belowNow ? 'ok' : (aboveNow || out.length) ? '' : 'nu');
  $('insEwma').innerHTML = `<div class="t">Controle de processo</div><div class="x">
    ${belowNow
      ? `Sua média móvel está <b>abaixo do limite inferior</b> de controle. Comparado ao seu padrão dos primeiros ${baselineN} dias, a queda recente <b>não é ruído</b> — é mudança real de patamar.`
      : aboveNow
        ? `Sua média móvel <b>ultrapassou o limite superior</b>. O consumo subiu de forma estatisticamente real em relação ao seu padrão anterior, não é só um dia ruim.`
        : out.length
          ? `<b>${out.length}</b> ponto(s) saíram dos limites em algum momento, mas hoje o processo está de volta ao normal.`
          : `Processo <b>sob controle</b>: as variações do dia a dia estão todas dentro do ruído esperado. Nenhuma mudança real de patamar em relação à sua base.`}
    </div><div class="m">EWMA ${nf(z[n - 1], 2)} · centro ${nf(mu, 2)} (base: ${baselineN}d) · σ ${nf(sBase, 2)}</div>`;
}

function renderAcf(values, n) {
  const svg = $('acf'); clear(svg);
  const L = 14, band = St.acfBand(n);
  const X = i => 10 + (i - 1) / (L - 1) * 300;
  const Y = v => 42 - v * 36;
  svg.appendChild(el('rect', { x: 0, y: 42 - band * 36, width: 320, height: band * 72,
    fill: '#3C5A7A', 'fill-opacity': .07 }));
  svg.appendChild(path('M0 42 L320 42', '#C4C0B6', 1));
  let a7 = 0, best = 0, bestLag = 0;
  for (let l = 1; l <= L; l++) {
    const r = St.acf(values, l);
    if (l === 7) a7 = r;
    if (Math.abs(r) > Math.abs(best)) { best = r; bestLag = l; }
    svg.appendChild(el('line', { x1: X(l), y1: 42, x2: X(l), y2: Y(r),
      stroke: Math.abs(r) > band ? '#A83C22' : '#C4C0B6',
      'stroke-width': 3.4, 'stroke-linecap': 'round' }));
  }
  const sig = Math.abs(a7) > band;
  $('insAcf').className = 'ins ' + (sig ? '' : 'nu');
  $('insAcf').innerHTML = `<div class="t">Periodicidade</div><div class="x">
    ${sig
      ? `O lag 7 é <b>significativo (r=${nf(a7, 2)})</b>: seu consumo tem <b>ciclo semanal</b>. O dia da semana prevê melhor o consumo do que o dia anterior.`
      : `Nenhum ciclo semanal forte (lag 7 r=${nf(a7, 2)}). Seu consumo depende mais do contexto imediato do que do calendário.`}
    </div><div class="m">Maior autocorrelação: lag ${bestLag} (r=${nf(best, 2)}) · banda ±${nf(band, 2)}</div>`;
}

function renderWeekday(days, values, gmean) {
  const G = Array.from({ length: 7 }, () => []);
  days.forEach((d, i) => G[d.getDay()].push(values[i]));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const { F, eta2 } = St.anova(order.map(i => G[i]));
  const means = order.map(i => G[i].length ? St.mean(G[i]) : 0);
  const mx = Math.max(...means), mn = Math.min(...means.filter(v => v > 0));

  const svg = $('wk'); clear(svg);
  const BW = 320 / 7;
  means.forEach((m, i) => {
    const h = mx ? (m / mx) * 58 : 0;
    svg.appendChild(el('rect', { x: i * BW + 6, y: 66 - h, width: BW - 12, height: h, rx: 2,
      fill: m === mx ? '#A83C22' : m === mn ? '#2F6252' : '#DE9A63' }));
    const t1 = el('text', { x: i * BW + BW / 2, y: 78, 'text-anchor': 'middle',
      'font-family': 'JetBrains Mono', 'font-size': 8, fill: '#9B968A' });
    t1.textContent = DL[order[i]]; svg.appendChild(t1);
    const t2 = el('text', { x: i * BW + BW / 2, y: 63 - h, 'text-anchor': 'middle',
      'font-family': 'JetBrains Mono', 'font-size': 8, fill: '#5E5A50' });
    t2.textContent = nf(m); svg.appendChild(t2);
  });

  const maxD = DL[order[means.indexOf(mx)]], minD = DL[order[means.indexOf(mn)]];
  const delta = gmean ? (mx / gmean - 1) * 100 : 0;
  const sig = F > 2.2;
  $('insWk').className = 'ins ' + (sig ? '' : 'nu');
  $('insWk').innerHTML = `<div class="t">ANOVA de uma via</div><div class="x">
    ${sig
      ? `O dia da semana <b>importa</b> (F=${nf(F, 2)}, η²=${(eta2 * 100).toFixed(0)}%). <b>${maxD}</b> está <b>+${delta.toFixed(0)}%</b> acima da sua média; ${minD} é o menor.`
      : `O dia da semana <b>não explica</b> variação relevante (F=${nf(F, 2)}). Seu consumo é indiferente ao calendário.`}
    </div><div class="m">η² = ${nf(eta2 * 100)}% da variância explicada pelo dia da semana</div>`;
}

function renderForecast(values, n, o, perWeek) {
  const svg = $('fc'); clear(svg);
  const HW = 200, FW = 120, HN = Math.min(n, 45);
  const hv = values.slice(-HN);
  const fut = [];
  for (let k = 1; k <= 30; k++) fut.push(Math.max(0, o.a + o.b * (n - 1 + k)));
  const fmin = Math.min(...hv, ...fut, 0), fmax = Math.max(...hv, ...fut);
  const Y = v => 6 + (1 - (v - fmin) / ((fmax - fmin) || 1)) * 84;
  const HX = i => (HN > 1 ? i / (HN - 1) * HW : 0);
  const FX = k => HW + k / 30 * FW;

  const hi = [], lo = [];
  fut.forEach((v, k) => {
    const w = 1.282 * o.resid * Math.sqrt(1 + (k + 1) / n);
    hi.push([FX(k + 1), Y(v + w)]);
    lo.push([FX(k + 1), Y(Math.max(0, v - w))]);
  });
  svg.appendChild(el('path', {
    d: `M${HW} ${Y(values[n - 1])} ` +
       hi.map(p => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' ' +
       lo.reverse().map(p => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' Z',
    fill: '#2F6252', 'fill-opacity': .13
  }));
  svg.appendChild(path(hv.map((v, i) => (i ? 'L' : 'M') + HX(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' '),
    '#A83C22', 1.5));
  svg.appendChild(path(`M${HW} ${Y(values[n - 1]).toFixed(1)} ` +
    fut.map((v, k) => 'L' + FX(k + 1).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' '),
    '#2F6252', 1.5, { 'stroke-dasharray': '4 3' }));
  svg.appendChild(path(`M${HW} 0 L${HW} 96`, '#E4E2DC', 1));

  const cur = o.a + o.b * (n - 1);
  const toTarget = t => (o.b < 0 ? Math.ceil((t - cur) / o.b) : null);
  const d5 = toTarget(5), d0 = toTarget(0);
  const fmt = k => {
    const d = new Date(); d.setDate(d.getDate() + k);
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  $('insFc').className = 'ins ' + (o.b < 0 ? 'ok' : '');
  $('insFc').innerHTML = `<div class="t">Extrapolação</div><div class="x">
    ${o.b < 0
      ? `No ritmo atual (<b>${nf(Math.abs(perWeek), 2)} cig/semana</b> a menos), você atinge <b>5 cig/dia</b> em ${d5 && d5 < 3650 ? `<b>${fmt(d5)}</b>` : 'um prazo muito longo'} e <b>zero</b> em ${d0 && d0 < 3650 ? `<b>${fmt(d0)}</b>` : 'um prazo muito longo'}.`
      : `A tendência atual é de <b>alta</b> (+${nf(perWeek, 2)} cig/semana). Sem mudança, o consumo continua subindo.`}
    </div><div class="m">R²=${nf(o.r2, 2)} · erro padrão ${nf(o.resid, 2)} · IC 80% sombreado</div>`;
}

/* ==========================================================================
   Renderização — RITMO
   ========================================================================== */

function renderRitmo() {
  const gaps = St.intervals(records);
  const enough = gaps.length >= 3 && records.length >= 6;
  $('v2Empty').hidden = enough;
  $('v2Content').hidden = !enough;
  if (!enough) return;

  const gm = St.mean(gaps), gmd = St.median(gaps);
  const chainP = gaps.filter(g => g < 20).length / gaps.length * 100;
  const { firsts, lasts } = St.firstLast(records);
  const fMed = St.median(firsts), lMed = St.median(lasts);

  const hrs = St.hourHistogram(records);
  const tot = records.length;
  const hmax = Math.max(...hrs);
  const top3 = hrs.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const top3p = top3.reduce((s, x) => s + x[1], 0) / tot * 100;
  const g = St.gini(hrs);

  const cards = [
    ['Intervalo médio', gm.toFixed(0) + '<i>min</i>', 'entre cigarros'],
    ['Mediana', gmd.toFixed(0) + '<i>min</i>', gmd < gm ? 'cauda longa' : 'simétrico'],
    ['Em cadeia', chainP.toFixed(0) + '<i>%</i>', '&lt; 20 min'],
    ['1º do dia', hm(fMed), fMed < 8 ? 'cedo' : 'tardio'],
    ['Último', hm(lMed), 'mediana'],
    ['Janela ativa', nf(lMed - fMed) + '<i>h</i>', 'fumando'],
    ['Pico', top3[0][0] + 'h', 'maior hora'],
    ['Top 3 horas', top3p.toFixed(0) + '<i>%</i>', 'do consumo'],
    ['Gini horário', nf(g, 2), g > .5 ? 'ritualizado' : 'difuso']
  ];
  $('sgRit').innerHTML = cards.map(c =>
    `<div class="sc"><div class="k">${c[0]}</div><div class="v">${c[1]}</div><div class="d">${c[2]}</div></div>`
  ).join('');

  // histograma horário
  const hh = $('hh'); hh.innerHTML = '';
  hrs.forEach((v, i) => {
    const b = document.createElement('div');
    b.className = 'hb';
    const r = hmax ? v / hmax : 0;
    b.style.height = Math.max(r * 100, 2) + '%';
    b.style.background = HEAT[Math.min(5, Math.floor(r * 5.99))];
    b.title = `${i}h — ${v} cig (${nf(v / tot * 100)}%)`;
    hh.appendChild(b);
  });
  $('hhLab').textContent = 'pico ' + top3[0][0] + 'h';
  $('insHH').className = 'ins';
  $('insHH').innerHTML = `<div class="t">Concentração horária</div><div class="x">
    As <b>3 horas de pico</b> (${top3.map(x => x[0] + 'h').join(', ')}) concentram <b>${top3p.toFixed(0)}%</b>
    de todo o seu consumo. Atacar só essas três janelas vale mais que cortar o resto do dia inteiro.</div>`;

  // Kaplan-Meier
  const svg = $('km'); clear(svg);
  const pts = St.survival(gaps, 200, 4);
  const X = t => t / 200 * 320, Y = s => 6 + (1 - s) * 84;
  const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
  svg.appendChild(el('path', { d: d + ' L320 90 L0 90 Z', fill: '#A83C22', 'fill-opacity': .07 }));
  svg.appendChild(path(d, '#A83C22', 1.6));
  svg.appendChild(path(`M0 ${Y(.5)} L320 ${Y(.5)}`, '#C4C0B6', 1, { 'stroke-dasharray': '2 3' }));
  svg.appendChild(path(`M${X(gmd)} 0 L${X(gmd)} 96`, '#2F6252', 1, { 'stroke-dasharray': '2 3' }));
  const p30 = gaps.filter(g2 => g2 <= 30).length / gaps.length * 100;
  const p60 = gaps.filter(g2 => g2 <= 60).length / gaps.length * 100;
  $('insKM').className = 'ins';
  $('insKM').innerHTML = `<div class="t">Curva de sobrevivência</div><div class="x">
    Meia hora depois de apagar um cigarro, você já acendeu outro em <b>${p30.toFixed(0)}%</b> das vezes.
    Em uma hora, <b>${p60.toFixed(0)}%</b>. A mediana de resistência é de <b>${gmd.toFixed(0)} min</b>.
    </div><div class="m">n = ${gaps.length} intervalos · linha verde = mediana</div>`;

  // hazard
  const svg2 = $('hz'); clear(svg2);
  const hz = St.hazard(gaps, 20, 10);
  const hzmx = Math.max(...hz) || 1;
  hz.forEach((v, i) => {
    const h = (v / hzmx) * 60, w = 320 / 10;
    svg2.appendChild(el('rect', { x: i * w + 2, y: 66 - h, width: w - 4, height: h, rx: 2,
      fill: v === hzmx ? '#A83C22' : '#DE9A63' }));
  });
  svg2.appendChild(path('M0 66 L320 66', '#E4E2DC', 1));
  const peak = hz.indexOf(hzmx);
  $('insHz').className = 'ins ' + (peak === 0 ? '' : 'nu');
  $('insHz').innerHTML = `<div class="t">Risco condicional</div><div class="x">
    ${peak === 0
      ? `O risco é <b>máximo nos primeiros 20 min</b> (${(hzmx * 100).toFixed(0)}%): você fuma <b>em cadeia</b>. Passando dos 20 minutos, a chance de acender cai muito — a barreira crítica é o primeiro cigarro depois do último.`
      : `O risco é máximo na faixa <b>${peak * 20}–${(peak + 1) * 20} min</b> (${(hzmx * 100).toFixed(0)}%). É ali que a vontade cobra.`}
    </div><div class="m">${chainP.toFixed(0)}% dos intervalos são menores que 20 min</div>`;

  // heatmap
  const { counts, norm } = St.weekHourMatrix(records);
  const nmx = Math.max(...norm.flat()) || 1;
  const hmEl = $('hm');
  hmEl.innerHTML = '<div></div>' +
    Array.from({ length: 12 }, (_, i) => `<div class="ch">${i * 2}</div>`).join('');
  const order = [1, 2, 3, 4, 5, 6, 0];
  let hotV = 0, hotD = 0, hotH = 0;
  order.forEach(dw => {
    const l = document.createElement('div');
    l.className = 'rl'; l.textContent = DL[dw];
    hmEl.appendChild(l);
    for (let h = 0; h < 12; h++) {
      const c = document.createElement('div');
      c.className = 'c';
      const v = norm[dw][h];
      if (v > hotV) { hotV = v; hotD = dw; hotH = h; }
      c.style.background = HEAT[Math.min(5, Math.floor(v / nmx * 5.99))];
      c.title = `${DL[dw]} ${h * 2}h–${h * 2 + 2}h — ${counts[dw][h]} cig`;
      hmEl.appendChild(c);
    }
  });
  $('insHM').className = 'ins';
  $('insHM').innerHTML = `<div class="t">Bloco mais denso</div><div class="x">
    <b>${DL[hotD]}, ${hotH * 2}h–${hotH * 2 + 2}h</b> é o bloco mais carregado da sua semana
    (${nf(hotV)} cigarros por ocorrência). É aí que o hábito é mais rígido — e onde uma intervenção rende mais.</div>`;

  // Lorenz
  const svg3 = $('lz'); clear(svg3);
  const L = St.lorenz(hrs);
  const LX = x => 10 + x * 300, LY = y => 92 - y * 84;
  svg3.appendChild(path(`M${LX(0)} ${LY(0)} L${LX(1)} ${LY(1)}`, '#C4C0B6', 1,
    { 'stroke-dasharray': '3 3' }));
  const dL = L.map((p, i) => (i ? 'L' : 'M') + LX(p[0]).toFixed(1) + ' ' + LY(p[1]).toFixed(1)).join(' ');
  svg3.appendChild(el('path', { d: dL + ` L${LX(1)} ${LY(0)} Z`, fill: '#A83C22', 'fill-opacity': .08 }));
  svg3.appendChild(path(dL, '#A83C22', 1.7));
  const txt = el('text', { x: LX(.06), y: LY(.86), 'font-family': 'JetBrains Mono',
    'font-size': 8, fill: '#9B968A' });
  txt.textContent = 'igualdade perfeita';
  svg3.appendChild(txt);

  const sortedH = [...hrs].sort((a, b) => b - a);
  const half = hrs.reduce((a, b) => a + b, 0) / 2;
  let acc = 0, hcount = 0;
  for (const v of sortedH) { if (acc >= half) break; acc += v; hcount++; }
  $('insLz').className = 'ins';
  $('insLz').innerHTML = `<div class="t">Índice de Gini = ${nf(g, 2)}</div><div class="x">
    ${g > .5
      ? 'Consumo <b>fortemente concentrado</b> em poucas horas. É boa notícia: hábito ritualizado tem alvo claro — mudar duas ou três rotinas fixas derruba o total.'
      : 'Consumo <b>espalhado</b> pelo dia. Hábito difuso é mais difícil de atacar por horário; a intervenção precisa ser por gatilho, não por relógio.'}
    </div><div class="m">Metade do seu consumo cabe em ${hcount} hora(s) do dia</div>`;
}

/* ==========================================================================
   Renderização — CAUSAS
   ========================================================================== */

function renderCausas() {
  const { rows, total, coverage } = St.byCause(records);
  const tb = $('czTb').querySelector('tbody');
  tb.innerHTML = '';
  $('czN').textContent = 'n = ' + total;

  const CC = i => ['#A83C22','#BC5030','#C9663E','#D68050','#DE9A63','#E6B27C',
                   '#EDC796','#F0D4AC','#F4E3C8','#EFEADF','#E9E6DC'][i % 11];

  if (total < 5) {
    tb.innerHTML = '<tr><td colspan="5" class="em">Marque a causa em pelo menos 5 registros<br>para liberar a análise.</td></tr>';
    $('sgCz').innerHTML = '';
    $('czCrav').innerHTML = '';
    $('mk').innerHTML = '';
    $('chiTb').querySelector('tbody').innerHTML = '';
    ['insCz','insCrav','insMk','insChi'].forEach(i => $(i).innerHTML = '');
  } else {
    const mx = rows[0].n;
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      const col = r.craving === null ? 'var(--soft)'
        : r.craving >= 4 ? 'var(--r1)' : r.craving <= 2.2 ? 'var(--g1)' : 'var(--mid)';
      tr.innerHTML =
        `<td><span class="bar" style="width:${r.n / mx * 34}px;background:${CC(i)}"></span>${r.cause}</td>
         <td>${r.n}</td><td>${r.pct.toFixed(0)}%</td>
         <td style="color:${col}">${r.craving === null ? '—' : nf(r.craving)}</td>
         <td style="color:var(--soft);font-size:9px">${r.ci === null ? '—' : '±' + nf(r.ci)}</td>`;
      tb.appendChild(tr);
    });
    const allCr = records.filter(r => r.cause && r.craving).map(r => r.craving);
    const tot = document.createElement('tr');
    tot.className = 'tot';
    tot.innerHTML = `<td>Total</td><td>${total}</td><td>100%</td>
      <td>${allCr.length ? nf(St.mean(allCr)) : '—'}</td><td>—</td>`;
    tb.appendChild(tot);

    const h = St.hhi(rows.map(r => r.pct / 100));
    const top2 = rows.slice(0, 2);
    const top2p = top2.reduce((s, r) => s + r.pct, 0);
    const auto = rows.filter(r => r.craving !== null && r.craving <= 2.2);
    const autoP = auto.reduce((s, r) => s + r.pct, 0);
    const dep = rows.filter(r => r.craving !== null && r.craving >= 4);
    const depP = dep.reduce((s, r) => s + r.pct, 0);

    $('sgCz').innerHTML = [
      ['Causas distintas', rows.length, 'registradas'],
      ['HHI', nf(h, 2), h > .2 ? 'concentrado' : 'difuso'],
      ['Top 2', top2p.toFixed(0) + '<i>%</i>', 'do total'],
      ['Automáticos', autoP.toFixed(0) + '<i>%</i>', 'vontade ≤2,2'],
      ['Dependência', depP.toFixed(0) + '<i>%</i>', 'vontade ≥4'],
      ['Cobertura', coverage.toFixed(0) + '<i>%</i>', coverage >= 70 ? 'confiável' : 'baixa']
    ].map(c => `<div class="sc"><div class="k">${c[0]}</div><div class="v">${c[1]}</div><div class="d">${c[2]}</div></div>`).join('');

    $('insCz').className = 'ins';
    $('insCz').innerHTML = `<div class="t">Concentração (HHI ${nf(h, 2)})</div><div class="x">
      <b>${top2.map(r => r.cause).join(' + ')}</b> respondem por <b>${top2p.toFixed(0)}%</b> do consumo com causa marcada.
      ${h > .2 ? 'O hábito é concentrado — poucos gatilhos carregam quase tudo.'
               : 'O hábito é difuso — muitos gatilhos pequenos, sem um dominante.'}
      </div><div class="m">O IC 95% à direita indica quão confiável é cada média de vontade</div>`;

    // vontade por causa
    const cw = $('czCrav'); cw.innerHTML = '';
    rows.filter(r => r.craving !== null).sort((a, b) => b.craving - a.craving).forEach(r => {
      const col = r.craving >= 4 ? 'var(--r1)' : r.craving <= 2.2 ? 'var(--g1)' : 'var(--r3)';
      const d = document.createElement('div');
      d.style.cssText = 'display:grid;grid-template-columns:88px 1fr 44px;align-items:center;gap:7px;padding:6px 0';
      d.innerHTML = `<span style="font-size:11.5px">${r.cause}</span>
        <span style="height:7px;background:var(--line2);border-radius:99px;display:block;position:relative">
          <span style="display:block;height:100%;width:${r.craving / 5 * 100}%;background:${col};border-radius:99px"></span>
          ${r.ci ? `<span style="position:absolute;top:-2px;left:${Math.max(0,(r.craving - r.ci) / 5 * 100)}%;width:${(r.ci * 2) / 5 * 100}%;height:11px;border-left:1px solid ${col};border-right:1px solid ${col};opacity:.5"></span>` : ''}
        </span>
        <span style="font-family:'JetBrains Mono';font-size:10px;color:var(--mid);text-align:right">${nf(r.craving)}</span>`;
      cw.appendChild(d);
    });
    $('insCrav').className = 'ins ok';
    $('insCrav').innerHTML = `<div class="t">Alvo prioritário</div><div class="x">
      ${auto.length
        ? `<b>${auto.map(r => r.cause).join(', ')}</b> — vontade baixa, ${autoP.toFixed(0)}% do consumo. São <b>hábito automático</b>, não nicotina: cortar esses não gera abstinência real. Comece por aqui.`
        : 'Nenhuma causa com vontade baixa: todos os seus cigarros vêm de vontade média ou alta. A redução vai exigir manejo de abstinência, não só mudança de rotina.'}
      </div>${dep.length ? `<div class="m">Dependência forte (≥4): ${dep.map(r => r.cause).join(', ')} — deixe para depois</div>` : ''}`;

    // Markov
    const top = rows.slice(0, 5).map(r => r.cause);
    const { probs, totals, best } = St.markov(St.causeSequences(records), top);
    const mk = $('mk');
    mk.style.gridTemplateColumns = `52px repeat(${top.length},1fr)`;
    mk.innerHTML = '<div></div>' + top.map(t => `<div class="h" title="${t}">${t.slice(0, 5)}</div>`).join('');
    top.forEach(a => {
      const l = document.createElement('div');
      l.className = 'r'; l.textContent = a; l.title = a;
      mk.appendChild(l);
      top.forEach(b => {
        const p = probs[a][b];
        const c = document.createElement('div');
        c.className = 'c';
        c.style.background = `rgba(168,60,34,${.06 + p * .86})`;
        c.style.color = p > .45 ? '#fff' : '#5E5A50';
        c.textContent = totals[a] ? Math.round(p * 100) : '–';
        c.title = `${a} → ${b}: ${Math.round(p * 100)}%`;
        mk.appendChild(c);
      });
    });
    $('insMk').className = 'ins';
    $('insMk').innerHTML = `<div class="t">Encadeamento mais forte</div><div class="x">
      ${best.from
        ? `Depois de um cigarro de <b>${best.from}</b>, o próximo é de <b>${best.to}</b> em <b>${Math.round(best.p * 100)}%</b> das vezes.
           Quebrar o elo <b>${best.from} → ${best.to}</b> derruba dois cigarros de uma vez, não um.`
        : 'Dados insuficientes para detectar encadeamento entre causas.'}
      </div><div class="m">Linha = causa atual · coluna = próxima causa · valores em %</div>`;

    // qui-quadrado
    const pOf = h2 => h2 < 12 ? 0 : h2 < 18 ? 1 : 2;
    const obs = top.map(c =>
      [0, 1, 2].map(j =>
        records.filter(r => r.cause === c && pOf(new Date(r.ts).getHours()) === j).length));
    const chi = St.chiSquare(obs);
    const ctb = $('chiTb').querySelector('tbody');
    ctb.innerHTML = '';
    top.forEach((c, i) => {
      const tr = document.createElement('tr');
      const cells = [0, 1, 2].map(j => {
        const res = chi.resid[i][j];
        const col = res > 1.5 ? 'var(--r1)' : res < -1.5 ? 'var(--g1)' : 'var(--mid)';
        return `<td style="color:${col};font-weight:${res > 1.5 ? 600 : 400}">${obs[i][j]}</td>`;
      }).join('');
      tr.innerHTML = `<td>${c}</td>${cells}`;
      ctb.appendChild(tr);
    });
    const trT = document.createElement('tr');
    trT.className = 'tot';
    trT.innerHTML = `<td>Total</td>${chi.colT.map(v => `<td>${v}</td>`).join('')}`;
    ctb.appendChild(trT);
    $('insChi').className = 'ins ' + (chi.significant ? '' : 'nu');
    $('insChi').innerHTML = `<div class="t">Teste qui-quadrado</div><div class="x">
      ${chi.significant
        ? `χ² = <b>${nf(chi.chi)}</b> (gl=${chi.df}, crítico ${nf(chi.crit)}): as causas <b>não</b> se distribuem por acaso no dia. Cada gatilho tem <b>seu horário</b> — os números em vermelho estão acima do esperado.`
        : `χ² = ${nf(chi.chi)} (gl=${chi.df}): não há associação significativa entre causa e período do dia.`}
      </div><div class="m">Vermelho = frequência acima do esperado (resíduo &gt; 1,5)</div>`;
  }

  const no = records.length - total;
  $('cv1').textContent = total;
  $('cv2').textContent = no;
  $('cv3').textContent = coverage.toFixed(0) + '%';
  $('cv3').style.color = coverage >= 70 ? 'var(--g1)' : 'var(--r1)';
  $('insCov').className = 'ins ' + (coverage >= 70 ? 'ok' : '');
  $('insCov').innerHTML = `<div class="t">Confiabilidade</div><div class="x">
    ${coverage >= 70
      ? `Cobertura de <b>${coverage.toFixed(0)}%</b> — amostra suficiente para os testes acima serem confiáveis.`
      : `Cobertura de <b>${coverage.toFixed(0)}%</b>. Abaixo de 70% os testes ficam enviesados: os cigarros sem causa podem justamente ser os mais automáticos.`}</div>`;
}

/* ==========================================================================
   Renderização — REGISTROS
   ========================================================================== */

function renderRecords() {
  const w = $('rl');
  w.innerHTML = '';
  if (!records.length) {
    w.innerHTML = '<div class="empty">Nenhum registro ainda.<br>Toque em “+ Agora” para começar.</div>';
    return;
  }
  const g = {};
  records.forEach(r => {
    const k = dateKey(r.ts);
    (g[k] = g[k] || []).push(r);
  });
  const keys = Object.keys(g).sort().reverse().slice(0, 14);
  keys.forEach(k => {
    const list = g[k].sort((a, b) => b.ts - a.ts);
    const nc = list.filter(r => !r.cause).length;
    const d0 = list[0].ts;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const x = new Date(d0); x.setHours(0, 0, 0, 0);
    const diff = Math.round((t - x) / 864e5);
    const lab = diff === 0 ? 'Hoje · ' + DN[d0.getDay()]
      : diff === 1 ? 'Ontem · ' + DN[d0.getDay()]
      : `${d0.getDate()}/${d0.getMonth() + 1} · ${DN[d0.getDay()]}`;

    const h = document.createElement('div');
    h.className = 'dh';
    h.innerHTML = `<span class="a">${lab}</span>
      <span class="b" style="color:${list.length > config.goal ? 'var(--r1)' : 'var(--g1)'}">
        ${list.length} cig${nc ? `<i>${nc} sem causa</i>` : ''}</span>`;
    w.appendChild(h);

    list.forEach((r, i) => {
      const e = document.createElement('div');
      e.className = 'ent';
      const tm = `${pad(r.ts.getHours())}:${pad(r.ts.getMinutes())}`;
      const tags = [];
      if (r.cause)   tags.push(`<span class="tg c">${r.cause}</span>`);
      if (r.mood)    tags.push(`<span class="tg">${r.mood}</span>`);
      if (r.craving) tags.push(`<span class="tg v">vontade ${r.craving}</span>`);
      if (r.note)    tags.push(`<span class="tg" title="${r.note.replace(/"/g,'&quot;')}">✎</span>`);
      if (!tags.length) tags.push('<span class="add">+ causa</span>');
      const nx = list[i + 1];
      const gp = nx ? Math.round((r.ts - nx.ts) / 60000) : null;
      e.innerHTML = `<span class="tm">${tm}</span>
        <span class="cx">${tags.join('')}</span>
        <span class="gap">${gp !== null ? (gp < 20 ? `<b>${gp}m</b>` : `${gp}m`) : ''}</span>`;
      e.querySelector('.tm').onclick = () => openSheet('edit', r);
      e.querySelector('.cx').onclick = () => openSheet('edit', r);
      const b = document.createElement('button');
      b.className = 'del';
      b.innerHTML = '×';
      b.setAttribute('aria-label', 'Excluir');
      b.onclick = ev => { ev.stopPropagation(); del(r.id); };
      e.appendChild(b);
      w.appendChild(e);
    });
  });
  if (Object.keys(g).length > 14) {
    const m = document.createElement('p');
    m.className = 'nt';
    m.style.cssText = 'text-align:center;padding:14px 0 0';
    m.textContent = `Mostrando 14 dias mais recentes · ${records.length} registros no total`;
    w.appendChild(m);
  }
}

/* ==========================================================================
   Renderização — DADOS
   ========================================================================== */

async function renderDados() {
  const d = await store.diagnostics();

  const durable = d.durable;
  setDot(durable ? 'ok' : 'err', durable ? 'Persistindo' : 'Sem persistência');
  $('stHint').textContent = durable
    ? (d.persisted
        ? 'Armazenamento persistente concedido: o navegador não vai descartar seus dados para liberar espaço.'
        : 'Dados salvos localmente. O navegador ainda pode descartá-los sob pressão de espaço — conceda o modo persistente abaixo.')
    : 'Nenhuma camada durável disponível (modo privado ou armazenamento bloqueado). Os dados somem ao fechar a aba. Exporte um backup.';

  $('stRows').innerHTML = d.per.map(l => `
    <div class="row">
      <span class="k">${l.name}</span>
      <span class="v" style="color:${l.ok ? (l.err ? 'var(--r1)' : 'var(--g1)') : 'var(--soft)'}">
        ${!l.ok ? 'indisponível' : l.err ? 'erro' : l.n !== null ? l.n + ' reg.' : 'vazia'}
      </span>
    </div>`).join('') + (d.quota ? `
    <div class="row"><span class="k">Espaço usado</span>
      <span class="v">${(d.quota.usage / 1024).toFixed(0)} KB de ${(d.quota.quota / 1048576).toFixed(0)} MB</span></div>` : '');

  $('btnPersist').disabled = d.persisted === true;
  $('btnPersist').textContent = d.persisted === true
    ? 'Armazenamento persistente ativo ✓'
    : 'Solicitar armazenamento persistente';

  $('exN').textContent = records.length;
  $('exLast').textContent = config.lastExport
    ? new Date(config.lastExport).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    : 'nunca';

  const bk = $('bkList');
  if (!d.backups.length) {
    bk.innerHTML = '<div class="row"><span class="k">Nenhum snapshot ainda</span></div>';
  } else {
    bk.innerHTML = '';
    d.backups.slice(0, 5).forEach(b => {
      const row = document.createElement('div');
      row.className = 'bkp';
      const dt = new Date(b.ts);
      row.innerHTML = `<div class="i">${b.n ?? '?'} registros
        <em>${dt.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</em></div>`;
      const btn = document.createElement('button');
      btn.textContent = 'Restaurar';
      btn.onclick = async () => {
        if (!confirm(`Restaurar o snapshot de ${dt.toLocaleString('pt-BR')}?\n\nOs registros atuais serão substituídos.`)) return;
        try {
          const data = await store.restoreBackup(b.key);
          records = data.map(r => ({ ...r, ts: new Date(r.ts) }));
          records.sort((a, b2) => b2.ts - a.ts);
          refresh();
          toast(`Restaurado: ${records.length} registros`);
        } catch (e) {
          toast('Falha ao restaurar', null, true);
        }
      };
      row.appendChild(btn);
      bk.appendChild(row);
    });
  }

  $('cfgGoal').value  = config.goal;
  $('cfgPrice').value = config.price;
  $('cfgPack').value  = config.perPack;
}

/* ==========================================================================
   Sheet (registrar / editar)
   ========================================================================== */

let mode = 'now', editId = null, sel = { c: null, m: null, v: null }, qty = 1;

function buildChips(el2, arr, key, red) {
  el2.innerHTML = '';
  arr.forEach(v => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = v;
    c.onclick = () => {
      const was = sel[key] === v;
      el2.querySelectorAll('.chip').forEach(x => x.classList.remove('s', 'r'));
      if (!was) {
        c.classList.add('s');
        if (red) c.classList.add('r');
        sel[key] = v;
      } else sel[key] = null;
    };
    el2.appendChild(c);
  });
}

function markChips() {
  [['gC', 'c', 1], ['gM', 'm', 0], ['gV', 'v', 0]].forEach(([id, k, red]) => {
    $(id).querySelectorAll('.chip').forEach(c => {
      c.classList.remove('s', 'r');
      if (sel[k] && c.textContent === String(sel[k])) {
        c.classList.add('s');
        if (red) c.classList.add('r');
      }
    });
  });
}

function openSheet(m, rec) {
  mode = m;
  sel = { c: null, m: null, v: null };
  qty = 1;
  $('qv').textContent = 1;
  $('iN').value = '';
  const d = rec ? rec.ts : new Date();
  $('iD').value = dateKey(d);
  $('iT').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $('fQ').style.display = m === 'back' ? 'block' : 'none';
  $('fD').style.display = m === 'now' ? 'none' : 'block';

  if (m === 'now') {
    $('shT').textContent = 'Registrar cigarro';
    $('shS').textContent = 'Marcar a causa alimenta toda a análise.';
    $('sv').textContent = 'Registrar';
  }
  if (m === 'back') {
    $('shT').textContent = 'Adicionar retroativo';
    $('shS').textContent = 'Esqueceu de marcar? Lance com a data certa.';
    $('sv').textContent = 'Adicionar';
  }
  if (m === 'edit') {
    editId = rec.id;
    $('shT').textContent = 'Editar registro';
    $('shS').textContent = 'Corrija horário, causa ou exclua.';
    $('sv').textContent = 'Salvar alterações';
    sel = { c: rec.cause, m: rec.mood, v: rec.craving ? String(rec.craving) : null };
    $('iN').value = rec.note || '';
  }
  markChips();
  $('veil').classList.add('on');
  $('sheet').classList.add('on');
}

const closeSheet = () => {
  $('veil').classList.remove('on');
  $('sheet').classList.remove('on');
};

async function save() {
  const note = $('iN').value.trim();
  const craving = sel.v ? Number(sel.v) : null;

  if (mode === 'edit') {
    const r = records.find(x => x.id === editId);
    if (!r) return closeSheet();
    const [Y, M, D] = $('iD').value.split('-').map(Number);
    const [h, mi] = $('iT').value.split(':').map(Number);
    r.ts = new Date(Y, M - 1, D, h, mi);
    r.cause = sel.c;
    r.mood = sel.m;
    r.craving = craving;
    r.note = note;
    r.editedAt = Date.now();
    toast('Registro atualizado');
  } else {
    let base;
    if (mode === 'now') base = new Date();
    else {
      const [Y, M, D] = $('iD').value.split('-').map(Number);
      const [h, mi] = $('iT').value.split(':').map(Number);
      base = new Date(Y, M - 1, D, h, mi);
    }
    const k = mode === 'back' ? qty : 1;
    const ids = [];
    for (let i = 0; i < k; i++) {
      const r = {
        id: uid(),
        ts: new Date(base.getTime() + i * 15 * 60000),
        cause: sel.c, mood: sel.m, craving, note,
        createdAt: Date.now(), editedAt: Date.now()
      };
      records.push(r);
      ids.push(r.id);
    }
    toast(k > 1 ? `${k} cigarros adicionados` : 'Registrado', () => {
      records = records.filter(r => !ids.includes(r.id));
      persist('undo-add');
      refresh();
    });
  }
  records.sort((a, b) => b.ts - a.ts);
  await persist(mode);
  closeSheet();
  refresh();
}

async function del(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  records = records.filter(x => x.id !== id);
  await persist('delete');
  refresh();
  toast('Excluído', async () => {
    records.push(r);
    records.sort((a, b) => b.ts - a.ts);
    await persist('undo-delete');
    refresh();
  });
}

/* ==========================================================================
   Export / Import
   ========================================================================== */

async function doExport() {
  const json = await store.exportJSON(records, config);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `smokecount-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  config.lastExport = Date.now();
  await store.setMeta(config);
  renderDados();
  toast(`Backup exportado · ${records.length} registros`);
}

async function doImport(file) {
  try {
    const text = await file.text();
    const merge = confirm(
      'Mesclar com os registros atuais?\n\n' +
      'OK = mesclar (mantém o que já existe)\n' +
      'Cancelar = substituir tudo pelo arquivo'
    );
    const res = await store.importJSON(text, { merge, current: records });
    records = res.records.map(r => ({ ...r, ts: new Date(r.ts) }));
    records.sort((a, b) => b.ts - a.ts);
    const meta = await store.getMeta();
    if (meta) config = { ...config, ...meta };
    refresh();
    toast(`Importados ${res.imported} · total ${res.total}`);
  } catch (e) {
    toast(e.message || 'Falha ao importar', null, true);
  }
}

/* ==========================================================================
   UI
   ========================================================================== */

function toast(msg, undo, bad) {
  const t = $('tst');
  $('tm').textContent = msg;
  t.classList.toggle('bad', !!bad);
  t.querySelectorAll('u').forEach(u => u.remove());
  if (undo) {
    const u = document.createElement('u');
    u.textContent = 'Desfazer';
    u.onclick = () => { undo(); t.classList.remove('on'); };
    t.appendChild(u);
  }
  t.classList.add('on');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('on'), 3400);
}

function goTab(id) {
  document.querySelectorAll('.tabs button').forEach(x =>
    x.classList.toggle('on', x.dataset.v === id));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('on', v.id === id));
  $('body').scrollTop = 0;
  if (id === 'v5') renderDados();
}

function bindUI() {
  buildChips($('gC'), CAUSES, 'c', true);
  buildChips($('gM'), MOODS, 'm', false);
  buildChips($('gV'), ['1', '2', '3', '4', '5'], 'v', false);

  $('plus').onclick  = () => openSheet('now');
  $('aNow').onclick  = () => openSheet('now');
  $('aBack').onclick = () => openSheet('back');
  $('cn').onclick    = closeSheet;
  $('veil').onclick  = closeSheet;
  $('sv').onclick    = save;
  $('qm').onclick    = () => { if (qty > 1) { qty--; $('qv').textContent = qty; } };
  $('qp').onclick    = () => { qty++; $('qv').textContent = qty; };

  document.querySelectorAll('.tabs button').forEach(b => {
    b.onclick = () => goTab(b.dataset.v);
  });

  $('btnExport').onclick = doExport;
  $('btnImport').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => {
    const f = e.target.files[0];
    if (f) doImport(f);
    e.target.value = '';
  };

  $('btnPersist').onclick = async () => {
    const ok = await store.requestPersistence();
    toast(ok ? 'Armazenamento persistente concedido'
             : 'O navegador negou. Instale o app na tela inicial e tente de novo.');
    renderDados();
  };

  $('btnCfg').onclick = async () => {
    config.goal    = Math.max(1, Number($('cfgGoal').value) || 10);
    config.price   = Math.max(0, Number($('cfgPrice').value) || 0);
    config.perPack = Math.max(1, Number($('cfgPack').value) || 20);
    await store.setMeta(config);
    refresh();
    toast('Preferências salvas');
  };

  $('btnWipe').onclick = async () => {
    if (!confirm('Apagar TODOS os registros deste dispositivo?\n\nIsto não pode ser desfeito. Exporte um backup antes.')) return;
    if (!confirm('Tem certeza absoluta?')) return;
    records = [];
    await store.saveRecords([]);
    refresh();
    toast('Todos os dados foram apagados');
  };

  // Atalho: tecla "+" registra.
  document.addEventListener('keydown', e => {
    if (e.key === '+' && !$('sheet').classList.contains('on') &&
        !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      openSheet('now');
    }
    if (e.key === 'Escape') closeSheet();
  });
}

function refresh() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  $('qn').textContent = records.filter(r => r.ts >= t).length + ' hoje';
  renderSerie();
  renderRitmo();
  renderCausas();
  renderRecords();
  if ($('v5').classList.contains('on')) renderDados();
}

/* ---------- service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

boot();
