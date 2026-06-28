import { useState } from 'react';
import './TableStyles.css';

const BlobsTable = ({ Data, setFrameNumber }) => {
  // ↓ All hooks and helpers go INSIDE this function
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
    const cs = Number(chunksize);  // coerce string -> number
    if (Number.isFinite(chunk) && chunk >= 0 && Number.isFinite(cs) && cs > 0 && setFrameNumber) {
      setFrameNumber(chunk * cs);
    }
    setEditingChunkRow(null);
  };

  const cellInputStyle = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    textAlign: 'center',
    font: 'inherit',
    color: 'inherit',
    outline: 'none',
    padding: 0,
    MozAppearance: 'textfield',
  };

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Frame Number</th>
          <th>Chunk</th>
          <th>Frame idx</th>
          <th>X</th>
          <th>Y</th>
          <th>Identity</th>
          <th>Local Identity</th>
          <th>In frame index</th>
          <th>Fragment</th>
          <th>Area</th>
          <th>YOLOv7</th>
          <th>ZT</th>
        </tr>
      </thead>
      <tbody>
        {Data.map((row, index) => (
          <tr key={index}>
            <td>
              <input
                type="number"
                value={editingRow === index ? draft : (row.frame_number ?? '')}
                onFocus={() => {
                  setEditingRow(index);
                  setDraft(String(row.frame_number ?? ''));
                }}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(draft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.target.blur();
                  else if (e.key === 'Escape') setEditingRow(null);
                }}
                style={cellInputStyle}
                onWheel={(e) => e.target.blur()}
              />
            </td>
            <td>
              <input
                type="number"
                value={
                  editingChunkRow === index
                    ? chunkDraft
                    : Math.floor(row.frame_number / row.chunksize)
                }
                onFocus={() => {
                  setEditingChunkRow(index);
                  setChunkDraft(String(Math.floor(row.frame_number / row.chunksize)));
                }}
                onChange={(e) => setChunkDraft(e.target.value)}
                onBlur={() => commitChunk(chunkDraft, row.chunksize)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.target.blur();
                  else if (e.key === 'Escape') setEditingChunkRow(null);
                }}
                style={cellInputStyle}
                onWheel={(e) => e.target.blur()}
              />
            </td>
            <td>{row.frame_number % row.chunksize}</td>
            <td>{row.x}</td>
            <td>{row.y}</td>
            <td>{row.identity}</td>
            <td>{row.local_identity}</td>
            <td>{row.in_frame_index}</td>
            <td>{row.fragment}</td>
            <td>{row.area}</td>
            <td>{row.modified.toString()}</td>
            <td>{row.ZT}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const VerticalBlobsTable = ({ Data }) => {
  const headers = [
    "Frame Number", "Chunk", "Frame idx", "X", "Y", "Identity",
    "Local Identity", "In frame index", "Fragment", "Area", "YOLOv7", "ZT"
  ];
  const extractors = [
    row => row.frame_number,
    row => Math.floor(row.frame_number / row.chunksize),
    row => row.frame_number % row.chunksize,
    row => row.x,
    row => row.y,
    row => row.identity,
    row => row.local_identity,
    row => row.in_frame_index,
    row => row.fragment,
    row => row.area,
    row => row.modified.toString(),
    row => row.ZT,
  ];
  return (
    <table className="data-table">
      <tbody>
        {headers.map((header, headerIndex) => (
          <tr key={header}>
            <th>{header}</th>
            {Data.map((row, rowIndex) => (
              <td key={rowIndex}>{extractors[headerIndex](row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export { BlobsTable, VerticalBlobsTable };