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

export default BlobsTable
