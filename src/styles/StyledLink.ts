import styled, { css } from "styled-components";

export const StyledLink = styled.span<{ $color?: string; $header?: boolean }>`
  color: ${({ $color }) => $color ?? "#0645ad"};
  cursor: pointer;
  ${({ $header }) =>
    $header &&
    css`
      font-size: 16px;
      font-weight: bold;
    `}

  &:hover {
    text-decoration: underline;
  }
`;
