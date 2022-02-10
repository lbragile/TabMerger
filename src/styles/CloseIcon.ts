import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled, { css } from "styled-components";

export const CloseIcon = styled(FontAwesomeIcon)<{ $disabled?: boolean }>`
  && {
    z-index: 1;
    cursor: pointer;
    color: ${({ theme }) => theme.colors.onBackground};
    opacity: 0;
    ${({ $disabled }) =>
      $disabled
        ? css`
            cursor: default;
            pointer-events: none;
          `
        : css`
            &:focus-visible,
            &:hover {
              opacity: 1;
              color: #ff4040;
            }
          `}
  }
`;
