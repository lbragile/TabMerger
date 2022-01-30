import styled from "styled-components";

import { Row } from "./Row";

export const CheckboxContainer = styled(Row)`
  padding: unset;

  & label {
    padding-top: 2px;
  }

  & label,
  & input {
    cursor: pointer;
  }
`;
