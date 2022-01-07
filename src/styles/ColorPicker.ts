import styled from "styled-components";

interface IPicker {
  pos: {
    x: number;
    y: number;
  };
  $sketch?: boolean;
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

export const Picker = styled.div.attrs(({ pos: { x, y }, $sketch }: IPicker) => ({
  style: {
    top: `calc(${y * 100}% - ${$sketch ? "6px" : "0px"})`,
    left: `calc(${x * 100}% - 6px)`
  }
}))<IPicker>`
  height: 12px;
  width: 12px;
  background-color: transparent;
  border: 2px solid white;
  user-select: none;
  position: absolute;
  transition: all 0.1s ease-out;

  &:focus-visible {
    outline: 1px solid white;
    box-shadow: 0 0 1px 1px black;
  }
`;
