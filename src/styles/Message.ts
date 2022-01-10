import styled from "styled-components";

const Message = styled.p<{ $error?: boolean }>`
  font-weight: bold;
  color: ${({ $error }) => ($error ? "red" : "green")};
  text-align: center;
`;

export default Message;
