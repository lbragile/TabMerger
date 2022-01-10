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
    setPickerPos(Math.max(0, Math.min(hue / 360, 1)));
  }, [hue]);

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
      setHue(((clientX - Math.floor(left)) * 360) / width);
    }
  };

  const handlePointerUp = (e: React.MouseEvent) => {
    handlePointerMove(e);
    setCanDrag(false);
  };

  const handleKeyPress = ({ key }: React.KeyboardEvent) => {
    if (key === "Tab") return;

    pickerRef.current?.focus();

    let newHue = hue;

    if (key === "ArrowLeft") newHue -= 1;
    else if (key === "ArrowRight") newHue += 1;

    setHue(Math.max(0, Math.min(newHue, 359.99)));
  };

  return (
    <Container
      className="picker-hue"
      $width={CANVAS_WIDTH}
      $height={CANVAS_HEIGHT}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyPress}
    >
      <canvas ref={hueRef} />
      <Picker ref={pickerRef} pos={{ x: pickerPos, y: 0 }} role="slider" aria-valuenow={pickerPos} tabIndex={0} />
    </Container>
  );
}
