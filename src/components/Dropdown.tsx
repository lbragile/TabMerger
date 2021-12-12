import React from "react";
import styled from "styled-components";

const Container = styled.div<{ $pos: { top: number; left: number } }>`
  border: 1px solid #808080;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: absolute;
  top: ${({ $pos }) => $pos.top + "px"};
  left: ${({ $pos }) => $pos.left + "px"};
  width: 110px;
  background-color: #fff;
  overflow: hidden;
  z-index: 10;
`;

const DropdownItem = styled.div`
  height: 30px;
  line-height: 30px;
  width: 100%;
  text-align: center;
  font-weight: bold;
  cursor: pointer;

  &:hover {
    background-color: #ddd;
  }
`;

const DropdownDivider = styled.hr`
  border: none;
  border-top: 1px solid #bfbfbf;
  width: 80px;
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
}

export default function Dropdown({ items, pos }: IDropdown): JSX.Element {
  return (
    <Container $pos={pos}>
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
