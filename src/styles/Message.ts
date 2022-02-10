import styled from "styled-components";

import { Row } from "./Row";

export const Message = styled(Row)<{ $error?: boolean; $recent?: boolean }>`
  font-weight: bold;
  background: ${({ $error, $recent }) => ($error ? "#ffdddd" : $recent ? "#ddffdd" : "#e8e8ff")};
  color: ${({ $error, $recent }) => ($error ? "#721c24" : $recent ? "#155724" : "blue")};
  text-align: center;
  width: fit-content;
  padding: 4px 8px;
  margin: auto;
`;
