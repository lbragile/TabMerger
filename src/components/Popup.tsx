import styled from "styled-components";

const Container = styled.div<{ $pos: { x: number; y: number } }>`
  position: absolute;
  top: ${({ $pos }) => $pos.y + "px"};
  left: ${({ $pos }) => $pos.x + "px"};
  z-index: 1;
`;

const Content = styled.div`
  position: relative;
  height: 100%;
  padding: 4px 8px;
  background-color: ${({ theme }) => theme.popups.surface};
  color: ${({ theme }) => theme.popups.onSurface};
  font-size: 12px;
  display: grid;
  place-items: center;
  white-space: nowrap;

  &::before {
    content: "";
    position: absolute;
    left: -8px;
    top: 50%;
    transform: translateY(-50%);
    border: 4px solid transparent;
    border-right: 4px solid ${({ theme }) => theme.popups.surface};
  }
`;

export default function Popup({ text, pos }: { text: string; pos: { x: number; y: number } }): JSX.Element {
  return (
    <Container $pos={pos}>
      <Content>{text}</Content>
    </Container>
  );
}
