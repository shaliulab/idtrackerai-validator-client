// MessageConsole.js  —  message console docked at the bottom of the app
//
// Any component can report to it through useConsole():
//   log(level, text)   level: 'info' | 'success' | 'warning' | 'error'
//   trackJob(job)      follow a backend job (see idtrackerai_validator_server/jobs.py)
//                      with one progress bar per item; downloads its result when done.
//                      Returns a promise resolving to the finished job.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from './api';

const POLL_INTERVAL_MS = 500;
const HEIGHT = 180;
export const CONSOLE_HEADER_HEIGHT = 26;

const LEVEL_COLORS = {
  info: null,                // theme text color
  success: '#2ca02c',
  warning: '#ff7f0e',
  error: '#d62728',
};

const ITEM_COLORS = {
  pending: '#7f7f7f',
  running: '#1f77b4',
  done: '#2ca02c',
  skipped: '#ff7f0e',
};

// Two contexts: reporting functions are stable, so components that only report
// do not re-render on every console update; the panel reads the state.
const ConsoleContext = createContext({ log: () => {}, trackJob: async () => null });
const ConsoleStateContext = createContext(null);

export const useConsole = () => useContext(ConsoleContext);
export const useConsoleState = () => useContext(ConsoleStateContext);

// Save a blob response under the filename the server put in Content-Disposition.
export const downloadResponse = (response, fallbackName) => {
  const disposition = response.headers['content-disposition'] || '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = match ? match[1] : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function ConsoleProvider({ children }) {
  const [entries, setEntries] = useState([]);   // {id, time, level, text} | {id, time, job}
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('fh-console-open') !== 'false'; } catch { return true; }
  });
  const nextId = useRef(1);

  useEffect(() => {
    try { localStorage.setItem('fh-console-open', String(open)); } catch { /* ignore */ }
  }, [open]);

  const append = useCallback((entry) => {
    const id = nextId.current++;
    setEntries((list) => [...list.slice(-499), { id, time: new Date(), ...entry }]);
    return id;
  }, []);

  const log = useCallback((level, text) => {
    append({ level, text });
    if (level === 'error') setOpen(true);
  }, [append]);

  const trackJob = useCallback(async (job) => {
    const entryId = append({ job });
    setOpen(true);
    const setJob = (j) => setEntries((list) => list.map((e) => (e.id === entryId ? { ...e, job: j } : e)));

    while (job.status === 'running') {
      await sleep(POLL_INTERVAL_MS);
      try {
        job = unwrap((await api.get(`/api/jobs/${job.id}`)).data);
        setJob(job);
      } catch (err) {
        log('error', `${job.title}: lost track of the job (${err.message})`);
        return job;
      }
    }

    const made = job.items.filter((it) => it.status === 'done').length;
    const skipped = job.items.filter((it) => it.status === 'skipped');
    skipped.forEach((it) => log('warning', `Skipped ${it.name}: ${it.error}`));
    if (job.status === 'failed') {
      log('error', `${job.title} failed: ${job.error}`);
      return job;
    }
    if (job.download) {
      try {
        const response = await api.get(`/api/jobs/${job.id}/download`, { responseType: 'blob' });
        downloadResponse(response, `job_${job.id}`);
        log('success', `${job.title}: downloaded ${made} video${made === 1 ? '' : 's'}`);
      } catch (err) {
        log('error', `${job.title}: download failed (${err.message})`);
      }
    } else if (job.directory) {
      log('success', `${job.title}: saved ${made} video${made === 1 ? '' : 's'} to ${job.directory}`);
    }
    return job;
  }, [append, log]);

  const api_ = useMemo(() => ({ log, trackJob }), [log, trackJob]);
  const state = useMemo(() => ({ entries, setEntries, open, setOpen }), [entries, open]);

  return (
    <ConsoleContext.Provider value={api_}>
      <ConsoleStateContext.Provider value={state}>
        {children}
      </ConsoleStateContext.Provider>
    </ConsoleContext.Provider>
  );
}

const formatTime = (date) => date.toLocaleTimeString([], { hour12: false });

function ProgressBar({ item, theme }) {
  const pct = Math.round(item.progress * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 72 }}>
      <div style={{
        width: 160, height: 8, borderRadius: 4, flexShrink: 0,
        background: theme.border, overflow: 'hidden',
      }}>
        <div style={{
          width: `${item.status === 'skipped' ? 100 : pct}%`, height: '100%',
          background: ITEM_COLORS[item.status], transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ width: 70, color: ITEM_COLORS[item.status] }}>
        {item.status === 'running' ? `${pct}%` : item.status}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
    </div>
  );
}

// The panel itself; rendered inside the app so it can follow the app's theme.
export default function MessageConsole({ theme }) {
  const state = useConsoleState();
  const bodyRef = useRef(null);

  // Keep the newest message in view.
  useEffect(() => {
    if (state?.open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [state?.entries, state?.open]);

  if (!state) return null;
  const { entries, open } = state;
  const running = entries.filter((e) => e.job?.status === 'running').length;

  const headerButton = {
    background: 'none', border: 'none', color: theme.subtext, cursor: 'pointer', fontSize: '0.9em',
  };

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1000,
      background: theme.panelBg, color: theme.text,
      borderTop: `1px solid ${theme.border}`,
      fontFamily: 'monospace', fontSize: 12,
      boxShadow: '0 -2px 6px rgba(0,0,0,0.15)',
    }}>
      <div style={{
        height: CONSOLE_HEADER_HEIGHT, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 12px', borderBottom: open ? `1px solid ${theme.border}` : 'none',
        cursor: 'pointer', userSelect: 'none',
      }} onClick={() => state.setOpen(!open)}>
        <strong>{open ? '▾' : '▸'} Console</strong>
        <span style={{ color: theme.subtext }}>
          {entries.length} message{entries.length === 1 ? '' : 's'}
          {running > 0 && ` · ${running} job${running === 1 ? '' : 's'} running`}
        </span>
        <span style={{ flex: 1 }} />
        <button
          style={headerButton}
          onClick={(e) => {
            e.stopPropagation();
            state.setEntries((list) => list.filter((en) => en.job?.status === 'running'));
          }}
        >
          clear
        </button>
      </div>

      {open && (
        <div ref={bodyRef} style={{ height: HEIGHT, overflowY: 'auto', padding: '4px 12px' }}>
          {entries.length === 0 && <div style={{ color: theme.subtext }}>No messages.</div>}
          {entries.map((entry) => (
            <div key={entry.id} style={{ padding: '1px 0' }}>
              <span style={{ color: theme.subtext }}>{formatTime(entry.time)}&nbsp;&nbsp;</span>
              {entry.job ? (
                <>
                  <span style={{ color: entry.job.status === 'failed' ? LEVEL_COLORS.error : theme.text }}>
                    {entry.job.title}
                    {' — '}
                    {entry.job.status === 'running'
                      ? `${entry.job.items.filter((it) => it.status === 'done' || it.status === 'skipped').length}/${entry.job.items.length}`
                      : entry.job.status}
                  </span>
                  {entry.job.items.map((item) => <ProgressBar key={item.name} item={item} theme={theme} />)}
                </>
              ) : (
                <span style={{ color: LEVEL_COLORS[entry.level] || theme.text }}>{entry.text}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Space the page must leave at the bottom so the console does not hide content.
export const consoleHeight = (open) => CONSOLE_HEADER_HEIGHT + (open ? HEIGHT + 9 : 0);
