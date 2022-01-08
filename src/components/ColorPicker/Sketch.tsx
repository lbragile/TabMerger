import { useEffect, useRef, useState } from "react";

import { Container, Picker } from "~/styles/ColorPicker";
import { RGBtoHSV, HSVtoRGB, extractRGBAFromStr } from "~/utils/colorConvert";

const CANVAS_WIDTH = 200;
const CANVAS_HEIGHT = 125;

interface ISketch {
  hue: number;
  alpha: number;
  color: string;
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
export default function Sketch({ hue, alpha, color, setColor }: ISketch): JSX.Element {
  const sketchRef = useRef<HTMLCanvasElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const [canDrag, setCanDrag] = useState(false);

  const [pickerPos, setPickerPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const [r, g, b] = extractRGBAFromStr(color);
    const { s, v } = RGBtoHSV({ r, g, b });
    setPickerPos({ x: Number(s), y: 1 - Number(v) });
  }, [color]);

  useEffect(() => {
    const x = Math.max(0, Math.min(pickerPos.x, 1));
    const y = Math.max(0, Math.min(pickerPos.y, 1));
    const { r, g, b } = HSVtoRGB({ h: hue, s: x, v: 1 - y });
    setColor(`rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`);
  }, [pickerPos, alpha, hue, setColor]);

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
      const x = (clientX - left) / CANVAS_WIDTH;
      const y = (clientY - top) / CANVAS_HEIGHT;
      setPickerPos({ x, y });
    }
  };

  const handlePointerUp = (e: React.MouseEvent) => {
    handlePointerMove(e);
    setCanDrag(false);
  };

  const handleKeyPress = ({ key }: React.KeyboardEvent) => {
    let { x: newX, y: newY } = { ...pickerPos };

    if (key === "ArrowLeft") newX -= 0.1;
    else if (key === "ArrowRight") newX += 0.1;
    else if (key === "ArrowUp") newY -= 0.05;
    else if (key === "ArrowDown") newY += 0.05;

    setPickerPos({ x: newX, y: newY });
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
        $sketch
        ref={pickerRef}
        pos={pickerPos}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyPress}
        role="slider"
        aria-valuenow={pickerPos.x + pickerPos.y}
        tabIndex={0}
      />
    </Container>
  );
}
