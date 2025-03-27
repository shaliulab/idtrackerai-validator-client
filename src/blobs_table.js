import './TableStyles.css';

const BlobsTable = ({ Data }) => {

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
                    <td>{row.frame_number}</td>
                    <td>{Math.floor(row.frame_number/45000)}</td>
                    <td>{row.frame_number%45000}</td>
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
  // Define the header labels in order
  const headers = [
    "Frame Number",
    "Chunk",
    "Frame idx",
    "X",
    "Y",
    "Identity",
    "Local Identity",
    "In frame index",
    "Fragment",
    "Area",
    "YOLOv7",
    "ZT"
  ];

  // Create an array of extractor functions corresponding to each header.
  const extractors = [
    row => row.frame_number,
    row => Math.floor(row.frame_number / 45000),
    row => row.frame_number % 45000,
    row => row.x,
    row => row.y,
    row => row.identity,
    row => row.local_identity,
    row => row.in_frame_index,
    row => row.fragment,
    row => row.area,
    row => row.modified.toString(),
    row => row.ZT
  ];

  return (
    <table className="data-table">
      <tbody>
        {headers.map((header, headerIndex) => (
          <tr key={header}>
            {/* The header becomes the first cell in each row */}
            <th>{header}</th>
            {/* For each data record, get the value corresponding to this header */}
            {Data.map((row, rowIndex) => (
              <td key={rowIndex}>{extractors[headerIndex](row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export { BlobsTable, VerticalBlobsTable }
