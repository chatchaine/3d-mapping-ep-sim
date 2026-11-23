// Binary min-heap keyed by time, storing (time, node, src) triples in typed arrays.
// Used by the event-driven propagation engine. Stale entries are discarded lazily
// by the caller (see propagation.js), so there is no decrease-key operation.

export class EventHeap {
  constructor(capacity = 1 << 16) {
    this.t = new Float64Array(capacity);
    this.n = new Int32Array(capacity);
    this.s = new Int32Array(capacity);
    this.size = 0;
  }

  _grow() {
    const cap = this.t.length * 2;
    const t = new Float64Array(cap); t.set(this.t);
    const n = new Int32Array(cap); n.set(this.n);
    const s = new Int32Array(cap); s.set(this.s);
    this.t = t; this.n = n; this.s = s;
  }

  clear() { this.size = 0; }

  push(time, node, src) {
    if (this.size >= this.t.length) this._grow();
    let i = this.size++;
    const T = this.t, N = this.n, S = this.s;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (T[p] <= time) break;
      T[i] = T[p]; N[i] = N[p]; S[i] = S[p];
      i = p;
    }
    T[i] = time; N[i] = node; S[i] = src;
  }

  peekTime() { return this.size ? this.t[0] : Infinity; }

  // Pops the top entry into this.outT/outN/outS.
  pop() {
    const T = this.t, N = this.n, S = this.s;
    this.outT = T[0]; this.outN = N[0]; this.outS = S[0];
    const last = --this.size;
    if (last <= 0) return;
    const lt = T[last], ln = N[last], ls = S[last];
    let i = 0;
    const half = last >> 1;
    while (i < half) {
      let c = 2 * i + 1;
      if (c + 1 < last && T[c + 1] < T[c]) c++;
      if (T[c] >= lt) break;
      T[i] = T[c]; N[i] = N[c]; S[i] = S[c];
      i = c;
    }
    T[i] = lt; N[i] = ln; S[i] = ls;
  }
}
