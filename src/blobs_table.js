import { useState } from 'react';
import './TableStyles.css';

const BlobsTable = ({ Data, setFrameNumber }) => {
  // Local edit buffer so typing isn't clobbered by trackingData updates
  // (which arrive on every frame fetch). `editingRow` is the row index
  // currently being edited; null when nothing is focused.
  const [draft, setDraft] = useState('');
  const [editingRow, setEditingRow] = useState(null);

  const commit = (val) => {
    const n = parseInt(val, 10);
    if (Number.isFinite(n) && n >= 0 && setFrameNumber) {
      setFrameNumber(n);
    }
    setEditingRow(null);
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
                  if (e.key === 'Enter') {
                    e.target.blur(); // triggers onBlur -> commit
                  } else if (e.key === 'Escape') {
                    setEditingRow(null);
                  }
                }}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'center',
                  font: 'inherit',
                  color: 'inherit',
                  outline: 'none',
                  padding: 0,
                  // hide the spinner arrows for cleaner look — remove if you want them
                  MozAppearance: 'textfield',
                }}
                onWheel={(e) => e.target.blur()} // prevent accidental scroll-to-change
              />
            </td>
            <td>{Math.floor(row.frame_number / row.chunksize)}</td>
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
  // unchanged
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