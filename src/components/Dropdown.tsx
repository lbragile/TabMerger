import styled, { css } from "styled-components";

interface IPos {
  top: number;
  left?: number;
  right?: number;
}

interface IDropdown {
  items: {
    text: string;
    handler?: () => void;
  }[];
  pos: IPos;
  isPopup?: boolean;
}

const Triangle = styled.div<{ $pos: IPos }>`
  width: 0;
  height: 0;
  position: absolute;
  top: 8px;
  left: ${({ $pos }) => ($pos.left ? $pos.left - 12 + "px" : 0)};
  border: 6px solid transparent;
  border-right: 6px solid #303030;
  z-index: 10;
`;

const Container = styled.div<{ $pos: IPos }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  position: absolute;
  top: ${({ $pos }) => $pos.top + "px"};
  ${({ $pos }) =>
    $pos.left
      ? css`
          left: ${$pos.left + "px"};
        `
      : css`
          right: ${($pos.right ?? 0) + "px"};
        `}
  min-width: 110px;
  background-color: #303030;
  color: white;
  overflow: hidden;
  z-index: 999;
  padding: 4px;
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

export default function Dropdown({ items, pos, isPopup = false }: IDropdown): JSX.Element {
  return (
    <>
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

      {isPopup && <Triangle $pos={pos} />}
    </>
  );
}
