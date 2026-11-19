/** Tiny builder for CPLEX LP-format models (the format HiGHS reads). */

export type Terms = Map<string, number>;

export function terms(...parts: Array<Array<[string, number]> | Terms>): Terms {
  const out: Terms = new Map();
  for (const part of parts) for (const [k, v] of part) out.set(k, (out.get(k) ?? 0) + v);
  return out;
}

export function scale(t: Terms | Array<[string, number]>, k: number): Terms {
  const out: Terms = new Map();
  for (const [name, v] of t) out.set(name, v * k);
  return out;
}

export class LpModel {
  private bin = new Set<string>();
  private bounds = new Map<string, [number, number]>();
  private rows: string[] = [];
  private objective: Terms = new Map();
  /** A variable fixed at 0: lets us write rows that are trivially (in)feasible. */
  static readonly NEVER = 'never';

  constructor() {
    this.bounds.set(LpModel.NEVER, [0, 0]);
  }

  binary(name: string): string {
    this.bin.add(name);
    return name;
  }

  continuous(name: string, lo = 0, hi = Infinity): string {
    this.bounds.set(name, [lo, hi]);
    return name;
  }

  has(name: string): boolean {
    return this.bin.has(name) || this.bounds.has(name);
  }

  cost(name: string, coef: number) {
    if (coef) this.objective.set(name, (this.objective.get(name) ?? 0) + coef);
  }

  row(t: Terms | Array<[string, number]>, sense: '<=' | '>=' | '=', rhs: number) {
    const entries = [...t].filter(([, v]) => Math.abs(v) > 1e-12);
    if (!entries.length) entries.push([LpModel.NEVER, 1]);
    this.rows.push(`r${this.rows.length}: ${fmt(entries)} ${sense} ${num(rhs)}`);
  }

  get rowCount() {
    return this.rows.length;
  }

  toString(): string {
    const obj = [...this.objective].filter(([, v]) => Math.abs(v) > 1e-12);
    if (!obj.length) obj.push([LpModel.NEVER, 0]);
    const lines = ['Minimize', ` obj: ${fmt(obj)}`, 'Subject To', ...this.rows.map((r) => ' ' + r), 'Bounds'];
    for (const [name, [lo, hi]] of this.bounds)
      lines.push(hi === Infinity ? ` ${name} >= ${num(lo)}` : ` ${num(lo)} <= ${name} <= ${num(hi)}`);
    if (this.bin.size) lines.push('Binary', ...chunk([...this.bin], 12).map((c) => ' ' + c.join(' ')));
    lines.push('End');
    return lines.join('\n');
  }
}

function num(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toPrecision(12).replace(/0+$/, '').replace(/\.$/, '');
}

function fmt(entries: Array<[string, number]>): string {
  const parts = entries.map(([name, v], i) => {
    const sign = v < 0 ? '-' : i === 0 ? '' : '+';
    return `${sign} ${num(Math.abs(v))} ${name}`.trim();
  });
  return chunk(parts, 10)
    .map((c) => c.join(' '))
    .join('\n   ');
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
