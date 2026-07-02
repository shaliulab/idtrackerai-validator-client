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
  ["proboscis", "head"]
];

const INSET_NATIVE_SIZE = 200;
const INSET_DISPLAY_SIZE = 250;
const INSET_BORDER_COLOR = '#ffffff';
const INSET_BORDER_WIDTH = 2;

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
      nativeSize,
    },
    ref,
  ) => {
    const canvasRef = useRef();
    const imgRef = useRef();
    const [clickPairs, setClickPairs] = useState([]);
    const [hoverPos, setHoverPos] = useState(null);
    const [showPose, setShowPose] = useState(true);

    const sx = nativeSize ? displayWidth / nativeSize.width : 1;
    const sy = nativeSize ? displayHeight / nativeSize.height : 1;

    // DEBUG: Log when poseData changes
    useEffect(() => {
      console.log('=== FrameWithSquare poseData updated ===');
      console.log('poseData:', poseData);
      console.log('poseData keys:', Object.keys(poseData || {}));
      console.log('poseData is empty?', Object.keys(poseData || {}).length === 0);
      
      if (Object.keys(poseData || {}).length > 0) {
        const firstId = Object.keys(poseData)[0];
        console.log('First identity:', firstId);
        console.log('Bodyparts for identity 0:', Object.keys(poseData[firstId] || {}));
        console.log('Sample bodypart (head):', poseData[firstId]?.head);
      }
    }, [poseData]);

    // DEBUG: Log when trackingData changes
    useEffect(() => {
      console.log('=== FrameWithSquare trackingData updated ===');
      console.log('trackingData length:', trackingData?.length);
      if (trackingData && trackingData.length > 0) {
        console.log('First animal:', trackingData[0]);
      }
    }, [trackingData]);

    const handleClick = (event) => {
      const rect = event.target.getBoundingClientRect();
      const xDisp = event.clientX - rect.left;
      const yDisp = event.clientY - rect.top;

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

    const handleMouseMove = (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setHoverPos({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    const handleMouseLeave = () => setHoverPos(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const handleWheel = (e) => {
        e.preventDefault();
        const step = videoFrameRate || 1;
        const direction = e.deltaY > 0 ? 1 : -1;
        setFrameNumber((prev) => Math.max(0, prev + direction * step));
      };

      canvas.addEventListener('wheel', handleWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', handleWheel);
    }, [videoFrameRate, setFrameNumber]);

    useEffect(() => {
      if (!canvasRef.current) return;

      const context = canvasRef.current.getContext('2d');
      const img = imgRef.current;
      const colors = generateColorPalette(number_of_animals);

      const draw = () => {
        canvasRef.current.width = displayWidth;
        canvasRef.current.height = displayHeight;

        context.clearRect(0, 0, displayWidth, displayHeight);
        context.drawImage(img, 0, 0, displayWidth, displayHeight);

        // DEBUG: Log scale factors
        console.log('=== Canvas Draw Info ===');
        console.log('displayWidth:', displayWidth, 'displayHeight:', displayHeight);
        console.log('nativeSize:', nativeSize);
        console.log('sx:', sx, 'sy:', sy);

        // Tracking labels
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
          console.log(`Animal ${animal.identity} centroid:`, {x: animal.x, y: animal.y, displayX: animal.x * sx, displayY: animal.y * sy});
          writeIdentity(context, animal, color);
        });

        // ===== POSE RENDERING =====
        if (showPose) {
          console.log('=== Drawing pose ===');
          console.log('poseData is empty?', Object.keys(poseData || {}).length === 0);
          console.log('poseData keys:', Object.keys(poseData || {}));
          
          let skeletonsDrawn = 0;
          let keypointsDrawn = 0;

          for (let identityKey in poseData) {
            const animalPose = poseData[identityKey];
            console.log(`Processing identity ${identityKey}, pose:`, animalPose);

            // Draw skeleton connections
            for (const [partA, partB] of SKELETON) {
              if (!(partA in animalPose) || !(partB in animalPose)) {
                console.warn(`Bodyparts ${partA} or ${partB} not found for identity ${identityKey}`);
                continue;
              }

              const bpA = animalPose[partA];
              const bpB = animalPose[partB];

              if (!bpA || !bpB || bpA[0] === null || bpA[1] === null || bpB[0] === null || bpB[1] === null) {
                continue;
              }

              const [x1, y1] = bpA;
              const [x2, y2] = bpB;

              console.log(`Drawing skeleton line: ${partA}(${x1},${y1}) -> ${partB}(${x2},${y2})`);

              const color = colors[parseInt(identityKey) % number_of_animals];
              context.beginPath();
              context.moveTo(x1 * sx, y1 * sy);
              context.lineTo(x2 * sx, y2 * sy);
              context.lineWidth = 2;
              context.globalAlpha = 0.7;
              context.strokeStyle = color;
              context.stroke();
              context.closePath();
              skeletonsDrawn++;
            }

            // Draw keypoints
            for (const [bpName, coords] of Object.entries(animalPose)) {
              if (!coords || coords[0] === null || coords[1] === null) continue;

              const [x, y] = coords;
              const displayX = x * sx;
              const displayY = y * sy;
              const radius = 4;
              const color = colors[parseInt(identityKey) % number_of_animals];

              console.log(`  Keypoint ${bpName}: native(${x}, ${y}) -> display(${displayX}, ${displayY})`);

              context.beginPath();
              context.arc(displayX, displayY, radius, 0, 2 * Math.PI);
              context.fillStyle = color;
              context.globalAlpha = 0.8;
              context.fill();
              context.strokeStyle = 'white';
              context.lineWidth = 1;
              context.stroke();
              keypointsDrawn++;
            }
          }

          console.log(`Drew ${skeletonsDrawn} skeleton lines and ${keypointsDrawn} keypoints`);
          context.globalAlpha = 1.0;
        }

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

        // --- MAGNIFIER OVERLAY ---
        if (hoverPos && nativeSize && img.naturalWidth > 0) {
          const nx = hoverPos.x / sx;
          const ny = hoverPos.y / sy;

          const half = INSET_NATIVE_SIZE / 2;
          let srcX = nx - half;
          let srcY = ny - half;
          srcX = Math.max(0, Math.min(srcX, nativeSize.width - INSET_NATIVE_SIZE));
          srcY = Math.max(0, Math.min(srcY, nativeSize.height - INSET_NATIVE_SIZE));

          const halfDisp = INSET_DISPLAY_SIZE / 2;
          let dstX = hoverPos.x - halfDisp;
          let dstY = hoverPos.y - halfDisp;
          dstX = Math.max(0, Math.min(dstX, displayWidth - INSET_DISPLAY_SIZE));
          dstY = Math.max(0, Math.min(dstY, displayHeight - INSET_DISPLAY_SIZE));

          context.imageSmoothingEnabled = false;
          context.drawImage(
            img,
            srcX, srcY, INSET_NATIVE_SIZE, INSET_NATIVE_SIZE,
            dstX, dstY, INSET_DISPLAY_SIZE, INSET_DISPLAY_SIZE,
          );
          context.imageSmoothingEnabled = true;

          // ===== DRAW POSE IN MAGNIFIER =====
          if (showPose) {
            const zoomFactor = INSET_DISPLAY_SIZE / INSET_NATIVE_SIZE;

            // Draw pose skeleton and keypoints within magnifier bounds
            for (let identityKey in poseData) {
              const animalPose = poseData[identityKey];

              // Draw skeleton connections
              for (const [partA, partB] of SKELETON) {
                if (!(partA in animalPose) || !(partB in animalPose)) continue;

                const bpA = animalPose[partA];
                const bpB = animalPose[partB];

                if (!bpA || !bpB || bpA[0] === null || bpA[1] === null || bpB[0] === null || bpB[1] === null) {
                  continue;
                }

                const [x1, y1] = bpA;
                const [x2, y2] = bpB;

                // Check if keypoints are within magnifier region (native coords)
                const inMagnifier1 = x1 >= srcX && x1 < srcX + INSET_NATIVE_SIZE && y1 >= srcY && y1 < srcY + INSET_NATIVE_SIZE;
                const inMagnifier2 = x2 >= srcX && x2 < srcX + INSET_NATIVE_SIZE && y2 >= srcY && y2 < srcY + INSET_NATIVE_SIZE;

                if (!inMagnifier1 || !inMagnifier2) continue;

                // Transform to magnifier display coordinates
                const dispX1 = dstX + (x1 - srcX) * zoomFactor;
                const dispY1 = dstY + (y1 - srcY) * zoomFactor;
                const dispX2 = dstX + (x2 - srcX) * zoomFactor;
                const dispY2 = dstY + (y2 - srcY) * zoomFactor;

                const color = colors[parseInt(identityKey) % number_of_animals];
                context.beginPath();
                context.moveTo(dispX1, dispY1);
                context.lineTo(dispX2, dispY2);
                context.lineWidth = 2;
                context.globalAlpha = 0.7;
                context.strokeStyle = color;
                context.stroke();
                context.closePath();
              }

              // Draw keypoints
              for (const [bpName, coords] of Object.entries(animalPose)) {
                if (!coords || coords[0] === null || coords[1] === null) continue;

                const [x, y] = coords;

                // Check if keypoint is within magnifier region
                if (x < srcX || x >= srcX + INSET_NATIVE_SIZE || y < srcY || y >= srcY + INSET_NATIVE_SIZE) {
                  continue;
                }

                // Transform to magnifier display coordinates
                const dispX = dstX + (x - srcX) * zoomFactor;
                const dispY = dstY + (y - srcY) * zoomFactor;
                const radius = 3;
                const color = colors[parseInt(identityKey) % number_of_animals];

                context.beginPath();
                context.arc(dispX, dispY, radius, 0, 2 * Math.PI);
                context.fillStyle = color;
                context.globalAlpha = 0.8;
                context.fill();
                context.strokeStyle = 'white';
                context.lineWidth = 1;
                context.stroke();
              }
            }
            context.globalAlpha = 1.0;
          }

          // Border and crosshair
          context.strokeStyle = INSET_BORDER_COLOR;
          context.lineWidth = INSET_BORDER_WIDTH;
          context.strokeRect(dstX, dstY, INSET_DISPLAY_SIZE, INSET_DISPLAY_SIZE);

          context.strokeStyle = INSET_BORDER_COLOR;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(hoverPos.x - 6, hoverPos.y);
          context.lineTo(hoverPos.x + 6, hoverPos.y);
          context.moveTo(hoverPos.x, hoverPos.y - 6);
          context.lineTo(hoverPos.x, hoverPos.y + 6);
          context.stroke();
        }
      };

      if (img.src === imageURL && img.complete && img.naturalWidth > 0) {
        draw();
      } else {
        img.onload = draw;
        img.src = imageURL;
      }
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
      hoverPos,
      nativeSize,
      showPose,
      ref,
    ]);

    return (
      <div>
        <div style={{ 
          display: 'flex', 
          gap: '10px', 
          alignItems: 'center', 
          marginBottom: '10px',
          padding: '5px 10px',
          backgroundColor: '#f0f0f0',
          borderRadius: '4px'
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showPose}
              onChange={(e) => setShowPose(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ fontWeight: 'bold' }}>Show Pose</span>
          </label>
        </div>
        <div style={{ width: displayWidth }}>
          <div
            onClick={handleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
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