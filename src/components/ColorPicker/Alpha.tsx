import { useRef, useState, useEffect } from "react";

import { Container, Picker } from "~/styles/ColorPicker";

const CANVAS_WIDTH = 168;
const CANVAS_HEIGHT = 12;

interface IAlpha {
  alpha: number;
  hue: number;
  setAlpha: (arg: number) => void;
}

export default function Alpha({ alpha, hue, setAlpha }: IAlpha) {
  const alphaRef = useRef<HTMLCanvasElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const [canDrag, setCanDrag] = useState(false);
  const [pickerPos, setPickerPos] = useState(alpha);

  useEffect(() => {
    setPickerPos(Math.max(0, Math.min(alpha, 1)));
  }, [alpha]);

  useEffect(() => {
    const context = alphaRef.current?.getContext("2d");

    if (context) {
      const { width, height } = context.canvas;
      context.clearRect(0, 0, width, height);
      context.beginPath();

      // Draw checkered grid
      const numBlocks = 25;

      const w = width / numBlocks;
      const h = height / 2;

      for (let j = 0; j < numBlocks; j++) {
        context.rect(2 * j * w, 0, w, h);
        context.rect((2 * j + 1) * w, h, w, h);
      }

      context.fillStyle = "#1113";
      context.fill();

      // Draw hue gradient
      context.rect(0, 0, width, height);
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, `hsla(${hue}, 100%, 50%, 0)`);
      gradient.addColorStop(1, `hsla(${hue}, 100%, 50%, 1)`);
      context.fillStyle = gradient;
      context.fill();
    }
  }, [hue]);

  const handlePointerDown = () => setCanDrag(true);

  const handlePointerMove = ({ clientX }: React.MouseEvent) => {
    const context = alphaRef.current;

    if (canDrag && context) {
      const { left, width } = context.getBoundingClientRect();
      setAlpha((clientX - Math.floor(left)) / width);
    }
  };

  const handlePointerUp = (e: React.MouseEvent) => {
    handlePointerMove(e);
    setCanDrag(false);
  };

  const handleKeyPress = ({ key }: React.KeyboardEvent) => {
    if (key === "Tab") return;

    pickerRef.current?.focus();

    let newAlpha = alpha;

    if (key === "ArrowLeft") newAlpha -= 0.01;
    else if (key === "ArrowRight") newAlpha += 0.01;

    setAlpha(Math.max(0, Math.min(newAlpha, 1)));
  };

  return (
    <Container
      className="picker-alpha"
      $width={CANVAS_WIDTH}
      $height={CANVAS_HEIGHT}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyPress}
    >
      <canvas ref={alphaRef} />
      <Picker ref={pickerRef} pos={{ x: pickerPos, y: 0 }} role="slider" aria-valuenow={pickerPos} tabIndex={0} />
    </Container>
  );
}
