import React, { useRef, useEffect, useState } from 'react';
import ScrollNumberInput from './scrollableNumber';

import {
  SQUARE_HEIGHT,
  SQUARE_WIDTH,
  TEXT_SIZE,
  TEXT_FAMILY,
  LABEL_FIELD,
  PRINT_CONTOUR,
} from './constants';

const SKELETON = [
  ["head", "thorax"],
  ["thorax", "abdomen"],
  ["thorax", "fLL"],
  ["thorax", "mLL"],
  ["thorax", "rLL"],
  ["thorax", "fRL"],
  ["thorax", "mRL"],
  ["thorax", "rRL"],
  ["thorax", "lW"],
  ["thorax", "rW"],
];

function generateColorPalette(numColors) {
  const colors = [];
  for (let i = 0; i < numColors; i++) {
    const hue = Math.floor((i / numColors) * 360);
    colors.push(`hsl(${hue}, 100%, 50%)`);
  }
  return colors;
}

const FrameWithSquare = React.forwardRef(
  (
    {
      imageURL,
      trackingData,
      videoFrameRate,
      contoursData,
      frameNumber,
      setFrameNumber,
      number_of_animals,
      poseData,
      displayWidth = 1000,
      displayHeight = 1000,
      nativeSize, // { width, height } | null
    },
    ref,
  ) => {
    const canvasRef = useRef();
    const inputRef = useRef();
    const imgRef = useRef();
    const [clickPairs, setClickPairs] = useState([]);

    // Scale factors. Both default to 1 if nativeSize isn't known yet,
    // which means the first frame may draw labels in the wrong place
    // until probeImageSize completes — usually invisible to the eye.
    const sx = nativeSize ? displayWidth / nativeSize.width : 1;
    const sy = nativeSize ? displayHeight / nativeSize.height : 1;

    const handleClick = (event) => {
      const rect = event.target.getBoundingClientRect();
      const xDisp = event.clientX - rect.left;
      const yDisp = event.clientY - rect.top;

      // Hit-test: animals are in native space, so scale them to display
      // space for comparison with the click position.
      trackingData.forEach((animal) => {
        const ax = animal.x * sx;
        const ay = animal.y * sy;
        if (
          xDisp >= ax - SQUARE_WIDTH / 2 &&
          xDisp <= ax + SQUARE_WIDTH / 2 &&
          yDisp >= ay - SQUARE_HEIGHT / 2 &&
          yDisp <= ay + SQUARE_HEIGHT / 2
        ) {
          const identity = animal.identity;
          const fragment = animal.fragment;
          const timestamp = Date.now();
          const x_native = animal.x;
          const y_native = animal.y;

          setClickPairs((prevData) => {
            const newData = prevData;
            if (newData.length > 0) {
              const index = newData[newData.length - 1][0].index + 1;
              if (newData[newData.length - 1].length % 2 === 0) {
                newData.push([
                  { index, timestamp, frameNumber, x: xDisp, y: yDisp, x_native, y_native, identity, fragment },
                ]);
              } else {
                newData[newData.length - 1].push({
                  index, timestamp, frameNumber, x: xDisp, y: yDisp, x_native, y_native, identity, fragment,
                });
              }
            } else {
              const index = 0;
              newData.push([
                { index, timestamp, frameNumber, x: xDisp, y: yDisp, x_native, y_native, identity, fragment },
              ]);
            }
            return newData;
          });
        }
      });
    };

    const forgetLastClick = () => {
      setClickPairs((prevData) => {
        const newData = [...prevData];
        if (newData.length % 2 === 1) {
          newData[newData.length - 1].pop();
        } else if (newData.length !== 0) {
          newData.pop();
        }
        return newData;
      });
    };

    const forgetClickFactory = (index) => () => {
      const clicks = [];
      for (let i = 0; i < clickPairs.length; i++) {
        if (clickPairs[i][0].index !== index) clicks.push(clickPairs[i]);
      }
      setClickPairs(clicks);
    };

    useEffect(() => {
      if (!canvasRef.current) return;

      const context = canvasRef.current.getContext('2d');
      const img = imgRef.current;
      img.src = imageURL;

      const colors = generateColorPalette(number_of_animals);

      img.onload = function () {
        canvasRef.current.width = displayWidth;
        canvasRef.current.height = displayHeight;

        context.clearRect(0, 0, displayWidth, displayHeight);
        context.drawImage(img, 0, 0, displayWidth, displayHeight);

        // Tracking labels — scale native coords to display space at draw time.
        trackingData.forEach(function (animal) {
          const writeIdentity = (ctx, a, color) => {
            ctx.font = TEXT_SIZE.toString().concat('px ', TEXT_FAMILY.toString());
            ctx.fillStyle = color;
            const v = a?.[LABEL_FIELD] ?? a?.identity ?? '';
            ctx.fillText(String(v), a.x * sx, a.y * sy);
          };

          let color = '#000000';
          if (animal.identity != null && animal.identity !== 0) {
            color = colors[parseInt(animal.identity) % number_of_animals];
          }
          writeIdentity(context, animal, color);
        });

        // Pose
        for (let identity in poseData) {
          let color = '#000000';
          for (const [partA, partB] of SKELETON) {
            if (poseData[identity].length == null) continue;
            const [x1, y1] = poseData[identity][partA];
            const [x2, y2] = poseData[identity][partB];
            if ([x1, y1, x2, y2].includes(null)) continue;

            color = colors[parseInt(identity) % number_of_animals];

            context.beginPath();
            context.moveTo(x1 * sx, y1 * sy);
            context.lineTo(x2 * sx, y2 * sy);
            context.lineWidth = 1;
            context.globalAlpha = 0.5;
            context.strokeStyle = color;
            context.stroke();
            context.closePath();
          }
        }
        context.globalAlpha = 1.0;

        // Contours
        if (PRINT_CONTOUR) {
          const contour_color = 'hsla(120, 100%, 50%, 0.2)';
          contoursData.forEach(function (contour) {
            context.beginPath();
            contour.forEach(function (point, idx) {
              const rawX = Array.isArray(point[0]) ? point[0][0] : point[0];
              const rawY = Array.isArray(point[0]) ? point[0][1] : point[1];
              const x = rawX * sx;
              const y = rawY * sy;
              if (idx === 0) context.moveTo(x, y);
              else context.lineTo(x, y);
            });
            context.closePath();
            context.fillStyle = contour_color;
            context.fill();
          });
        }
      };
    }, [
      imageURL,
      trackingData,
      contoursData,
      poseData,
      number_of_animals,
      displayWidth,
      displayHeight,
      sx,
      sy,
      frameNumber,
      ref,
    ]);

    // function downloadCSV() {
    //   let csvContent =
    //     'Pair,Frame1,Fragment1,Identity1,X1_native,Y1_native,Frame2,Fragment2,Identity2,X2_native,Y2_native\n';

    //   clickPairs.forEach((pair) => {
    //     const a = pair[0];
    //     const b = pair[1];
    //     csvContent +=
    //       `${a.index},${a.frameNumber},${a.fragment},${a.identity},${a.x_native ?? ''},${a.y_native ?? ''},` +
    //       `${b ? b.frameNumber : ''},${b ? b.fragment : ''},${b ? b.identity : ''},${b ? (b.x_native ?? '') : ''},${b ? (b.y_native ?? '') : ''}\n`;
    //   });

    //   const blob = new Blob([csvContent], { type: 'text/csv' });
    //   const url = URL.createObjectURL(blob);
    //   const link = document.createElement('a');
    //   link.href = url;
    //   link.download = 'click-pairs.csv';
    //   document.body.appendChild(link);
    //   link.click();
    //   document.body.removeChild(link);
    // }
    
    return (
      <div>
        <div style={{ width: displayWidth }}>

          {/* Controls above the frame
          <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={forgetLastClick}>Cancel</button>
            <button onClick={downloadCSV}>Download CSV</button>
            <ScrollNumberInput
              value={frameNumber}
              setValue={setFrameNumber}
              videoFrameRate={videoFrameRate}
              id="frame_number"
              labelText=""
              focusElementRef={canvasRef}
            />
          </div> */}

          {/* The frame */}
          <div onClick={handleClick}>
            <canvas
              ref={canvasRef}
              style={{ width: displayWidth, height: displayHeight, display: 'block' }}
            />
          </div>

          <img ref={imgRef} style={{ display: 'none' }} alt="" />
        </div>
      </div>
    );


  },
);

export default FrameWithSquare;