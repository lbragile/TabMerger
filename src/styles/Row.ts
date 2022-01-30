import styled from "styled-components";

export const Row = styled.div<{ $gap?: string }>`
  display: flex;
  flex-direction: row;
  justify-content: start;
  align-items: center;
  gap: ${({ $gap }) => $gap ?? "8px"};
`;
