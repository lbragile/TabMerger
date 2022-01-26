import styled from "styled-components";

export const Message = styled.p<{ $error?: boolean }>`
  font-weight: bold;
  color: ${({ $error }) => ($error ? "red" : "green")};
  text-align: center;
`;
