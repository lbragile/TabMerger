import styled from "styled-components";

import { CloseIcon } from "./CloseIcon";
import { Row } from "./Row";

export const GroupButton = styled.div`
  width: 209px;
  height: 49px;
  background-color: ${({ theme }) => theme.colors.surface};
  outline: 1px solid ${({ theme }) => theme.colors.onBackground + "2"};
  outline-offset: -1px;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px 8px 2px 16px;
  cursor: pointer;
`;

export const GroupHeadline = styled.input`
  all: unset;
  font-size: 16px;
  font-weight: 600;
  width: fit-content;
  max-width: 95%;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  line-height: 16px;

  &:hover {
    border-bottom: 1px solid grey;
  }
`;

export const GroupInformation = styled(Row)`
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
`;

export const ColorIndicator = styled.div<{ color: string }>`
  width: 8px;
  height: 100%;
  background-color: ${({ color }) => color};
  position: absolute;
  top: 0;
  left: 0;
  transition: transform 0.3s linear, background-color 0.3s ease-out;

  &:hover {
    transform: scaleX(2);
  }
`;

export const ColorPickerContainer = styled.div`
  position: absolute;
  top: 0;
  left: calc(100% + 8px);
`;

export const GroupButtonContainer = styled.div`
  position: relative;
  max-width: fit-content;
`;

export const AbsoluteCloseIcon = styled(CloseIcon)`
  position: absolute;
  top: 4px;
  right: 4px;
`;
