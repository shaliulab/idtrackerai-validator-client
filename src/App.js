import React, { useState } from 'react';
import axios from 'axios';

function App() {
  const [frame, setFrame] = useState(null);
  const [frameNumber, setFramenumber] = useState(2250000); // Default frame number
  
  const fetchFrame = () => {
    axios.get(`http://localhost:5000/api/frame/${frameNumber}`,  { responseType: 'blob' })
      .then(response => {
        // Here you should handle the response appropriately.
        // If your server responds with a JSON, the following line should work fine:
        console.log(response.data);
        // If your server responds with an image, you might want to display the image instead:
        setFrame(URL.createObjectURL(response.data));
      })
      .catch(error => {
        console.error("Error fetching frame: ", error);
      });
  }

  return (
    <div className="App">
    <input type="range" min="2250000" max="15750000" value={frameNumber} onChange={e => setFramenumber(e.target.value)} />
    <p>Current frame: {frameNumber}</p>
    <button onClick={fetchFrame}>Fetch Frame</button>
    {frame && <img src={frame} alt="Frame" />}
    </div>
  );
}

export default App;