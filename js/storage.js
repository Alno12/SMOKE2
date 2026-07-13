/* ==========================================================================
   SmokeCount — Camada de persistência
   --------------------------------------------------------------------------
   Estratégia de defesa em profundidade. Nenhuma camada isolada é confiável:
   IndexedDB pode ser bloqueado, localStorage pode estourar cota ou ser limpo
   pelo navegador, e modo privado derruba os dois. Escrevemos em todas as que
   estiverem disponíveis e lemos da mais confiável que responder.

   Camadas (em ordem de preferência de leitura):
     L1  IndexedDB      — primária. Alta capacidade, transacional.
     L2  localStorage   — espelho. Sobrevive se o IDB falhar.
     L3  Memória        — último recurso. Mantém a sessão viva mesmo se
                          tudo estiver bloqueado (modo privado, cota zero).

   Proteções adicionais:
     - Escrita atômica: grava em chave temporária, valida, depois promove.
     - Checksum por snapshot: detecta corrupção silenciosa.
     - Rotação de backups: mantém os N snapshots anteriores.
     - Journal de operações: toda mutação é registrada e pode ser reaplicada.
     - Export/import JSON: a única garantia real contra perda do dispositivo.
   ========================================================================== */

const DB_NAME    = 'smokecount';
const DB_VERSION = 1;
const STORE      = 'kv';
const LS_PREFIX  = 'sc:';
const KEY_MAIN   = 'records';
const KEY_META   = 'meta';
const KEY_JOURNAL= 'journal';
const BACKUP_KEEP= 5;          // quantos snapshots anteriores manter
const JOURNAL_MAX= 500;        // entradas do journal antes de compactar
const NOTE_MAX   = 2000;       // teto de caracteres de nota importada

/* ---------- utilidades ---------- */

// Checksum simples (FNV-1a 32-bit). Não é criptográfico — é detector de
// corrupção. Suficiente para pegar truncamento e escrita parcial.
function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Relógio monotônico.
 *
 * Date.now() tem resolução de milissegundo, e duas gravações seguidas (o usuário
 * corrigindo vários registros em rajada) caem no mesmo ms. Como a chave do
 * snapshot é o timestamp, elas colidiriam e um backup sobrescreveria o outro —
 * perdendo exatamente os pontos de retorno de que o usuário mais precisa
 * durante uma sequência de edições. O contador garante que cada gravação
 * receba um carimbo estritamente crescente.
 */
let _lastTs = 0;
function monotonicNow() {
  const now = Date.now();
  _lastTs = now > _lastTs ? now : _lastTs + 1;
  return _lastTs;
}

function envelope(data) {
  const payload = JSON.stringify(data);
  return {
    v: 1,
    ts: monotonicNow(),
    sum: checksum(payload),
    n: Array.isArray(data) ? data.length : null,
    payload
  };
}

function unwrap(env) {
  if (!env || typeof env !== 'object' || typeof env.payload !== 'string') {
    throw new Error('envelope inválido');
  }
  if (checksum(env.payload) !== env.sum) {
    throw new Error('checksum não confere — dados corrompidos');
  }
  return JSON.parse(env.payload);
}

/**
 * Sanitiza um registro vindo de um backup importado.
 *
 * Backup é vetor de conteúdo arbitrário: um arquivo malformado (ts inválido,
 * craving fora de faixa, note gigante) entraria no estado e quebraria as
 * renderizações. Aqui validamos campo a campo.
 *
 * Descartamos (retornando null) só quando o dado ESSENCIAL falta: sem `id`
 * não há como mesclar por identidade; sem `ts` válido o cigarro não tem
 * horário — e o horário é o registro. Campos acessórios inválidos são
 * neutralizados (null / truncados), nunca motivam descarte do registro
 * inteiro: perder o horário de um cigarro por causa de um craving inválido
 * seria jogar fora o dado que importa.
 */
function sanitizeRecord(r) {
  if (!r || typeof r !== 'object') return null;
  // id: string não-vazia.
  if (typeof r.id !== 'string' || r.id === '') return null;
  // ts: precisa gerar uma Date válida (aceita ISO string ou epoch numérico).
  if (r.ts === null || r.ts === undefined || isNaN(new Date(r.ts))) return null;

  // Preserva campos auxiliares (createdAt, editedAt, etc.) e sobrescreve os
  // validados. O merge por editedAt e a ordenação por ts contam com eles.
  const clean = { ...r };

  // craving: número inteiro 1–5; qualquer outra coisa zera o campo (não
  // descarta o registro). Exige tipo number — string/boolean não coagem, para
  // não deixar entrar "2", true ou "" virando valor por coerção silenciosa.
  clean.craving = (typeof r.craving === 'number' &&
                   Number.isInteger(r.craving) &&
                   r.craving >= 1 && r.craving <= 5) ? r.craving : null;

  // cause / mood: string ou null.
  clean.cause = typeof r.cause === 'string' ? r.cause : null;
  clean.mood  = typeof r.mood  === 'string' ? r.mood  : null;

  // note: string truncada a um teto; qualquer outro tipo vira null.
  clean.note = typeof r.note === 'string'
    ? (r.note.length > NOTE_MAX ? r.note.slice(0, NOTE_MAX) : r.note)
    : null;

  return clean;
}

/* ---------- L1: IndexedDB ---------- */

class IDBLayer {
  constructor() { this.name = 'IndexedDB'; this.db = null; this.ok = false; }

  async init() {
    if (!('indexedDB' in window)) return false;
    try {
      this.db = await new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => res(req.result);
        req.onerror   = () => rej(req.error);
        req.onblocked = () => rej(new Error('bloqueado'));
        setTimeout(() => rej(new Error('timeout')), 4000);
      });
      this.ok = true;
      return true;
    } catch (e) {
      console.warn('[storage] IndexedDB indisponível:', e.message);
      return false;
    }
  }

  _tx(mode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async get(key) {
    if (!this.ok) return null;
    return new Promise((res) => {
      try {
        const r = this._tx('readonly').get(key);
        r.onsuccess = () => res(r.result ?? null);
        r.onerror   = () => res(null);
      } catch { res(null); }
    });
  }

  async set(key, val) {
    if (!this.ok) return false;
    return new Promise((res) => {
      try {
        const r = this._tx('readwrite').put(val, key);
        r.onsuccess = () => res(true);
        r.onerror   = () => res(false);
      } catch { res(false); }
    });
  }

  async del(key) {
    if (!this.ok) return false;
    return new Promise((res) => {
      try {
        const r = this._tx('readwrite').delete(key);
        r.onsuccess = () => res(true);
        r.onerror   = () => res(false);
      } catch { res(false); }
    });
  }

  async keys() {
    if (!this.ok) return [];
    return new Promise((res) => {
      try {
        const r = this._tx('readonly').getAllKeys();
        r.onsuccess = () => res(r.result || []);
        r.onerror   = () => res([]);
      } catch { res([]); }
    });
  }
}

/* ---------- L2: localStorage ---------- */

class LSLayer {
  constructor() { this.name = 'localStorage'; this.ok = false; }

  async init() {
    try {
      const probe = LS_PREFIX + '__probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      this.ok = true;
      return true;
    } catch (e) {
      console.warn('[storage] localStorage indisponível:', e.message);
      return false;
    }
  }

  async get(key) {
    if (!this.ok) return null;
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async set(key, val) {
    if (!this.ok) return false;
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(val));
      return true;
    } catch (e) {
      // Cota estourada: derruba os backups mais antigos e tenta de novo.
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn('[storage] cota do localStorage estourada, limpando backups');
        this._evictBackups();
        try {
          localStorage.setItem(LS_PREFIX + key, JSON.stringify(val));
          return true;
        } catch { return false; }
      }
      return false;
    }
  }

  _evictBackups() {
    const bk = Object.keys(localStorage)
      .filter(k => k.startsWith(LS_PREFIX + 'backup:'))
      .sort();
    bk.slice(0, Math.max(1, bk.length - 1)).forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });
  }

  async del(key) {
    if (!this.ok) return false;
    try { localStorage.removeItem(LS_PREFIX + key); return true; }
    catch { return false; }
  }

  async keys() {
    if (!this.ok) return [];
    try {
      return Object.keys(localStorage)
        .filter(k => k.startsWith(LS_PREFIX))
        .map(k => k.slice(LS_PREFIX.length));
    } catch { return []; }
  }
}

/* ---------- L3: memória ---------- */

class MemLayer {
  constructor() { this.name = 'memória'; this.ok = true; this.m = new Map(); }
  async init()          { return true; }
  async get(k)          { return this.m.has(k) ? this.m.get(k) : null; }
  async set(k, v)       { this.m.set(k, v); return true; }
  async del(k)          { this.m.delete(k); return true; }
  async keys()          { return [...this.m.keys()]; }
}

/* ==========================================================================
   Store — orquestra as camadas
   ========================================================================== */

export class Store {
  constructor() {
    this.layers  = [new IDBLayer(), new LSLayer(), new MemLayer()];
    this.active  = [];
    this.dirty   = false;
    this.saving  = false;
    this.lastSave= null;
    this.listeners = [];
    this._flushTimer = null;
  }

  onStatus(fn) { this.listeners.push(fn); }
  _emit(status, detail) { this.listeners.forEach(f => f(status, detail)); }

  async init() {
    for (const l of this.layers) {
      const ok = await l.init();
      if (ok) this.active.push(l);
    }
    // A camada de memória sempre entra; garante que o app nunca quebre.
    if (!this.active.length) this.active.push(new MemLayer());
    this._emit('ready', this.health());

    // Rede de segurança: descarrega antes de fechar a aba. O flush síncrono
    // já resolve; pedir confirmação de saída ao usuário seria só atrito.
    window.addEventListener('beforeunload', () => {
      if (this.dirty) this._flushSync();
    });
    // Em mobile, 'beforeunload' não dispara de forma confiável.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.dirty) this._flushSync();
    });

    return this.health();
  }

  health() {
    return {
      layers: this.layers.map(l => ({ name: l.name, ok: l.ok })),
      primary: this.active[0]?.name || 'nenhuma',
      durable: this.active.some(l => l.name !== 'memória'),
      lastSave: this.lastSave
    };
  }

  /* ---------- leitura com fallback e auto-reparo ---------- */

  async loadRecords() {
    const results = [];
    for (const l of this.active) {
      try {
        const env = await l.get(KEY_MAIN);
        if (!env) continue;
        const data = unwrap(env);      // valida checksum
        results.push({ layer: l, env, data });
      } catch (e) {
        console.warn(`[storage] ${l.name} com dados inválidos:`, e.message);
      }
    }

    if (!results.length) {
      // Nada válido na via principal. Tenta o backup mais recente.
      const rec = await this._recoverFromBackup();
      if (rec) {
        this._emit('recovered', { from: 'backup', n: rec.length });
        await this.saveRecords(rec, { silent: true });
        return rec;
      }
      return null;
    }

    // Vence o snapshot mais recente.
    results.sort((a, b) => b.env.ts - a.env.ts);
    const winner = results[0];

    // Auto-reparo: replica o vencedor nas camadas que divergiram ou falharam.
    for (const l of this.active) {
      const r = results.find(x => x.layer === l);
      if (!r || r.env.ts !== winner.env.ts) {
        await l.set(KEY_MAIN, winner.env);
        if (r) this._emit('repaired', { layer: l.name });
      }
    }

    return winner.data;
  }

  async _recoverFromBackup() {
    for (const l of this.active) {
      const keys = (await l.keys()).filter(k => k.startsWith('backup:')).sort().reverse();
      for (const k of keys) {
        try {
          const env = await l.get(k);
          const data = unwrap(env);
          if (Array.isArray(data) && data.length) {
            console.warn(`[storage] recuperado de ${l.name}/${k}`);
            return data;
          }
        } catch {}
      }
    }
    return null;
  }

  /* ---------- escrita atômica com backup rotativo ---------- */

  async saveRecords(records, opts = {}) {
    // Gravação já em andamento: enfileira este snapshot em vez de descartar.
    // Sem isso, uma edição feita durante o save anterior nunca chegaria às
    // camadas duráveis se nenhuma outra gravação viesse depois.
    if (this.saving) {
      this._pending = records;
      this._pendingOpts = opts;
      this._saveQueued = true;
      this.dirty = true;
      return;
    }
    this.saving = true;

    const env = envelope(records);
    let wrote = 0;

    for (const l of this.active) {
      try {
        // 1. Rotaciona o snapshot atual para backup antes de sobrescrever.
        if (!opts.silent) {
          const prev = await l.get(KEY_MAIN);
          if (prev) await l.set(`backup:${String(prev.ts).padStart(14, '0')}`, prev);
        }
        // 2. Escrita atômica: temporária → valida → promove.
        const okTmp = await l.set(KEY_MAIN + ':tmp', env);
        if (!okTmp) continue;
        const back = await l.get(KEY_MAIN + ':tmp');
        unwrap(back);                          // lança se corrompeu na ida
        const okMain = await l.set(KEY_MAIN, env);
        await l.del(KEY_MAIN + ':tmp');
        if (okMain) wrote++;

        // 3. Poda backups antigos.
        await this._pruneBackups(l);
      } catch (e) {
        console.warn(`[storage] falha ao gravar em ${l.name}:`, e.message);
      }
    }

    this.saving = false;
    this.lastSave = Date.now();

    if (wrote === 0) {
      this._emit('error', { msg: 'Nenhuma camada aceitou a escrita' });
    } else {
      this._emit('saved', { layers: wrote, n: records.length, ts: this.lastSave });
    }

    // Chegou snapshot novo enquanto gravávamos? Grava-o já — 'dirty' só cai
    // quando o estado em disco reflete o último estado em memória.
    if (this._saveQueued) {
      this._saveQueued = false;
      return this.saveRecords(this._pending, this._pendingOpts || {});
    }
    this.dirty = false;
    return wrote > 0;
  }

  async _pruneBackups(layer) {
    const bk = (await layer.keys()).filter(k => k.startsWith('backup:')).sort();
    for (const k of bk.slice(0, Math.max(0, bk.length - BACKUP_KEEP))) {
      await layer.del(k);
    }
  }

  // Escrita síncrona de emergência (aba fechando). Só localStorage aceita
  // gravação síncrona; IndexedDB não conclui a tempo.
  _flushSync() {
    try {
      const recs = this._pending;
      if (!recs) return;
      localStorage.setItem(LS_PREFIX + KEY_MAIN, JSON.stringify(envelope(recs)));
    } catch {}
  }

  // Debounce: agrupa rajadas de edição em uma única gravação.
  scheduleSave(records, ms = 400) {
    this._pending = records;
    this.dirty = true;
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.saveRecords(records), ms);
  }

  /* ---------- metadados (meta, config) ---------- */

  async getMeta() {
    for (const l of this.active) {
      try {
        const env = await l.get(KEY_META);
        if (env) return unwrap(env);
      } catch {}
    }
    return null;
  }

  async setMeta(meta) {
    const env = envelope(meta);
    for (const l of this.active) { try { await l.set(KEY_META, env); } catch {} }
  }

  /* ---------- journal de operações ---------- */

  async appendJournal(op) {
    const l = this.active[0];
    if (!l) return;
    try {
      let j = (await l.get(KEY_JOURNAL)) || [];
      j.push({ ...op, at: Date.now() });
      if (j.length > JOURNAL_MAX) j = j.slice(-JOURNAL_MAX);
      await l.set(KEY_JOURNAL, j);
    } catch {}
  }

  async getJournal() {
    const l = this.active[0];
    if (!l) return [];
    try { return (await l.get(KEY_JOURNAL)) || []; } catch { return []; }
  }

  /* ---------- backups visíveis ao usuário ---------- */

  async listBackups() {
    const out = [];
    for (const l of this.active) {
      for (const k of (await l.keys()).filter(k => k.startsWith('backup:'))) {
        try {
          const env = await l.get(k);
          out.push({ key: k, layer: l.name, ts: env.ts, n: env.n });
        } catch {}
      }
    }
    // Dedupe por timestamp; ordena do mais novo para o mais antigo.
    const seen = new Set();
    return out
      .sort((a, b) => b.ts - a.ts)
      .filter(b => (seen.has(b.ts) ? false : seen.add(b.ts)));
  }

  async restoreBackup(key) {
    for (const l of this.active) {
      try {
        const env = await l.get(key);
        if (!env) continue;
        const data = unwrap(env);
        await this.saveRecords(data);
        this._emit('restored', { n: data.length, ts: env.ts });
        return data;
      } catch {}
    }
    throw new Error('Backup não encontrado ou corrompido');
  }

  /* ---------- export / import ---------- */

  async exportJSON(records, meta) {
    const doc = {
      app: 'smokecount',
      schema: 1,
      exportedAt: new Date().toISOString(),
      count: records.length,
      meta: meta || (await this.getMeta()),
      records
    };
    const body = JSON.stringify(doc, null, 2);
    doc.integrity = checksum(body);
    return JSON.stringify(doc, null, 2);
  }

  async importJSON(text, { merge = true, current = [] } = {}) {
    let doc;
    try { doc = JSON.parse(text); }
    catch { throw new Error('Arquivo não é um JSON válido'); }

    if (doc.app !== 'smokecount' || !Array.isArray(doc.records)) {
      throw new Error('Este arquivo não é um backup do SmokeCount');
    }

    // Valida/sanea campo a campo. Inválidos são DESCARTADOS (contados em
    // `skipped`), nunca lançam — um registro podre não invalida o backup todo.
    let skipped = 0;
    const incoming = [];
    for (const r of doc.records) {
      const clean = sanitizeRecord(r);
      if (clean) incoming.push(clean);
      else skipped++;
    }
    if (!incoming.length) throw new Error('O arquivo não contém registros válidos');

    let final;
    if (merge) {
      // União por id; em conflito, vence o registro editado por último.
      const map = new Map(current.map(r => [r.id, r]));
      for (const r of incoming) {
        const ex = map.get(r.id);
        if (!ex || (r.editedAt || 0) >= (ex.editedAt || 0)) map.set(r.id, r);
      }
      final = [...map.values()];
    } else {
      final = incoming;
    }

    final.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    await this.saveRecords(final);
    if (doc.meta) await this.setMeta(doc.meta);

    return {
      records: final,
      imported: incoming.length,
      skipped,
      total: final.length,
      added: final.length - current.length
    };
  }

  /* ---------- lembrete de backup ---------- */

  /**
   * Decide se vale lembrar o usuário de exportar um backup. Puro: recebe a
   * config e a contagem prontas, não faz I/O (o chamador já tem ambos em mãos
   * no boot). Modo de falha nº 1 do app é perda do dispositivo; o export é a
   * única defesa real contra isso, então cutucamos — mas sem virar ruído.
   *
   * Retorna true quando:
   *   - há pelo menos 1 registro (sem dados, nada a proteger); E
   *   - já há histórico que valha a pena (>= MIN_RECORDS) — abaixo disso o
   *     usuário mal começou e refazer custaria pouco; o aviso só atrapalharia; E
   *   - nunca exportou, OU o último export tem mais de 30 dias.
   */
  shouldRemindBackup(config, recordCount) {
    try {
      // Sem config ainda: boot incompleto, não "nunca exportou". Não alarmar
      // sobre um estado que pode nem ter carregado.
      if (!config) return false;

      const n = Number(recordCount);
      if (!Number.isFinite(n) || n < 1) return false;

      // ~20 registros ≈ um a dois dias de uso de um fumante típico: já é
      // histórico que ninguém quer redigitar, e passou do ruído inicial.
      const MIN_RECORDS = 20;
      if (n < MIN_RECORDS) return false;

      const last = config.lastExport;
      if (!last) return true;                       // nunca exportou

      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      return (Date.now() - last) > THIRTY_DAYS;
    } catch {
      return false;                                 // storage nunca quebra o app
    }
  }

  /* ---------- diagnóstico ---------- */

  async diagnostics() {
    const h = this.health();
    const per = [];
    for (const l of this.layers) {
      let n = null, ts = null, err = null;
      if (l.ok) {
        try {
          const env = await l.get(KEY_MAIN);
          if (env) { unwrap(env); n = env.n; ts = env.ts; }
        } catch (e) { err = e.message; }
      }
      per.push({ name: l.name, ok: l.ok, n, ts, err });
    }
    let quota = null;
    try {
      if (navigator.storage?.estimate) {
        const e = await navigator.storage.estimate();
        quota = { usage: e.usage, quota: e.quota };
      }
    } catch {}
    let persisted = null;
    try {
      if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
    } catch {}
    return { ...h, per, quota, persisted, backups: await this.listBackups() };
  }

  // Pede ao navegador que não descarte os dados sob pressão de espaço.
  // Sem isso, o Safari apaga IndexedDB após ~7 dias sem uso.
  async requestPersistence() {
    try {
      if (navigator.storage?.persist) return await navigator.storage.persist();
    } catch {}
    return false;
  }
}

export const store = new Store();
