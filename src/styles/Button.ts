import styled from "styled-components";

const Button = styled.button<{ $variant?: "primary" | "secondary" | "info" | "danger" | "success" }>`
  border: none;
  outline: none;
  background-color: ${({ $variant }) =>
    $variant === "primary"
      ? "#007bff"
      : $variant === "info"
      ? "#17a2b8"
      : $variant === "success"
      ? "#28a745"
      : "#e8e8e8"};
  color: ${({ $variant }) => (["primary", "info", "success"].includes($variant ?? "") ? "white" : "black")};
  padding: 4px;
  min-width: 75px;
  max-width: fit-content;
  font-weight: bold;
  cursor: pointer;

  &:hover {
    background-color: ${({ $variant }) =>
      $variant === "primary"
        ? "#0069d9"
        : $variant === "info"
        ? "#138496"
        : $variant === "success"
        ? "#218838"
        : "#dcdcdc"};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export default Button;
