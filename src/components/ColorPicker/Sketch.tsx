import { useEffect, useRef, useState } from "react";

import { Container, Picker } from "~/styles/ColorPicker";

const CANVAS_WIDTH = 200;
const CANVAS_HEIGHT = 125;
const PICKER_RADIUS = 6;

interface ISketch {
  hue: number;
  alpha: number;
  setColor: (arg: string) => void;
}

/**
 * There are three main channels:
 * 1. Hue (dominant color)
 * 2. Saturation (x-axis) - pigmentation of the color
 * 3. Brightness/Value (y-axis) - light to dark
 *
 * Thus, HSB/HSV colorspace is used to calculate the position of the cursor on the canvas
 */
export default function Sketch({ hue, alpha, setColor }: ISketch): JSX.Element {
  const sketchRef = useRef<HTMLCanvasElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const [canDrag, setCanDrag] = useState(false);
  const [pickerPos, setPickerPos] = useState({ x: 188, y: 0 });

  useEffect(() => {
    const context = sketchRef.current?.getContext("2d");
    if (context) {
      const { width, height } = context.canvas;
      context.fillStyle = `hsl(${hue}, 100%, 50%)`;
      context.fillRect(0, 0, width, height);

      const whiteGradient = context.createLinearGradient(0, 0, width, 0);
      whiteGradient.addColorStop(0, "rgba(255,255,255,1)");
      whiteGradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = whiteGradient;
      context.fillRect(0, 0, width, height);

      const blackGradient = context.createLinearGradient(0, 0, 0, height);
      blackGradient.addColorStop(0, "rgba(0,0,0,0)");
      blackGradient.addColorStop(1, "rgba(0,0,0,1)");
      context.fillStyle = blackGradient;
      context.fillRect(0, 0, width, height);
    }
  }, [hue]);

  const handlePointerDown = () => setCanDrag(true);

  const handlePointerMove = ({ clientX, clientY }: React.MouseEvent) => {
    const sketch = sketchRef.current;

    if (canDrag && sketch) {
      const { left, top } = sketch.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - PICKER_RADIUS - left, CANVAS_WIDTH));
      const y = Math.max(0, Math.min(clientY - PICKER_RADIUS - top, CANVAS_HEIGHT));

      const [r, g, b] = sketch.getContext("2d")?.getImageData(x, y, 1, 1).data ?? [0, 0, 0];

      setPickerPos({ x, y });
      setColor(`rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
  };

  const handlePointerUp = (e: React.MouseEvent) => {
    handlePointerMove(e);
    setCanDrag(false);
  };

  const handleKeyPress = ({ key }: React.KeyboardEvent) => {
    let { x: newX, y: newY } = { ...pickerPos };

    if (["ArrowLeft", "ArrowRight"].includes(key)) {
      newX = Math.max(0, Math.min(newX + (key === "ArrowLeft" ? -1 : 1), CANVAS_WIDTH));
    } else if (["ArrowUp", "ArrowDown"].includes(key)) {
      newY = Math.max(0, Math.min(newY + (key === "ArrowUp" ? -1 : 1), CANVAS_HEIGHT));
    }

    // Re-compute the canvas color
    const [r, g, b] = sketchRef.current?.getContext("2d")?.getImageData(newX, newY, 1, 1).data ?? [0, 0, 0];

    setPickerPos({ x: newX, y: newY });
    setColor(`rgba(${r}, ${g}, ${b}, ${alpha})`);
  };

  return (
    <Container $width={CANVAS_WIDTH} $height={CANVAS_HEIGHT}>
      <canvas
        ref={sketchRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <Picker
        ref={pickerRef}
        pos={pickerPos}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyPress}
        role="slider"
        aria-valuenow={Math.sqrt(pickerPos.x ** 2 + pickerPos.y ** 2)}
        tabIndex={0}
      />
    </Container>
  );
}
