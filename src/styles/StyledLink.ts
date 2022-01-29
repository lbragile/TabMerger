import styled, { css } from "styled-components";

export const StyledLink = styled.span<{ $color?: string; $header?: boolean }>`
  color: ${({ $color, theme }) => $color ?? theme.links.onSurface};
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
