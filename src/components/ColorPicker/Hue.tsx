import { useRef, useState, useEffect } from "react";

import { Container, Picker } from "~/styles/ColorPicker";

const CANVAS_WIDTH = 168;
const CANVAS_HEIGHT = 12;

interface IHue {
  hue: number;
  setHue: (arg: number) => void;
}

export default function Hue({ hue, setHue }: IHue) {
  const hueRef = useRef<HTMLCanvasElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const [canDrag, setCanDrag] = useState(false);
  const [pickerPos, setPickerPos] = useState(hue);

  useEffect(() => {
    const context = hueRef.current?.getContext("2d");

    if (context) {
      const { width, height } = context.canvas;

      context.clearRect(0, 0, width, height);
      context.rect(0, 0, width, height);
      const gradient = context.createLinearGradient(0, 0, width, 0);

      gradient.addColorStop(0, "rgba(255, 0, 0, 1)");
      gradient.addColorStop(0.17, "rgba(255, 255, 0, 1)");
      gradient.addColorStop(0.34, "rgba(0, 255, 0, 1)");
      gradient.addColorStop(0.51, "rgba(0, 255, 255, 1)");
      gradient.addColorStop(0.68, "rgba(0, 0, 255, 1)");
      gradient.addColorStop(0.85, "rgba(255, 0, 255, 1)");
      gradient.addColorStop(1, "rgba(255, 0, 0, 1)");

      context.fillStyle = gradient;
      context.fill();
    }
  }, []);

  const handlePointerDown = () => setCanDrag(true);

  const handlePointerMove = ({ clientX }: React.MouseEvent) => {
    const context = hueRef.current;

    if (canDrag && context) {
      const { left, width } = context.getBoundingClientRect();
      const x = clientX - Math.floor(left);
      setHue((x * 360) / width);
      setPickerPos(x - 6);
    }
  };

  const handlePointerUp = (e: React.MouseEvent) => {
    handlePointerMove(e);
    setCanDrag(false);
  };

  const handleKeyPress = ({ key }: React.KeyboardEvent) => {
    let newX = pickerPos;
    let newHue = hue;

    if (["ArrowLeft", "ArrowRight"].includes(key)) {
      const delta = key === "ArrowLeft" ? -1 : 1;
      newX = Math.max(0, Math.min(newX + delta, CANVAS_WIDTH));
      newHue += delta;
    }

    setPickerPos(newX);
    setHue(newHue);
  };

  return (
    <Container $width={CANVAS_WIDTH} $height={CANVAS_HEIGHT}>
      <canvas
        ref={hueRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      <Picker
        ref={pickerRef}
        pos={{ x: pickerPos, y: 0 }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyPress}
        role="slider"
        aria-valuenow={pickerPos}
        tabIndex={0}
      />
    </Container>
  );
}
