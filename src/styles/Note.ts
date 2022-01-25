import styled from "styled-components";

export const Note = styled.div`
  padding: 12px;
  background-color: #f0f0f0;
  color: black;
  text-align: center;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;

  & div {
    & > p,
    & > span {
      opacity: 0.75;
    }
  }
`;
