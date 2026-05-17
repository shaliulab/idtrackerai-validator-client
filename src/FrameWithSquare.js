import React, { useRef, useEffect, useState } from 'react';
import ScrollNumberInput from './scrollableNumber'; // adjust the path according to your file structure

import { SQUARE_HEIGHT } from './constants'
import { SQUARE_WIDTH } from './constants'
import { TEXT_SIZE } from './constants'
import { TEXT_FAMILY } from './constants'
import { LABEL_FIELD } from './constants'
import { PRINT_CONTOUR } from './constants'

const SKELETON=[
  ["head", "thorax"],
  ["thorax", "abdomen"],
  ["thorax", "fLL"],
  ["thorax", "mLL"],
  ["thorax", "rLL"],
  ["thorax", "fRL"],
  ["thorax", "mRL"],
  ["thorax", "rRL"],
  ["thorax", "lW"],
  ["thorax", "rW"]
]

function generateColorPalette(numColors) {
  const colors = [];

  for (let i = 0; i < numColors; i++) {
    // Hue value changes for each color, covering the whole spectrum (0-360)
    const hue = Math.floor((i / numColors) * 360);
    // Saturation is 100%, lightness is 50% for the most vibrant colors
    colors.push(`hsl(${hue}, 100%, 50%)`);
  }
  return colors;
}


const FrameWithSquare = React.forwardRef(({ imageURL, trackingData, videoFrameRate, contoursData, frameNumber, setFrameNumber, number_of_animals, poseData }, ref) => {
  const canvasRef = useRef();
  const inputRef = useRef(); // create a ref for the input field
  const imgRef = useRef(); // create a ref for the img
  const [clickPairs, setClickPairs] = useState([]);

  const handleClick = (event) => {
    // Get the bounding rectangle of the target element
    const rect = event.target.getBoundingClientRect();

    // Calculate the click coordinates relative to the element
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    console.log([x, y]);

    // Check if the click falls within any of the rectangles
    trackingData.forEach((animal) => {
      if (
        x >= animal.x - SQUARE_WIDTH/2 &&
        x <= animal.x + SQUARE_WIDTH/2 &&
        y >= animal.y - SQUARE_HEIGHT/2 &&
        y <= animal.y + SQUARE_HEIGHT/2
      ) {
        const identity = animal.identity;
        const fragment = animal.fragment;
        const timestamp = Date.now();
        setClickPairs(prevData => {
          
          console.log(prevData);
          const newData = prevData;
          if (newData.length > 0) {
            const index=newData[newData.length-1][0].index+1;
            if (newData[newData.length-1].length % 2 === 0) {
              // Start a new pair
              newData.push([{ index, timestamp, frameNumber, x, y, identity, fragment }]);
            } else {
              // Finish the current pair
              newData[newData.length - 1].push({ index, timestamp, frameNumber, x, y, identity, fragment });
            }
          } else {
            const index = 0;
            newData.push([{ index, timestamp, frameNumber, x, y, identity, fragment }]);
          }

          return newData;
        });
      }
    });
  }

  const forgetLastClick = () => {
    setClickPairs(prevData => {
      const newData = [...prevData];
      if (newData.length % 2 === 1) {
        // If the last item is a pair, remove the second click
        newData[newData.length - 1].pop();
      } else if (newData.length != 0) {
        // If the last item is a single click, remove it
        newData.pop();
      }
      return newData;
    });
  };


  const forgetClickFactory = (index) => {

    const forgetClick = () => {
      const clicks = [];

      for (let i=0; i<clickPairs.length; i++) {
        console.log(clickPairs[i][0].index);
        console.log(index);
        if (clickPairs[i][0].index != index) {
          clicks.push(clickPairs[i]);
        }
      }
      console.log(clicks.length);
      setClickPairs(clicks);
    }
    return forgetClick;
  }

  useEffect(() => {

    if (canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      const img = imgRef.current;
      img.src = imageURL;

      const colors = generateColorPalette(number_of_animals);
      
      img.onload = function() {

        canvasRef.current.width = img.width
        canvasRef.current.height = img.height
        context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        context.drawImage(img, 0, 0, canvasRef.current.width, canvasRef.current.height);

        trackingData.forEach(function(animal, index) {
          const drawSquare = (context, animal, color) => {
            context.beginPath();
            context.rect(animal.x-SQUARE_WIDTH/2, animal.y-SQUARE_HEIGHT/2, SQUARE_WIDTH, SQUARE_HEIGHT);
            context.lineWidth = 2;
            context.strokeStyle = color;
            context.stroke();
            context.closePath();
          };    

          const writeIdentity = (context, animal, color) => {

              context.font = TEXT_SIZE.toString().concat("px ", TEXT_FAMILY.toString());
              // Draw the index number on the top left corner of the square
              context.fillStyle=color;
              
              const v = animal?.[LABEL_FIELD] ?? animal?.identity ?? "";
              context.fillText(String(v), animal.x, animal.y);
            }
          
          var color = "#000000";
          if (animal.identity != null & animal.identity != 0) {
            color = colors[parseInt(animal.identity) % number_of_animals ]
          }

          // drawSquare(context, animal, color); // TODO Uncomment if you want the square around the animal rendered
          writeIdentity(context, animal, color);
        });


        for (let identity in poseData) {
          var color = "#000000";
          for (const [partA, partB] of SKELETON) {
            if (poseData[identity].length == null) {
              continue;
            }
            const [x1, y1] = poseData[identity][partA];
            const [x2, y2] = poseData[identity][partB];
            if ([x1, y1, x2, y2].includes(null)) continue;
            
            color=colors[parseInt(identity) % number_of_animals];
            
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.lineWidth = 1;
            context.globalAlpha = 0.5; // Set 50% transparency
            context.strokeStyle = color;
            context.stroke();
            context.closePath();
          }
        }

        let contour_color = "hsla(120, 100%, 50%, 0.2)";
        if  (PRINT_CONTOUR) {

          contoursData.forEach(function(contour) {
            // Start a new path
            context.beginPath();
        
            // Draw the contour
            contour.forEach(function(point, index) {
                let x = point[0][0];
                let y = point[0][1];
        
                // If it's the first point, we move to it. Otherwise, we draw a line from the last point
                if (index === 0) {
                    context.moveTo(x, y);
                } else {
                    context.lineTo(x, y);
                }
            });
            // Close the path if needed
            context.closePath();
            context.fillStyle = contour_color;
            context.fill();
          });
        }

      };
    }
  }, [imageURL, trackingData, frameNumber, ref]);



  function downloadCSV() {
    let csvContent = 'Pair,Frame1,Fragment1,Identity1,Frame2,Fragment2,Identity2\n';
    
    clickPairs.forEach((pair, index) => {
      csvContent += `${pair[0].index},${pair[0].frameNumber},${pair[0].fragment},${pair[0].identity},${pair[1] ? pair[1].frameNumber : ''},${pair[1] ? pair[1].fragment : ''},${pair[1] ? pair[1].identity : ''}\n`;
    });
  
    const blob = new Blob([csvContent], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'click-pairs.csv';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  


  return (
    <div onClick={handleClick}>
      <canvas ref={canvasRef} />
      <img ref={imgRef} style={{ display: 'none', width: 1000 }} alt="" />
      <button onClick={forgetLastClick}>Cancel</button>
      <ScrollNumberInput value={frameNumber} setValue={setFrameNumber} videoFrameRate={videoFrameRate} id="frame_number" labelText="" focusElementRef={canvasRef}/>
      <table>
        <thead>
          <tr>
            <th>Pair</th>
            <th>Frame1</th>
            <th>Fragment1</th>
            <th>Identity1</th>
            <th>Frame2</th>
            <th>Fragment2</th>
            <th>Identity2</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {clickPairs.map((pair, index) => (
            <tr key={index}>
              <td>{pair[0] ? pair[0].index : ''}</td>
              <td>{pair[0] ? pair[0].frameNumber : ''}</td>
              <td>{pair[0] ? pair[0].fragment : ''}</td>
              <td>{pair[0] ? pair[0].identity: ''}</td>
              <td>{pair[1] ? pair[1].frameNumber : ''}</td>
              <td>{pair[1] ? pair[1].fragment : ''}</td>
              <td>{pair[1] ? pair[1].identity : ''}</td>
              <td><button onClick={forgetClickFactory(pair[0] ? pair[0].index : -1)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={downloadCSV}>Download CSV</button>

    </div>
  );
});

export default FrameWithSquare;
