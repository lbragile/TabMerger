import styled from "styled-components";

export const Note = styled.div`
  padding: 12px;
  background-color: ${({ theme }) => theme.colors.secondary};
  color: ${({ theme }) => theme.colors.onSecondary};
  text-align: center;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;

  & div {
    & > p,
    & > span {
      opacity: 0.9;
    }
  }
`;
