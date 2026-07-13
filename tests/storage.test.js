/* ==========================================================================
   SmokeCount — testes da camada de persistência (js/storage.js)

   Runner: node --test (nativo, zero dependências — princípio do repo).

   IndexedDB/localStorage não existem no Node, então injetamos camadas fake
   em `store.active` diretamente (nunca chamamos `store.init()`, que toca
   `window`). Cada teste monta seu próprio `Store` + camada(s) fake, sem
   estado compartilhado entre testes.
   ========================================================================== */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Store } from '../js/storage.js';

/* ==========================================================================
   Camadas fake
   ========================================================================== */

/** Camada em memória, síncrona por baixo (promises já resolvidas). */
class FakeLayer {
  constructor(name = 'fake') {
    this.name = name;
    this.ok = true;
    this.m = new Map();
  }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async set(k, v) { this.m.set(k, v); return true; }
  async del(k) { this.m.delete(k); return true; }
  async keys() { return [...this.m.keys()]; }
}

/** Camada que sempre falha (indisponível) — para testar recuperação. */
class FailingLayer {
  constructor(name = 'failing') { this.name = name; this.ok = false; }
  async get() { return null; }
  async set() { return false; }
  async del() { return false; }
  async keys() { return []; }
}

/** Camada lenta: `set` leva `delayMs` para resolver. Simula IndexedDB sob
 * carga, usada para expor corridas de gravação. */
class SlowLayer extends FakeLayer {
  constructor(name = 'slow', delayMs = 15) {
    super(name);
    this.delayMs = delayMs;
  }
  async set(k, v) {
    await new Promise(res => setTimeout(res, this.delayMs));
    return super.set(k, v);
  }
}

const rec = (id, ts, extra = {}) => ({ id, ts, cause: null, mood: null, craving: null, note: null, ...extra });

const docOf = (records, meta) => JSON.stringify({
  app: 'smokecount',
  schema: 1,
  exportedAt: new Date().toISOString(),
  count: records.length,
  meta,
  records
});

/* ==========================================================================
   importJSON
   ========================================================================== */

describe('importJSON — validação e sanitização', () => {
  let store;
  beforeEach(() => {
    store = new Store();
    store.active = [new FakeLayer()];
  });

  it('registros válidos entram; imported e skipped corretos', async () => {
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z'), rec('b', '2026-01-02T10:00:00.000Z')]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.imported, 2);
    assert.strictEqual(res.skipped, 0);
    assert.strictEqual(res.total, 2);
    assert.strictEqual(res.records.length, 2);
  });

  it('craving fora de 1–5 vira null, registro sobrevive', async () => {
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { craving: 0 }),
                        rec('b', '2026-01-01T10:00:00.000Z', { craving: 6 })]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.imported, 2);
    assert.strictEqual(res.skipped, 0);
    assert.ok(res.records.every(r => r.craving === null));
  });

  it('craving não-inteiro vira null', async () => {
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { craving: 2.5 })]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.records[0].craving, null);
  });

  it('craving string ("3") vira null — sem coerção silenciosa', async () => {
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { craving: '3' })]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.records[0].craving, null);
  });

  it('craving válido (1 e 5, extremos) é preservado', async () => {
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { craving: 1 }),
                        rec('b', '2026-01-01T10:00:00.000Z', { craving: 5 })]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.records.find(r => r.id === 'a').craving, 1);
    assert.strictEqual(res.records.find(r => r.id === 'b').craving, 5);
  });

  it('cause/mood não-string viram null', async () => {
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { cause: 123, mood: {} })]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.records[0].cause, null);
    assert.strictEqual(res.records[0].mood, null);
  });

  it('note não-string vira null', async () => {
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { note: 42 })]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.records[0].note, null);
  });

  it('note longa é truncada a 2000 caracteres', async () => {
    const long = 'x'.repeat(2500);
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { note: long })]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.records[0].note.length, 2000);
    assert.strictEqual(res.records[0].note, 'x'.repeat(2000));
  });

  it('note dentro do teto não é alterada', async () => {
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { note: 'nota curta' })]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.records[0].note, 'nota curta');
  });

  it('id ausente → registro descartado e contado em skipped', async () => {
    const bad = { ts: '2026-01-01T10:00:00.000Z' };
    const good = rec('a', '2026-01-01T10:00:00.000Z');
    const doc = docOf([bad, good]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.imported, 1);
    assert.strictEqual(res.skipped, 1);
  });

  it('id vazio → descartado', async () => {
    const doc = docOf([{ id: '', ts: '2026-01-01T10:00:00.000Z' }, rec('a', '2026-01-01T10:00:00.000Z')]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.imported, 1);
    assert.strictEqual(res.skipped, 1);
  });

  it('ts ausente → descartado', async () => {
    const bad = { id: 'x' };
    const good = rec('a', '2026-01-01T10:00:00.000Z');
    const doc = docOf([bad, good]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.imported, 1);
    assert.strictEqual(res.skipped, 1);
  });

  it('ts inválido (string não-data) → descartado', async () => {
    const bad = { id: 'x', ts: 'não é uma data' };
    const good = rec('a', '2026-01-01T10:00:00.000Z');
    const doc = docOf([bad, good]);
    const res = await store.importJSON(doc);
    assert.strictEqual(res.imported, 1);
    assert.strictEqual(res.skipped, 1);
  });

  it('todos os registros inválidos → lança "não contém registros válidos"', async () => {
    const doc = docOf([{ id: '' }, { ts: 'lixo' }]);
    await assert.rejects(() => store.importJSON(doc), /não contém registros válidos/);
  });

  it('JSON malformado → "Arquivo não é um JSON válido"', async () => {
    await assert.rejects(() => store.importJSON('{ isso não é json'), /JSON válido/);
  });

  it('doc sem app:"smokecount" → rejeitado', async () => {
    const doc = JSON.stringify({ app: 'outroapp', records: [] });
    await assert.rejects(() => store.importJSON(doc), /não é um backup do SmokeCount/);
  });

  it('doc sem records array → rejeitado', async () => {
    const doc = JSON.stringify({ app: 'smokecount' });
    await assert.rejects(() => store.importJSON(doc), /não é um backup do SmokeCount/);
  });

  it('merge idempotente: reimportar o mesmo backup não duplica', async () => {
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { editedAt: 100 })]);
    const res1 = await store.importJSON(doc, { current: [] });
    const res2 = await store.importJSON(doc, { current: res1.records });
    assert.strictEqual(res2.total, 1);
    assert.strictEqual(res2.records.length, 1);
  });

  it('merge: editedAt maior no import vence o registro atual', async () => {
    const current = [rec('a', '2026-01-01T10:00:00.000Z', { editedAt: 100, note: 'antiga' })];
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { editedAt: 200, note: 'nova' })]);
    const res = await store.importJSON(doc, { current });
    assert.strictEqual(res.records[0].note, 'nova');
  });

  it('merge: editedAt menor no import NÃO sobrescreve o atual', async () => {
    const current = [rec('a', '2026-01-01T10:00:00.000Z', { editedAt: 200, note: 'atual' })];
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { editedAt: 100, note: 'velha-demais' })]);
    const res = await store.importJSON(doc, { current });
    assert.strictEqual(res.records[0].note, 'atual');
  });

  it('merge: editedAt igual — importado vence (>=)', async () => {
    const current = [rec('a', '2026-01-01T10:00:00.000Z', { editedAt: 100, note: 'atual' })];
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z', { editedAt: 100, note: 'importada' })]);
    const res = await store.importJSON(doc, { current });
    assert.strictEqual(res.records[0].note, 'importada');
  });

  it('resultado final é ordenado por ts (mais recente primeiro)', async () => {
    const doc = docOf([
      rec('a', '2026-01-01T10:00:00.000Z'),
      rec('c', '2026-01-03T10:00:00.000Z'),
      rec('b', '2026-01-02T10:00:00.000Z'),
    ]);
    const res = await store.importJSON(doc);
    assert.deepStrictEqual(res.records.map(r => r.id), ['c', 'b', 'a']);
  });

  it('grava meta quando o doc traz meta', async () => {
    const doc = docOf([rec('a', '2026-01-01T10:00:00.000Z')], { goal: 5, price: 12, perPack: 20 });
    await store.importJSON(doc);
    const meta = await store.getMeta();
    assert.strictEqual(meta.goal, 5);
  });
});

/* ==========================================================================
   shouldRemindBackup
   ========================================================================== */

describe('shouldRemindBackup', () => {
  const store = new Store();
  const DAY = 24 * 60 * 60 * 1000;

  it('0 registros → false', () => {
    assert.strictEqual(store.shouldRemindBackup({}, 0), false);
  });

  it('< 20 registros → false, mesmo sem export', () => {
    assert.strictEqual(store.shouldRemindBackup({}, 19), false);
  });

  it('>= 20 registros e nunca exportou → true', () => {
    assert.strictEqual(store.shouldRemindBackup({}, 20), true);
    assert.strictEqual(store.shouldRemindBackup({ lastExport: null }, 30), true);
  });

  it('>= 20 registros e export há 31 dias → true', () => {
    assert.strictEqual(store.shouldRemindBackup({ lastExport: Date.now() - 31 * DAY }, 25), true);
  });

  it('>= 20 registros e export há 29 dias → false', () => {
    assert.strictEqual(store.shouldRemindBackup({ lastExport: Date.now() - 29 * DAY }, 25), false);
  });

  it('contagem não-numérica → false', () => {
    assert.strictEqual(store.shouldRemindBackup({ lastExport: null }, 'muitos'), false);
    assert.strictEqual(store.shouldRemindBackup({ lastExport: null }, NaN), false);
    assert.strictEqual(store.shouldRemindBackup({ lastExport: null }, undefined), false);
  });

  // config ausente = boot incompleto, não "nunca exportou": não se deve
  // alarmar sobre um estado que pode nem ter carregado. Guard explícito em
  // js/storage.js garante o retorno false.
  it('config null/undefined → false (boot incompleto, não alarma)', () => {
    assert.strictEqual(store.shouldRemindBackup(null, 25), false);
    assert.strictEqual(store.shouldRemindBackup(undefined, 25), false);
  });
});

/* ==========================================================================
   Corrida de gravação (Fase 1)
   ========================================================================== */

describe('saveRecords — corrida de gravação', () => {
  it('save disparado durante outro save em andamento: camada durável termina '
    + 'com o estado MAIS NOVO, e dirty fica false', async () => {
    const store = new Store();
    const slow = new SlowLayer('slow', 20);
    store.active = [slow];

    const recordsA = [rec('a1', '2026-01-01T10:00:00.000Z')];
    const recordsB = [rec('b1', '2026-01-02T10:00:00.000Z'), rec('b2', '2026-01-03T10:00:00.000Z')];

    // Dispara A (não aguarda) — this.saving é setado sincronamente antes do
    // primeiro await interno, então o disparo de B logo em seguida cai no
    // branch de enfileiramento.
    const p1 = store.saveRecords(recordsA);
    const p2 = store.saveRecords(recordsB);

    assert.strictEqual(store.dirty, true, 'B enfileirado deve marcar dirty');

    await Promise.all([p1, p2]);

    assert.strictEqual(store.dirty, false, 'dirty deve cair após o save encadeado terminar');
    assert.strictEqual(store.saving, false);

    const loaded = await store.loadRecords();
    assert.deepStrictEqual(loaded.map(r => r.id).sort(), ['b1', 'b2'],
      'a camada durável deve refletir o snapshot mais novo (B), não A');
  });

  it('múltiplos saves enfileirados durante um save lento: só o último prevalece', async () => {
    const store = new Store();
    const slow = new SlowLayer('slow', 15);
    store.active = [slow];

    const p1 = store.saveRecords([rec('a', '2026-01-01T10:00:00.000Z')]);
    store.saveRecords([rec('b', '2026-01-01T10:00:00.000Z')]);
    store.saveRecords([rec('c', '2026-01-01T10:00:00.000Z')]); // sobrescreve o enfileiramento anterior

    await p1;
    const loaded = await store.loadRecords();
    assert.deepStrictEqual(loaded.map(r => r.id), ['c']);
  });
});

/* ==========================================================================
   Auto-reparo na leitura (Fase 1)
   ========================================================================== */

describe('loadRecords — auto-reparo entre camadas divergentes', () => {
  it('duas camadas divergentes: vence o maior ts; a divergente é ressincronizada', async () => {
    const store = new Store();
    const fastA = new FakeLayer('A');
    const fastB = new FakeLayer('B');

    // 1) Escreve o mesmo estado inicial nas duas.
    store.active = [fastA, fastB];
    await store.saveRecords([rec('old', '2026-01-01T10:00:00.000Z')]);

    // 2) Só A recebe uma atualização — B fica "para trás" (divergente).
    store.active = [fastA];
    await store.saveRecords([rec('new', '2026-01-02T10:00:00.000Z')]);

    const envAbefore = await fastA.get('records');
    const envBbefore = await fastB.get('records');
    assert.notStrictEqual(envAbefore.ts, envBbefore.ts, 'pré-condição: camadas devem divergir');

    // 3) Volta a ler com as duas ativas: deve vencer A (mais novo) e reparar B.
    let repaired = null;
    store.onStatus((status, detail) => { if (status === 'repaired') repaired = detail; });
    store.active = [fastA, fastB];
    const data = await store.loadRecords();

    assert.deepStrictEqual(data.map(r => r.id), ['new']);
    assert.ok(repaired, 'evento "repaired" deveria ter disparado');
    assert.strictEqual(repaired.layer, 'B');

    const envBafter = await fastB.get('records');
    assert.strictEqual(envBafter.ts, envAbefore.ts, 'B deve estar ressincronizada com o vencedor (A)');
  });

  it('camada indisponível (falha) é ignorada; recuperação usa a que sobrou', async () => {
    const store = new Store();
    const ok = new FakeLayer('ok');
    const failing = new FailingLayer('quebrada');
    store.active = [ok, failing];

    await store.saveRecords([rec('x', '2026-01-01T10:00:00.000Z')]);
    const data = await store.loadRecords();
    assert.deepStrictEqual(data.map(r => r.id), ['x']);
  });

  it('nenhuma camada com dados válidos e sem backup → retorna null', async () => {
    const store = new Store();
    store.active = [new FakeLayer()];
    const data = await store.loadRecords();
    assert.strictEqual(data, null);
  });
});
