// OverviewTab.js  —  dashboard of every experiment in $FLYHOSTEL_VIDEOS/index.txt
//
// Fetches /api/overview once (when the tab is first shown) and does all counting
// client side. Rows are flies (from each experiment's ethoscope_metadata), each
// carrying its experiment's path-derived fields, so one filter works on both
// levels: "genotype = X" keeps the flies of genotype X, and the experiments with
// at least one such fly. Clicking a bar toggles a filter on that value; each
// chart ignores its own filter so the other values of that property stay visible.
// The "Find experiments" panel (QueryPanel) adds a genotype / cohoused genotype /
// date range query applied before those filters.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';

const MISSING = '(missing)';
const TOP_N = 12;

// Experiment-level properties, derived from the path or the database itself.
const EXPERIMENT_PROPS = {
  group_size: 'Group size',
  flyhostel: 'FlyHostel',
  month: 'Month',
  year: 'Year',
  has_val: 'Validated tables (_VAL)',
};

const LABELS = {
  ...EXPERIMENT_PROPS,
  genotype: 'Genotype',
  cohoused_with: 'Cohoused with (other genotypes)',
  sex: 'Sex',
  number_of_animals: 'Number of animals (metadata)',
  age_min: 'Age min (days)',
  age_max: 'Age max (days)',
  agar_age: 'Agar age (days)',
  reference_hour: 'Reference hour (ZT0)',
  light_cycle: 'Light cycle (merged)',
  light_cycle_source: 'Light cycle recorded in',
  machine_name: 'Ethoscope',
  node: 'Tracking node',
  region_id: 'Region id',
  fly_no: 'Fly no.',
};
const labelOf = (prop) => LABELS[prop] || prop.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Fly-level properties computed here from the other flies of the experiment.
const DERIVED_PROPS = ['cohoused_with'];
const ALONE = '(alone)';
const SAME_ONLY = '(same genotype only)';

const DEFAULT_CHARTS = ['genotype', 'cohoused_with', 'group_size', 'sex', 'flyhostel', 'month', 'light_cycle',
  'light_cycle_source', 'incubator', 'vial', 'age_min', 'has_val'];

const loadStored = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
};
const store = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
};

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const isNumeric = (v) => v !== MISSING && v !== '' && !Number.isNaN(Number(v));

// Values sorted numerically when they all are numbers (group size, ages), else by count.
function sortEntries(entries) {
  const present = entries.filter(([v]) => v !== MISSING);
  const missing = entries.filter(([v]) => v === MISSING);
  if (present.length && present.every(([v]) => isNumeric(v))) {
    present.sort((a, b) => Number(a[0]) - Number(b[0]));
  } else if (present.length && present.every(([v]) => /^\d{4}(-\d{2})?$/.test(v))) {
    present.sort((a, b) => a[0].localeCompare(b[0]));     // months, years: chronological
  } else {
    present.sort((a, b) => b[1].experiments - a[1].experiments || b[1].flies - a[1].flies);
  }
  return [...present, ...missing];
}

// Flat fly rows. An experiment without metadata still gets one row (noFly) so it
// is counted as an experiment, but never as a fly.
function buildRows(experiments) {
  const rows = [];
  for (const e of experiments) {
    const base = {
      _exp: e,
      group_size: e.group_size != null ? String(e.group_size) : undefined,
      flyhostel: e.flyhostel ?? undefined,
      month: e.date ? e.date.slice(0, 7) : undefined,
      year: e.date ? e.date.slice(0, 4) : undefined,
      has_val: e.has_val ? 'yes' : 'no',
    };
    // _others: genotypes of the other flies of the experiment (missing ones left out).
    // cohoused_with: those different from the fly's own, or ALONE / SAME_ONLY.
    e.flies.forEach((fly, i) => {
      const others = e.flies.filter((_, j) => j !== i).map((f) => f.genotype).filter(Boolean);
      const different = [...new Set(others)].filter((g) => g !== fly.genotype).sort();
      const cohousedWith = different.length ? different.join(' + ')
        : e.flies.length === 1 ? ALONE : fly.genotype && others.length ? SAME_ONLY : undefined;
      rows.push({ ...fly, ...base, cohoused_with: cohousedWith, _others: others });
    });
    if (!e.flies.length) rows.push({ ...base, _noFly: true, _others: [] });
  }
  return rows;
}

const valueOf = (row, prop) => row[prop] ?? MISSING;

function countBy(rows, prop) {
  const groups = new Map();      // value -> { experiments: Set, flies }
  for (const row of rows) {
    const v = valueOf(row, prop);
    if (row._noFly && !(prop in EXPERIMENT_PROPS)) continue;   // no fly metadata to count
    let g = groups.get(v);
    if (!g) { g = { exps: new Set(), flies: 0 }; groups.set(v, g); }
    g.exps.add(row._exp.experiment);
    if (!row._noFly) g.flies += 1;
  }
  return [...groups].map(([v, g]) => [v, { experiments: g.exps.size, flies: g.flies }]);
}

function applyFilters(rows, filters, except) {
  const active = Object.entries(filters).filter(([p, set]) => p !== except && set.length);
  if (!active.length) return rows;
  return rows.filter((row) => active.every(([p, set]) => set.includes(valueOf(row, p))));
}

// The "Find experiments" query: flies of `genotype` (any if empty) whose experiment
// has another fly of `cohoused` (any if empty; SAME_ONLY = no other genotype), in
// experiments recorded between `from` and `to` (inclusive, YYYY-MM-DD).
const EMPTY_QUERY = { genotype: '', cohoused: '', from: '', to: '' };
const queryActive = (q) => Object.values(q).some(Boolean);

function applyQuery(rows, q) {
  if (!queryActive(q)) return rows;
  return rows.filter((row) => {
    const date = row._exp.date;
    if ((q.from || q.to) && !date) return false;
    if (q.from && date < q.from) return false;
    if (q.to && date > q.to) return false;
    if ((q.genotype || q.cohoused) && row._noFly) return false;
    if (q.genotype && row.genotype !== q.genotype) return false;
    if (q.cohoused === SAME_ONLY) return row._others.length > 0 && row._others.every((g) => g === row.genotype);
    if (q.cohoused && !row._others.includes(q.cohoused)) return false;
    return true;
  });
}

// Genotypes with their number of experiments, the most frequent first.
function genotypeOptions(rows) {
  const exps = new Map();
  for (const r of rows) {
    if (!r.genotype) continue;
    if (!exps.has(r.genotype)) exps.set(r.genotype, new Set());
    exps.get(r.genotype).add(r._exp.experiment);
  }
  return [...exps].map(([g, s]) => [g, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function QueryPanel({ rows, query, setQuery, stats, dateRange }) {
  const set = (key) => (e) => setQuery((q) => ({ ...q, [key]: e.target.value }));
  // Choices of each select narrowed by the other conditions, so every option yields results.
  const genotypes = useMemo(() => genotypeOptions(applyQuery(rows, { ...query, genotype: '' })), [rows, query]);
  const companions = useMemo(() => {
    const base = applyQuery(rows, { ...query, cohoused: '' });
    const exps = new Map();
    for (const r of base) {
      for (const g of new Set(r._others)) {
        if (!exps.has(g)) exps.set(g, new Set());
        exps.get(g).add(r._exp.experiment);
      }
    }
    return [...exps].map(([g, s]) => [g, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows, query]);
  const keep = (options, value) => (value && !options.some(([g]) => g === value) ? [...options, [value, 0]] : options);

  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const parts = [];
  if (query.genotype) parts.push(<> with a <b>{query.genotype}</b> fly</>);
  if (query.cohoused === SAME_ONLY) parts.push(<> housed only with its own genotype</>);
  else if (query.cohoused) parts.push(<> {query.genotype ? 'living with' : 'with a fly living with'} <b>{query.cohoused}</b></>);
  if (query.from || query.to) parts.push(<> recorded {query.from ? `from ${query.from}` : ''} {query.to ? `to ${query.to}` : ''}</>);

  return (
    <div className="card ov-query toolbar">
      <span className="ov-query-title">Find experiments</span>
      <label className="field">
        Genotype
        <select value={query.genotype} onChange={set('genotype')}>
          <option value="">any</option>
          {keep(genotypes, query.genotype).map(([g, c]) => <option key={g} value={g}>{g} ({c})</option>)}
        </select>
      </label>
      <label className="field">
        living with
        <select value={query.cohoused} onChange={set('cohoused')}
                title="Genotype of at least one other fly of the same experiment">
          <option value="">anyone</option>
          <option value={SAME_ONLY}>only its own genotype</option>
          {keep(companions, query.cohoused).map(([g, c]) => <option key={g} value={g}>{g} ({c})</option>)}
        </select>
      </label>
      <label className="field">
        Recorded from
        <input type="date" value={query.from} min={dateRange.first} max={dateRange.last}
               onChange={set('from')} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <label className="field">
        to
        <input type="date" value={query.to} min={dateRange.first} max={dateRange.last}
               onChange={set('to')} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      {queryActive(query) && <button className="ov-link" onClick={() => setQuery(EMPTY_QUERY)}>Clear</button>}
      {queryActive(query) && (
        <div className="ov-query-result">
          <b className="ov-query-n">{n(stats.experiments, 'experiment', 'experiments')}</b>
          {parts}
          {' · '}{n(stats.flies, 'matching fly', 'matching flies')}
          <span className="ov-query-hint"> — every chart and the table below are restricted to them</span>
        </div>
      )}
    </div>
  );
}

const summarize = (rows) => {
  const exps = new Set();
  const genotypes = new Set();
  const hostels = new Set();
  let flies = 0;
  const validated = new Set();
  let first = null;
  let last = null;
  for (const r of rows) {
    const e = r._exp;
    exps.add(e.experiment);
    if (!r._noFly) flies += 1;
    if (r.genotype) genotypes.add(r.genotype);
    if (e.flyhostel) hostels.add(e.flyhostel);
    if (e.has_val) validated.add(e.experiment);
    if (e.date) {
      if (!first || e.date < first) first = e.date;
      if (!last || e.date > last) last = e.date;
    }
  }
  return { experiments: exps.size, flies, genotypes: genotypes.size, hostels: hostels.size,
    validated: validated.size, first, last };
};

function Stat({ label, value, sub }) {
  return (
    <div className="card ov-stat">
      <div className="ov-stat-label">{label}</div>
      <div className="ov-stat-value">{value}</div>
      {sub && <div className="ov-stat-sub">{sub}</div>}
    </div>
  );
}

function BarChart({ prop, rows, unit, selected, onToggle, onRemove }) {
  const [showAll, setShowAll] = useState(false);
  const entries = useMemo(() => sortEntries(countBy(rows, prop)), [rows, prop]);
  const max = Math.max(1, ...entries.map(([, c]) => c[unit]));
  const shown = showAll ? entries : entries.slice(0, TOP_N);
  const filtering = selected.length > 0;
  const total = entries.reduce((s, [, c]) => s + c[unit], 0);

  return (
    <section className="card ov-chart">
      <header className="card-header">
        <span title={prop}>{labelOf(prop)}</span>
        <span className="ov-count">{entries.filter(([v]) => v !== MISSING).length} values</span>
        <span className="spacer" />
        <button className="ov-x" title="Remove this chart" onClick={onRemove}>×</button>
      </header>
      <div className="card-body ov-bars">
        {shown.map(([value, c]) => {
          const n = c[unit];
          const on = selected.includes(value);
          return (
            <button
              key={value}
              className={`ov-bar-row${on ? ' on' : ''}${filtering && !on ? ' dim' : ''}${value === MISSING ? ' missing' : ''}`}
              onClick={() => onToggle(prop, value)}
              title={`${labelOf(prop)} = ${value}\n${c.experiments} experiment${c.experiments === 1 ? '' : 's'} · ${c.flies} fl${c.flies === 1 ? 'y' : 'ies'}\n${total ? Math.round((100 * n) / total) : 0}% of ${unit}\nClick to ${on ? 'remove' : 'add'} this filter`}
            >
              <span className="ov-bar-label">{value}</span>
              <span className="ov-bar-track">
                <span className="ov-bar" style={{ width: `${(100 * n) / max}%` }} />
                <span className="ov-bar-value">{n}</span>
              </span>
            </button>
          );
        })}
        {!entries.length && <div className="ov-empty">No data</div>}
      </div>
      {entries.length > TOP_N && (
        <button className="ov-more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show top 12' : `Show all ${entries.length}`}
        </button>
      )}
    </section>
  );
}

function CrossTab({ rows, unit, rowProp, colProp, props, setRowProp, setColProp }) {
  const { rowValues, colValues, cells, max } = useMemo(() => {
    const cellMap = new Map();
    const rowTot = new Map();
    const colTot = new Map();
    const relevant = rows.filter((r) => !r._noFly || ((rowProp in EXPERIMENT_PROPS) && (colProp in EXPERIMENT_PROPS)));
    for (const r of relevant) {
      const a = valueOf(r, rowProp);
      const b = valueOf(r, colProp);
      const key = `${a}\u0000${b}`;
      let cell = cellMap.get(key);
      if (!cell) { cell = { exps: new Set(), flies: 0 }; cellMap.set(key, cell); }
      cell.exps.add(r._exp.experiment);
      if (!r._noFly) cell.flies += 1;
    }
    const n = (cell) => (unit === 'flies' ? cell.flies : cell.exps.size);
    let maxN = 1;
    for (const [key, cell] of cellMap) {
      const [a, b] = key.split('\u0000');
      rowTot.set(a, (rowTot.get(a) || 0) + n(cell));
      colTot.set(b, (colTot.get(b) || 0) + n(cell));
      maxN = Math.max(maxN, n(cell));
    }
    const order = (tot) => sortEntries([...tot].map(([v, t]) => [v, { experiments: t, flies: t }]))
      .map(([v]) => v).slice(0, 20);
    return {
      rowValues: order(rowTot),
      colValues: order(colTot),
      cells: (a, b) => { const c = cellMap.get(`${a}\u0000${b}`); return c ? n(c) : 0; },
      max: maxN,
    };
  }, [rows, rowProp, colProp, unit]);

  const select = (value, onChange) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {props.map((p) => <option key={p} value={p}>{labelOf(p)}</option>)}
    </select>
  );

  return (
    <section className="card ov-crosstab">
      <header className="card-header">
        <span>Cross-tabulation</span>
        <span className="spacer" />
        <label className="field ov-normal">Rows {select(rowProp, setRowProp)}</label>
        <label className="field ov-normal">Columns {select(colProp, setColProp)}</label>
        <button title="Swap rows and columns" onClick={() => { setRowProp(colProp); setColProp(rowProp); }}>⇄</button>
      </header>
      <div className="card-body ov-scroll">
        <table className="ov-heat">
          <thead>
            <tr>
              <th className="ov-corner">{labelOf(rowProp)} \ {labelOf(colProp)}</th>
              {colValues.map((b) => <th key={b} className="ov-colhead" title={b}>{b}</th>)}
            </tr>
          </thead>
          <tbody>
            {rowValues.map((a) => (
              <tr key={a}>
                <th>{a}</th>
                {colValues.map((b) => {
                  const n = cells(a, b);
                  const t = n / max;
                  return (
                    <td key={b}
                        title={`${labelOf(rowProp)} = ${a}\n${labelOf(colProp)} = ${b}\n${n} ${unit}`}
                        style={n ? { background: `color-mix(in oklab, var(--ov-seq-hi) ${Math.round(15 + 85 * t)}%, var(--ov-seq-lo))`,
                                     color: t > 0.55 ? 'var(--ov-seq-ink-hi)' : 'var(--text)' } : undefined}>
                      {n || ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {(rowValues.length >= 20 || colValues.length >= 20) && (
          <div className="ov-empty">Showing the 20 largest values on each axis.</div>
        )}
      </div>
    </section>
  );
}

const TABLE_COLUMNS = [
  ['experiment', 'Experiment'],
  ['date', 'Date'],
  ['group_size', 'Group'],
  ['genotypes', 'Genotypes'],
  ['sexes', 'Sex'],
  ['duration_h', 'Duration (h)'],
  ['light_cycle', 'Light cycle'],
  ['has_val', 'Validated'],
];

// Experiments whose light cycle is not (only) in the `light_cycle` column; the
// server merges it (overview.py, merge_light_cycle) and says how in light_cycle_flags.
function LightCycleIssues({ rows, onOpen }) {
  const flagged = useMemo(() => {
    const seen = new Map();
    for (const r of rows) {
      const e = r._exp;
      if (e.light_cycle_flags?.length && !seen.has(e.experiment)) {
        const cycles = new Set(e.flies.map((f) => f.light_cycle).filter(Boolean));
        seen.set(e.experiment, { ...e, cycles: [...cycles].join(', ') });
      }
    }
    return [...seen.values()].sort((a, b) => a.experiment.localeCompare(b.experiment));
  }, [rows]);

  const download = () => {
    const lines = ['experiment,light_cycle,flags',
      ...flagged.map((e) => [e.experiment, e.cycles, e.light_cycle_flags.join('; ')].map(csvCell).join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flyhostel_light_cycle_flags.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!flagged.length) return null;
  return (
    <details className="card ov-issues">
      <summary className="card-header">
        <span className="ov-warn">⚠</span>
        <span>Non-standard light cycle encoding</span>
        <span className="ov-count">{flagged.length} experiment{flagged.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <button className="ov-normal" onClick={(e) => { e.preventDefault(); download(); }}
                title="Download this list as CSV">
          <i className="fa fa-download" style={{ marginRight: 6 }} />CSV
        </button>
      </summary>
      <p className="ov-note">
        The light cycle of these experiments is not (only) in <code>light_cycle</code>. The dashboard
        merges it into <i>Light cycle (merged)</i>; the databases are unchanged.
      </p>
      <div className="ov-scroll ov-issues-scroll">
        <table className="pe-table ov-table">
          <thead><tr><th>Experiment</th><th>Light cycle</th><th>Issue</th><th /></tr></thead>
          <tbody>
            {flagged.map((e) => (
              <tr key={e.experiment}>
                <td className="mono">{e.experiment}</td>
                <td>{e.cycles}</td>
                <td className="ov-wrap">{e.light_cycle_flags.join('; ')}</td>
                <td><button onClick={() => onOpen(e.experiment)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// SELECTED_EXPERIMENT may be in underscore form (VALIDATOR_EXPERIMENT allows both).
const sameExperiment = (a, b) => !!a && !!b && a.replace(/\//g, '_') === b.replace(/\//g, '_');

function ExperimentTable({ rows, onOpen, current }) {
  const [sort, setSort] = useState({ key: 'date', desc: true });
  const experiments = useMemo(() => {
    const byExp = new Map();
    for (const r of rows) {
      const e = r._exp;
      let x = byExp.get(e.experiment);
      if (!x) {
        x = { ...e, genotypes: new Set(), sexes: new Set(), cycles: new Set(), matching: 0 };
        byExp.set(e.experiment, x);
      }
      if (!r._noFly) x.matching += 1;
      if (r.genotype) x.genotypes.add(r.genotype);
      if (r.sex) x.sexes.add(r.sex);
      if (r.light_cycle) x.cycles.add(r.light_cycle);
    }
    const list = [...byExp.values()].map((x) => ({
      ...x, genotypes: [...x.genotypes].join(', '), sexes: [...x.sexes].join(', '),
      light_cycle: [...x.cycles].join(', '),
    }));
    const { key, desc } = sort;
    list.sort((a, b) => {
      const va = a[key]; const vb = b[key];
      const c = (typeof va === 'number' || typeof va === 'boolean')
        ? (va ?? -1) - (vb ?? -1)
        : String(va ?? '').localeCompare(String(vb ?? ''));
      return desc ? -c : c;
    });
    return list;
  }, [rows, sort]);

  const header = (key, label) => (
    <th key={key} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === 'date' }))}>
      {label}{sort.key === key ? (sort.desc ? ' ▼' : ' ▲') : ''}
    </th>
  );

  return (
    <section className="card ov-table-card">
      <header className="card-header">
        <span>Experiments</span>
        <span className="ov-count">{experiments.length}</span>
      </header>
      <div className="ov-scroll ov-table-scroll">
        <table className="pe-table ov-table">
          <thead>
            <tr>{TABLE_COLUMNS.map(([k, l]) => header(k, l))}<th /></tr>
          </thead>
          <tbody>
            {experiments.map((e) => (
              <tr key={e.experiment} className={sameExperiment(e.experiment, current) ? 'selected' : undefined}
                  title={e.error ? `Could not read: ${e.error}` : undefined}>
                <td className="mono">{e.experiment}{e.error && <span className="ov-warn"> ⚠</span>}</td>
                <td>{e.date} {e.start_time?.slice(0, 5)}</td>
                <td>{e.group_size}X{e.flies.length > 0 && e.matching !== e.flies.length ? ` (${e.matching} match)` : ''}</td>
                <td className="ov-wrap">{e.genotypes}</td>
                <td>{e.sexes}</td>
                <td>{e.duration_h ?? ''}</td>
                <td title={e.light_cycle_flags?.length ? `Non-standard encoding: ${e.light_cycle_flags.join('; ')}` : undefined}>
                  {e.light_cycle}{e.light_cycle_flags?.length > 0 && <span className="ov-warn"> ⚠</span>}
                </td>
                <td>{e.has_val ? '✓' : ''}</td>
                <td>
                  <button disabled={!!e.error || sameExperiment(e.experiment, current)} onClick={() => onOpen(e.experiment)}
                          title="Load this experiment and open it in the Group viewer">
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function downloadCsv(rows, columns) {
  const header = ['experiment', 'flyhostel', 'group_size', 'date', 'start_time', 'duration_h', 'has_val', ...columns];
  const lines = [header.join(',')];
  for (const r of rows) {
    if (r._noFly) continue;
    const e = r._exp;
    lines.push([e.experiment, e.flyhostel, e.group_size, e.date, e.start_time, e.duration_h, e.has_val,
      ...columns.map((c) => r[c])].map(csvCell).join(','));
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'flyhostel_flies.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function OverviewTab({ active, currentExperiment, onOpenExperiment }) {
  const { log } = useConsole();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [unit, setUnit] = useState(() => loadStored('fh-overview-unit', 'experiments'));
  const [charts, setCharts] = useState(() => loadStored('fh-overview-charts', DEFAULT_CHARTS));
  const [filters, setFilters] = useState({});      // prop -> [values]
  const [search, setSearch] = useState('');
  const [rowProp, setRowProp] = useState(() => loadStored('fh-overview-rows', 'genotype'));
  const [colProp, setColProp] = useState(() => loadStored('fh-overview-cols', 'group_size'));
  const [query, setQuery] = useState(() => ({ ...EMPTY_QUERY, ...loadStored('fh-overview-query', {}) }));

  useEffect(() => store('fh-overview-unit', unit), [unit]);
  useEffect(() => store('fh-overview-charts', charts), [charts]);
  useEffect(() => store('fh-overview-rows', rowProp), [rowProp]);
  useEffect(() => store('fh-overview-cols', colProp), [colProp]);
  useEffect(() => store('fh-overview-query', query), [query]);

  const fetchData = useCallback((refresh = false) => {
    setLoading(true);
    setError(null);
    api.get(`/api/overview${refresh ? '?refresh=1' : ''}`)
      .then((r) => {
        const d = unwrap(r.data);
        setData(d);
        const broken = d.experiments.filter((e) => e.error).length;
        if (broken) log('warning', `Overview: ${broken} experiment(s) in index.txt could not be read`);
      })
      .catch((err) => {
        const msg = err.response?.data?.error || err.message;
        setError(msg);
        log('error', `Could not load the overview: ${msg}`);
      })
      .finally(() => setLoading(false));
  }, [log]);

  // Scanning every database takes a few seconds: only when the tab is first opened.
  useEffect(() => {
    if (active && !data && !loading && !error) fetchData();
  }, [active, data, loading, error, fetchData]);

  const allRows = useMemo(() => (data ? buildRows(data.experiments) : []), [data]);
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => r._exp.experiment.toLowerCase().includes(q)
      || Object.entries(r).some(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.toLowerCase().includes(q)));
  }, [allRows, search]);
  const queried = useMemo(() => applyQuery(searched, query), [searched, query]);
  const unqueried = useMemo(() => applyFilters(searched, filters), [searched, filters]);
  const filtered = useMemo(() => applyFilters(queried, filters), [queried, filters]);
  const stats = useMemo(() => summarize(filtered), [filtered]);
  const totals = useMemo(() => summarize(allRows), [allRows]);

  const flyColumns = useMemo(() => (data ? data.fly_columns : []), [data]);
  const allProps = useMemo(
    () => [...Object.keys(EXPERIMENT_PROPS), ...DERIVED_PROPS, ...flyColumns.map((c) => c.name)],
    [flyColumns],
  );
  const coverage = useMemo(() => Object.fromEntries(flyColumns.map((c) => [c.name, c.count])), [flyColumns]);

  const toggle = useCallback((prop, value) => {
    setFilters((f) => {
      const cur = f[prop] || [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      const out = { ...f, [prop]: next };
      if (!next.length) delete out[prop];
      return out;
    });
  }, []);

  const activeFilters = Object.entries(filters);
  const available = allProps.filter((p) => !charts.includes(p));
  const of = (n, total) => (n === total ? undefined : `of ${total}`);

  if (!data) {
    return (
      <div className="ov-loading">
        {error ? <>Could not load the overview: {error} <button onClick={() => fetchData()}>Retry</button></>
               : 'Reading the metadata of every experiment…'}
      </div>
    );
  }

  return (
    <div className="ov">
      <div className="card ov-controls toolbar">
        <label className="field">
          <i className="fa fa-search" />
          <input type="text" placeholder="Search experiments / metadata" value={search}
                 onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
                 style={{ width: 240 }} />
        </label>
        <span className="field">
          Count
          <span className="ov-seg">
            {['experiments', 'flies'].map((u) => (
              <button key={u} className={unit === u ? 'on' : ''} onClick={() => setUnit(u)}>{u}</button>
            ))}
          </span>
        </span>
        <label className="field">
          Add chart
          <select value="" onChange={(e) => e.target.value && setCharts((c) => [...c, e.target.value])}>
            <option value="">choose a property…</option>
            {available.map((p) => (
              <option key={p} value={p}>
                {labelOf(p)}{coverage[p] != null ? ` — ${Math.round((100 * coverage[p]) / data.n_flies)}% of flies` : ''}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setCharts(DEFAULT_CHARTS)} title="Back to the default set of charts">Reset charts</button>
        <span className="spacer" style={{ flex: 1 }} />
        <button onClick={() => downloadCsv(filtered, [...DERIVED_PROPS, ...flyColumns.map((c) => c.name)])}
                title="One row per fly matching the current filters, with every metadata column">
          <i className="fa fa-download" style={{ marginRight: 6 }} />CSV
        </button>
        <button onClick={() => fetchData(true)} disabled={loading} title="Re-read every database">
          <i className={`fa fa-refresh${loading ? ' fa-spin' : ''}`} style={{ marginRight: 6 }} />Refresh
        </button>

        {activeFilters.length > 0 && (
          <div className="ov-filters">
            {activeFilters.map(([prop, values]) => values.map((v) => (
              <button key={`${prop}=${v}`} className="chip ov-filter" onClick={() => toggle(prop, v)} title="Remove this filter">
                {labelOf(prop)} = <b>{v}</b> ×
              </button>
            )))}
            <button className="ov-link" onClick={() => setFilters({})}>Clear all</button>
          </div>
        )}
      </div>

      <QueryPanel rows={unqueried}
                  query={query} setQuery={setQuery} stats={stats} dateRange={totals} />

      <div className="ov-stats">
        <Stat label="Experiments" value={stats.experiments} sub={of(stats.experiments, totals.experiments)} />
        <Stat label="Flies" value={stats.flies} sub={of(stats.flies, totals.flies)} />
        <Stat label="Genotypes" value={stats.genotypes} sub={of(stats.genotypes, totals.genotypes)} />
        <Stat label="FlyHostels" value={stats.hostels} />
        <Stat label="Validated (_VAL)" value={stats.validated}
              sub={stats.experiments ? `${Math.round((100 * stats.validated) / stats.experiments)}% of experiments` : undefined} />
        <Stat label="Recorded" value={stats.first ? `${stats.first.slice(0, 7)} → ${stats.last.slice(0, 7)}` : '—'} />
      </div>

      <div className="ov-grid">
        {charts.map((prop) => (
          <BarChart
            key={prop}
            prop={prop}
            rows={applyFilters(queried, filters, prop)}
            unit={unit}
            selected={filters[prop] || []}
            onToggle={toggle}
            onRemove={() => setCharts((c) => c.filter((p) => p !== prop))}
          />
        ))}
      </div>

      <CrossTab rows={filtered} unit={unit} rowProp={rowProp} colProp={colProp} props={allProps}
                setRowProp={setRowProp} setColProp={setColProp} />

      <LightCycleIssues rows={filtered} onOpen={onOpenExperiment} />

      <ExperimentTable rows={filtered} onOpen={onOpenExperiment} current={currentExperiment} />
    </div>
  );
}
