import styled, { css } from "styled-components";
import { useSelector } from "../hooks/useRedux";

interface IPos {
  top: number;
  left?: number;
  right?: number;
}

type TAlign = "left" | "center" | "right";

export interface IDropdown {
  items: {
    text: string | JSX.Element;
    handler?: (e?: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => void;
    isDanger?: boolean;
    isDisabled?: boolean;
  }[];
  pos: IPos;
  isPopup?: boolean;
  textAlign?: TAlign;
}

const Triangle = styled.div<{ $pos: IPos }>`
  width: 0;
  height: 0;
  position: absolute;
  top: 4px;
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

const DropdownItem = styled.div<{ $align: TAlign; $danger?: boolean; $disabled?: boolean }>`
  height: 30px;
  line-height: 14px;
  width: 100%;
  padding: 8px;
  text-align: ${({ $align }) => $align};
  font-weight: normal;
  font-size: 14px;
  white-space: nowrap;
  cursor: ${({ $disabled }) => ($disabled ? "default" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? "0.5" : "1")};

  &:hover,
  &:focus-visible {
    background-color: ${({ $danger, $disabled }) => (!$disabled ? ($danger ? "#ff4a24" : "#42a4ff") : "initial")};
  }
`;

const DropdownDivider = styled.hr`
  border: none;
  border-top: 1px solid #bfbfbf;
  margin: 4px 0;
  width: 90%;
`;

export default function Dropdown({ items, pos, isPopup = false, textAlign = "left" }: IDropdown): JSX.Element {
  const {
    active: { index: groupIndex }
  } = useSelector((state) => state.groups);

  return (
    <>
      <Container $pos={pos}>
        {items.map((item, i) => {
          return item.text !== "divider" ? (
            <DropdownItem
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                !item.isDisabled && item.handler?.(e);
              }}
              tabIndex={(groupIndex === 0 && !item.isDisabled) || groupIndex > 0 ? 0 : -1}
              role="button"
              onKeyPress={(e) => e.key === "Enter" && item.handler?.(e)}
              $align={textAlign}
              $danger={item.isDanger}
              $disabled={item.isDisabled}
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
