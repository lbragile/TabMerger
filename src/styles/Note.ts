import styled from "styled-components";

export const Note = styled.div`
  padding: 12px;
  background-color: #f0f0f0;
  text-align: center;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;

  & p {
    opacity: 0.75;
  }
`;
