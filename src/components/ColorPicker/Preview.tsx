import { useEffect, useRef } from "react";
import styled from "styled-components";

import { Container } from "~/styles/ColorPicker";

const SQUARE_DIM = 28;

const Foreground = styled.div<{ $color: string }>`
  background-color: ${({ $color }) => $color};
  box-shadow: rgb(0 0 0 / 10%) 0 0 0 1px inset, rgb(0 0 0 / 15%) 0 0 4px inset;
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
`;

export default function Preview({ color }: { color: string }) {
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  // Draw background 4x4 grid behind the foreground to show transparency better
  useEffect(() => {
    const context = previewRef.current?.getContext("2d");
    if (context) {
      const numBlocks = 4;
      const { width, height } = context.canvas;

      const w = width / numBlocks;
      const h = height / numBlocks;

      for (let i = 0; i < numBlocks; ++i) {
        for (let j = 0, col = numBlocks / 2; j < col; ++j) {
          context.rect(2 * j * w + (i % 2 ? 0 : w), i * h, w, h);
        }
      }

      context.fillStyle = "#1113";
      context.fill();
    }
  }, []);

  return (
    <Container className="picker-preview" $width={SQUARE_DIM} $height={SQUARE_DIM}>
      <canvas ref={previewRef} />
      <Foreground $color={color} />
    </Container>
  );
}
