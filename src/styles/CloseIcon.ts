import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";

export const CloseIcon = styled(FontAwesomeIcon)`
  && {
    z-index: 1;
    cursor: pointer;
    color: ${({ theme }) => theme.colors.onBackground};
    opacity: 0;

    &:focus-visible,
    &:hover {
      opacity: 1;
      color: #ff4040;
    }
  }
`;
