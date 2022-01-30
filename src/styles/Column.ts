import styled from "styled-components";

export const Column = styled.div<{ $gap?: string }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $gap }) => $gap ?? "4px"};
`;
