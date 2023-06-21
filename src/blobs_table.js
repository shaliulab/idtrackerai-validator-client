const BlobsTable = ({ Data }) => {

    return (
        <table>
          <thead>
            <tr>
              <th>Frame Number</th>
              <th>X</th>
              <th>Y</th>
              <th>Identity</th>
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
                    <td>{row.x}</td>
                    <td>{row.y}</td>
                    <td>{row.identity}</td>
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