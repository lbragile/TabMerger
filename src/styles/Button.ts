import styled from "styled-components";

const Button = styled.button<{ $primary?: boolean }>`
  border: none;
  outline: none;
  background-color: ${({ $primary }) => ($primary ? "#007bff" : "#e8e8e8")};
  color: ${({ $primary }) => ($primary ? "white" : "black")};
  padding: 4px;
  min-width: 75px;
  font-weight: bold;
  cursor: pointer;

  &:hover {
    background-color: ${({ $primary }) => ($primary ? "#0069d9" : "#e0e0e0")};
  }
`;

export default Button;
