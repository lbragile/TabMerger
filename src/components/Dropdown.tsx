import React from "react";
import styled, { css } from "styled-components";

const Container = styled.div<{ $pos: { top: number; left: number }; $isPopup: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  position: fixed;
  top: ${({ $pos }) => $pos.top + "px"};
  left: ${({ $pos }) => $pos.left + "px"};
  min-width: 110px;
  background-color: #303030;
  color: white;
  overflow: hidden;
  z-index: 10;
  padding: 4px;
  ${({ $isPopup, $pos }) =>
    $isPopup &&
    css`
      &::before {
        position: fixed;
        top: ${$pos.top + 6 + "px"};
        left: ${$pos.left - 12 + "px"};
        content: "";
        border: 6px solid transparent;
        border-right: 6px solid #303030;
      }
    `}
`;

const DropdownItem = styled.div`
  height: 30px;
  line-height: 14px;
  width: 100%;
  padding: 8px;
  text-align: center;
  font-weight: normal;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background-color: #42a4ff;
  }
`;

const DropdownDivider = styled.hr`
  border: none;
  border-top: 1px solid #bfbfbf;
  margin: 4px 0;
  width: 90%;
`;

interface IDropdown {
  items: {
    text: string;
    handler?: () => void;
  }[];
  pos: {
    top: number;
    left: number;
  };
  isPopup?: boolean;
}

export default function Dropdown({ items, pos, isPopup = false }: IDropdown): JSX.Element {
  return (
    <Container $pos={pos} $isPopup={isPopup}>
      {items.map((item, i) => {
        return item.text !== "divider" ? (
          <DropdownItem
            key={item.text + i}
            onClick={item.handler}
            tabIndex={0}
            role="button"
            onKeyPress={({ key }) => key === "Enter" && item.handler?.()}
          >
            {item.text}
          </DropdownItem>
        ) : (
          <DropdownDivider key={item.text + i} />
        );
      })}
    </Container>
  );
}
