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

// --- MAGNIFIER CONFIG ---
const INSET_NATIVE_SIZE = 200;    // size of region sampled from native image, in native px
const INSET_DISPLAY_SIZE = 250;   // size of the inset rendered on the canvas, in display px
const INSET_BORDER_COLOR = '#ffffff';
const INSET_BORDER_WIDTH = 2;
// -------------------------

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

    // Magnifier state: cursor position on the canvas, in display coords.
    // null when the cursor is outside the canvas.
    const [hoverPos, setHoverPos] = useState(null);

    const sx = nativeSize ? displayWidth / nativeSize.width : 1;
    const sy = nativeSize ? displayHeight / nativeSize.height : 1;

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

    // NEW: mouse handlers for the magnifier
    const handleMouseMove = (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setHoverPos({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    const handleMouseLeave = () => setHoverPos(null);

    // Wheel-to-scrub: scrolling on the canvas advances/rewinds by videoFrameRate frames.
    // Must attach as a non-passive native listener so we can preventDefault and
    // stop the page from scrolling.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const handleWheel = (e) => {
        e.preventDefault();
        // deltaY > 0 means scroll down / wheel away -> advance frames
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

        // --- MAGNIFIER OVERLAY ---
        // Draw last so it sits on top of everything else.
        if (hoverPos && nativeSize && img.naturalWidth > 0) {
          // Convert cursor position from display -> native coords.
          const nx = hoverPos.x / sx;
          const ny = hoverPos.y / sy;

          // Source rect: 200x200 native px centered on cursor, clamped to image bounds.
          const half = INSET_NATIVE_SIZE / 2;
          let srcX = nx - half;
          let srcY = ny - half;
          srcX = Math.max(0, Math.min(srcX, nativeSize.width - INSET_NATIVE_SIZE));
          srcY = Math.max(0, Math.min(srcY, nativeSize.height - INSET_NATIVE_SIZE));

          // Destination rect: INSET_DISPLAY_SIZE centered on cursor, clamped to canvas bounds.
          const halfDisp = INSET_DISPLAY_SIZE / 2;
          let dstX = hoverPos.x - halfDisp;
          let dstY = hoverPos.y - halfDisp;
          dstX = Math.max(0, Math.min(dstX, displayWidth - INSET_DISPLAY_SIZE));
          dstY = Math.max(0, Math.min(dstY, displayHeight - INSET_DISPLAY_SIZE));

          // Use nearest-neighbor for sharper pixels — comment out for smooth.
          context.imageSmoothingEnabled = false;
          context.drawImage(
            img,
            srcX, srcY, INSET_NATIVE_SIZE, INSET_NATIVE_SIZE,
            dstX, dstY, INSET_DISPLAY_SIZE, INSET_DISPLAY_SIZE,
          );
          context.imageSmoothingEnabled = true;

          // Border around the inset
          context.strokeStyle = INSET_BORDER_COLOR;
          context.lineWidth = INSET_BORDER_WIDTH;
          context.strokeRect(dstX, dstY, INSET_DISPLAY_SIZE, INSET_DISPLAY_SIZE);

          // Small crosshair at the actual cursor position (useful when inset
          // is offset due to clamping near edges).
          context.strokeStyle = INSET_BORDER_COLOR;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(hoverPos.x - 6, hoverPos.y);
          context.lineTo(hoverPos.x + 6, hoverPos.y);
          context.moveTo(hoverPos.x, hoverPos.y - 6);
          context.lineTo(hoverPos.x, hoverPos.y + 6);
          context.stroke();
        }
        // -------------------------
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
      hoverPos,        // <-- redraw when cursor moves
      nativeSize,
      ref,
    ]);

    return (
      <div>
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