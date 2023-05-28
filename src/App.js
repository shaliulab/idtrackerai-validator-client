import React, { useRef, useState, useEffect } from 'react';
import axios from 'axios';

function App() {
  const [frame, setFrame] = useState(null);
  const [frameNumber, setFramenumber] = useState(2250000); // Default frame number
  const [trackingData, setTrackingData] = useState([{"identity": 0, "x": null, "y": null}]); // Default frame number
  const imageRef = useRef(null);
  const [imageWidth, setImageWidth] = useState(0);
  const [debouncedFrameNumber, setDebouncedFrameNumber] = useState(50);
  const canvasRef = useRef(null);

  const watchSlider = (value) => {
    setFramenumber(value)
  }

  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedFrameNumber(frameNumber);
    }, 1000);

    return () => {
      clearTimeout(timerId);
    };
  }, [frameNumber]);


  useEffect(() => {

    axios.get(`http://localhost:5000/api/frame/${parseInt(debouncedFrameNumber)}`,  { responseType: 'blob' })
    .then(response => {
      // If your server responds with an image, you might want to display the image instead:
      setFrame(URL.createObjectURL(response.data));
    })
    .catch(error => {
      console.error("Error fetching frame: ", error);
    });
  }, [debouncedFrameNumber]);

  useEffect(() => {
    (async function fetchTrackingData() {
        axios.get(`http://localhost:5000/api/tracking/${parseInt(debouncedFrameNumber)}`)
        .then(response => {
          // Here you should handle the response appropriately.
          // If your server responds with a JSON, the following line should work fine:
          console.log(response.data);
          // If your server responds with an image, you might want to display the image instead:
          setTrackingData(response.data);
          
        })
        .catch(error => {
          console.error("Error fetching frame: ", error);
        });
    })();
  }, [debouncedFrameNumber]);


  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    const img = new Image();
    img.src = imageURL;

    img.onload = function() {
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      context.beginPath();
      context.rect(squarePosition.x, squarePosition.y, 50, 50);
      context.lineWidth = 2;
      context.strokeStyle = 'red';
      context.stroke();
    };
  }, [imageURL, squarePosition]);

  return (
    <div className="App">
    {/* <canvas ref={canvasRef} width="640" height="480" /> */}
    {frame && <img ref={imageRef} src={frame} alt="Frame" onLoad={() => setImageWidth(imageRef.current.clientWidth)} />}

    <input style={{ width: imageWidth }} type="range" min="2250000" max="15750000" value={frameNumber} onChange={e => watchSlider(e.target.value)} />
    <p>Current frame: {frameNumber}</p>
    </div>
  );
}

export default App;