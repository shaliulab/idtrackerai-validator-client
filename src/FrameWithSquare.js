// FrameWithSquare.js

import React, { useRef, useEffect, useState, useImperativeHandle } from 'react';

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
  // Note: proboscis is drawn as a special triangle, not connected by line
];

const INSET_NATIVE_SIZE = 200;
const INSET_DISPLAY_SIZE = 250;
const INSET_BORDER_COLOR = '#ffffff';
const INSET_BORDER_WIDTH = 2;

function generateColorPalette(numColors) {
  const colors = [];
  const n = Math.max(1, numColors);
  for (let i = 0; i < n; i++) {
    const hue = Math.floor((i / n) * 360);
    colors.push(`hsl(${hue}, 100%, 50%)`);
  }
  return colors;
}

// Colour lookup that tolerates a missing or zero identity and a zero animal
// count (which would otherwise produce `colors[NaN]` -> undefined -> black).
function colorFor(colors, identity) {
  const idx = parseInt(identity, 10);
  if (!Number.isFinite(idx) || colors.length === 0) return '#000000';
  return colors[((idx % colors.length) + colors.length) % colors.length];
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
      showPose,
      setShowPose,
    },
    ref,
  ) => {
    const canvasRef = useRef(null);
    const imgRef = useRef(null);
    const [hoverPos, setHoverPos] = useState(null);

    // Click log. Nothing renders from it, so a ref is the right container:
    // as state it was being mutated in place and returned by identity, which
    // React treats as "no change" and skips the re-render anyway.
    const clickPairsRef = useRef([]);

    // Expose the log (and the canvas) to the parent through the forwarded ref
    // instead of leaving it unused.
    useImperativeHandle(ref, () => ({
      canvas: canvasRef.current,
      getClickPairs: () => clickPairsRef.current,
      clearClickPairs: () => { clickPairsRef.current = []; },
    }), []);

    const sx = nativeSize ? displayWidth / nativeSize.width : 1;
    const sy = nativeSize ? displayHeight / nativeSize.height : 1;

    const handleClick = (event) => {
      // currentTarget, not target: the click lands on the <canvas>, and using
      // target would break if another element is ever layered over it.
      const rect = event.currentTarget.getBoundingClientRect();
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
          const entry = {
            timestamp: Date.now(),
            frameNumber,
            x: xDisp,
            y: yDisp,
            x_native: animal.x,
            y_native: animal.y,
            identity: animal.identity,
            fragment: animal.fragment,
          };

          const pairs = clickPairsRef.current;
          const last = pairs[pairs.length - 1];
          if (last && last.length === 1) {
            last.push(entry);        // complete the open pair
          } else {
            pairs.push([entry]);     // start a new one
          }
        }
      });
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
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas || !img || !imageURL) return;

      const context = canvas.getContext('2d');
      const colors = generateColorPalette(number_of_animals);

      // Draws one animal's skeleton and keypoints through a coordinate
      // transform, so the main view and the magnifier share this code instead
      // of keeping two copies in sync.
      const drawPose = (animalPose, color, toDisplay, visible, sizes) => {
        for (const [partA, partB] of SKELETON) {
          const bpA = animalPose[partA];
          const bpB = animalPose[partB];
          if (!bpA || !bpB) continue;
          if (bpA[0] == null || bpA[1] == null || bpB[0] == null || bpB[1] == null) continue;
          if (!visible(bpA[0], bpA[1]) || !visible(bpB[0], bpB[1])) continue;

          const [dx1, dy1] = toDisplay(bpA[0], bpA[1]);
          const [dx2, dy2] = toDisplay(bpB[0], bpB[1]);

          context.beginPath();
          context.moveTo(dx1, dy1);
          context.lineTo(dx2, dy2);
          context.lineWidth = 2;
          context.globalAlpha = 0.7;
          context.strokeStyle = color;
          context.stroke();
        }

        for (const [bpName, coords] of Object.entries(animalPose)) {
          if (!coords || coords[0] == null || coords[1] == null) continue;
          if (!visible(coords[0], coords[1])) continue;

          const [dx, dy] = toDisplay(coords[0], coords[1]);

          context.fillStyle = color;
          context.globalAlpha = 0.8;
          context.strokeStyle = 'white';
          context.lineWidth = 1;

          if (bpName === 'proboscis') {
            const s = sizes.triangle;
            context.beginPath();
            context.moveTo(dx, dy - s);          // apex
            context.lineTo(dx - s, dy + s);
            context.lineTo(dx + s, dy + s);
            context.closePath();
            context.fill();
            context.stroke();
          } else {
            context.beginPath();
            context.arc(dx, dy, sizes.radius, 0, 2 * Math.PI);
            context.fill();
            context.stroke();
          }
        }
      };

      const draw = () => {
        canvas.width = displayWidth;
        canvas.height = displayHeight;

        context.clearRect(0, 0, displayWidth, displayHeight);
        context.drawImage(img, 0, 0, displayWidth, displayHeight);

        // Tracking labels
        context.font = `${TEXT_SIZE}px ${TEXT_FAMILY}`;
        trackingData.forEach((animal) => {
          const color =
            animal.identity != null && animal.identity !== 0
              ? colorFor(colors, animal.identity)
              : '#000000';
          context.fillStyle = color;
          const v = animal?.[LABEL_FIELD] ?? animal?.identity ?? '';
          context.fillText(String(v), animal.x * sx, animal.y * sy);
        });

        // ===== POSE RENDERING =====
        if (showPose && poseData) {
          for (const identityKey of Object.keys(poseData)) {
            const animalPose = poseData[identityKey];
            if (!animalPose) continue;
            drawPose(
              animalPose,
              colorFor(colors, identityKey),
              (x, y) => [x * sx, y * sy],
              () => true,
              { triangle: 6, radius: 4 },
            );
          }
          context.globalAlpha = 1.0;
        }

        // Contours
        if (PRINT_CONTOUR && contoursData) {
          const contour_color = 'hsla(120, 100%, 50%, 0.2)';
          contoursData.forEach((contour) => {
            context.beginPath();
            contour.forEach((point, idx) => {
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

          // Clamp the sampled region to the image. Math.max(0, …) second so a
          // frame narrower than the inset still yields a non-negative origin.
          const half = INSET_NATIVE_SIZE / 2;
          const srcX = Math.max(0, Math.min(nx - half, nativeSize.width - INSET_NATIVE_SIZE));
          const srcY = Math.max(0, Math.min(ny - half, nativeSize.height - INSET_NATIVE_SIZE));

          const halfDisp = INSET_DISPLAY_SIZE / 2;
          const dstX = Math.max(0, Math.min(hoverPos.x - halfDisp, displayWidth - INSET_DISPLAY_SIZE));
          const dstY = Math.max(0, Math.min(hoverPos.y - halfDisp, displayHeight - INSET_DISPLAY_SIZE));

          context.imageSmoothingEnabled = false;
          context.drawImage(
            img,
            srcX, srcY, INSET_NATIVE_SIZE, INSET_NATIVE_SIZE,
            dstX, dstY, INSET_DISPLAY_SIZE, INSET_DISPLAY_SIZE,
          );
          context.imageSmoothingEnabled = true;

          // ===== POSE INSIDE THE MAGNIFIER =====
          if (showPose && poseData) {
            const zoom = INSET_DISPLAY_SIZE / INSET_NATIVE_SIZE;
            const toDisplay = (x, y) => [dstX + (x - srcX) * zoom, dstY + (y - srcY) * zoom];
            const visible = (x, y) =>
              x >= srcX && x < srcX + INSET_NATIVE_SIZE &&
              y >= srcY && y < srcY + INSET_NATIVE_SIZE;

            for (const identityKey of Object.keys(poseData)) {
              const animalPose = poseData[identityKey];
              if (!animalPose) continue;
              drawPose(
                animalPose,
                colorFor(colors, identityKey),
                toDisplay,
                visible,
                { triangle: 4, radius: 2.5 },
              );
            }
            context.globalAlpha = 1.0;
          }

          // Border and crosshair
          context.strokeStyle = INSET_BORDER_COLOR;
          context.lineWidth = INSET_BORDER_WIDTH;
          context.strokeRect(dstX, dstY, INSET_DISPLAY_SIZE, INSET_DISPLAY_SIZE);

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
        img.onerror = () => {};       // a revoked blob URL should not throw
        img.src = imageURL;
      }

      return () => { img.onload = null; img.onerror = null; };
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
          borderRadius: '4px',
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
          <canvas
            ref={canvasRef}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ width: displayWidth, height: displayHeight, display: 'block' }}
          />
          <img ref={imgRef} style={{ display: 'none' }} alt="" />
        </div>
      </div>
    );
  },
);

FrameWithSquare.displayName = 'FrameWithSquare';

export default FrameWithSquare;