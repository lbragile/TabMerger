import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled, { css } from "styled-components";

export const CloseIcon = styled(FontAwesomeIcon)<{ $visible?: boolean }>`
  && {
    ${({ $visible }) =>
      $visible !== false
        ? css`
            cursor: pointer;
            color: transparent;

            &:hover {
              color: #ff4040;
            }
          `
        : css`
            visibility: hidden;
          `}
  }
`;
