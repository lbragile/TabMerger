import styled from "styled-components";

export const Scrollbar = styled.div`
  ::-webkit-scrollbar {
    width: 8px;
  }

  ::-webkit-scrollbar-track {
    background-color: #e1e1e1;
  }

  ::-webkit-scrollbar-thumb {
    background-color: #888;

    &:hover {
      background-color: #777;
    }
  }
`;
