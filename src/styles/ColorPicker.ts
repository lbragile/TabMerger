import styled from "styled-components";

interface IPicker {
  pos: {
    x: number;
    y: number;
  };
}

export const Container = styled.div<{ $width: number; $height: number }>`
  position: relative;
  cursor: crosshair;
  overflow: hidden;

  &,
  & canvas {
    width: ${({ $width }) => $width}px;
    height: ${({ $height }) => $height}px;
  }
`;

export const Picker = styled.div.attrs(({ pos: { x, y } }: IPicker) => ({
  style: {
    top: `${y}px`,
    left: `${x}px`
  }
}))<IPicker>`
  height: 12px;
  width: 12px;
  background-color: transparent;
  border: 2px solid white;
  position: absolute;

  &:focus-visible {
    outline: 1px solid white;
    box-shadow: 0 0 1px 1px black;
  }
`;
