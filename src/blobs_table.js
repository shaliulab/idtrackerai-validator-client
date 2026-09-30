import './TableStyles.css';
import { useState, useMemo } from 'react';

// Column definitions: key used only for React keys; w = width in px
const COLUMNS = [
  { key: 'frame',    label: 'Frame #',   w: 82  },
  { key: 'chunk',    label: 'Chunk',     w: 54  },
  { key: 'fidx',     label: 'Frm idx',   w: 54  },
  { key: 'x',        label: 'X',         w: 42  },
  { key: 'y',        label: 'Y',         w: 42  },
  { key: 'identity', label: 'Id',        w: 42  },
  { key: 'sex',      label: 'Sex',       w: 36  },
  { key: 'genotype', label: 'Genotype',  w: 110 },
  { key: 'local_id', label: 'Loc Id',    w: 50  },
  { key: 'in_frame', label: 'InFrm',     w: 50  },
  { key: 'fragment', label: 'Frag',      w: 50  },
  { key: 'area',     label: 'Area',      w: 46  },
  { key: 'yolo',     label: 'YOLO',      w: 46  },
  { key: 'zt',       label: 'ZT',        w: 70  },
];

// Cell that truncates overflow and shows full value in native tooltip on hover
const TC = ({ value, title }) => {
  const display = value ?? '—';
  const tip = title ?? (value != null ? String(value) : '');
  return <td title={tip}>{display}</td>;
};

const BlobsTable = ({ Data, setFrameNumber, number_of_animals, animalMetadata = {} }) => {
  const [draft, setDraft] = useState('');
  const [editingRow, setEditingRow] = useState(null);

  const [chunkDraft, setChunkDraft] = useState('');
  const [editingChunkRow, setEditingChunkRow] = useState(null);

  const commit = (val) => {
    const n = parseInt(val, 10);
    if (Number.isFinite(n) && n >= 0 && setFrameNumber) setFrameNumber(n);
    setEditingRow(null);
  };

  const commitChunk = (val, chunksize) => {
    const chunk = parseInt(val, 10);
    const cs = Number(chunksize);
    if (Number.isFinite(chunk) && chunk >= 0 && Number.isFinite(cs) && cs > 0 && setFrameNumber) {
      setFrameNumber(chunk * cs);
    }
    setEditingChunkRow(null);
  };

  const rows = useMemo(() => {
    const n = Math.max(Number(number_of_animals) || 0, Data.length);
    const padded = Data.slice(0, n);
    while (padded.length < n) padded.push(null);
    return padded;
  }, [Data, number_of_animals]);

  return (
    <table className="data-table">
      <colgroup>
        {COLUMNS.map(c => <col key={c.key} style={{ width: c.w }} />)}
      </colgroup>
      <thead>
        <tr>
          {COLUMNS.map(c => <th key={c.key} title={c.label}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          if (!row) {
            return (
              <tr key={`pad-${index}`} style={{ visibility: 'hidden' }}>
                <td><input type="number" readOnly value="" /></td>
                <td><input type="number" readOnly value="" /></td>
                {COLUMNS.slice(2).map(c => <td key={c.key}>&nbsp;</td>)}
              </tr>
            );
          }

          const meta = animalMetadata[String(row.identity)] ?? {};

          return (
            <tr key={`row-${index}`}>
              {/* Frame Number — editable, navigates to that frame */}
              <td>
                <input
                  type="number"
                  value={editingRow === index ? draft : (row.frame_number ?? '')}
                  onFocus={() => { setEditingRow(index); setDraft(String(row.frame_number ?? '')); }}
                  onChange={e => setDraft(e.target.value)}
                  onBlur={() => commit(draft)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.target.blur();
                    else if (e.key === 'Escape') setEditingRow(null);
                  }}
                  onWheel={e => e.target.blur()}
                />
              </td>

              {/* Chunk — editable, jumps to chunk * chunksize */}
              <td>
                <input
                  type="number"
                  value={editingChunkRow === index ? chunkDraft : Math.floor(row.frame_number / row.chunksize)}
                  onFocus={() => { setEditingChunkRow(index); setChunkDraft(String(Math.floor(row.frame_number / row.chunksize))); }}
                  onChange={e => setChunkDraft(e.target.value)}
                  onBlur={() => commitChunk(chunkDraft, row.chunksize)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.target.blur();
                    else if (e.key === 'Escape') setEditingChunkRow(null);
                  }}
                  onWheel={e => e.target.blur()}
                />
              </td>

              <TC value={row.frame_number % row.chunksize} />
              <TC value={row.x} />
              <TC value={row.y} />
              <TC value={row.identity} />
              <TC value={meta.sex || '—'} />
              <TC value={meta.genotype || '—'} title={meta.genotype || ''} />
              <TC value={row.local_identity} />
              <TC value={row.in_frame_index} />
              <TC value={row.fragment} />
              <TC value={row.area} />
              <TC value={row.modified?.toString()} />
              <TC value={row.ZT} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export { BlobsTable };
