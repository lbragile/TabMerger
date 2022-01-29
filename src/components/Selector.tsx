import { Dispatch, SetStateAction } from "react";
import styled, { css } from "styled-components";

const ModalTabContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-evenly;
  border-bottom: 1px solid ${({ theme }) => theme.colors.secondary};
`;

const ModalTab = styled.button<{ $active: boolean }>`
  outline: none;
  border: none;
  background-color: transparent;
  font-size: 14px;
  text-transform: uppercase;
  padding: 2px 8px;
  color: ${({ theme }) => theme.colors.onSurface};
  cursor: pointer;
  ${({ $active }) =>
    $active &&
    css`
      color: ${({ theme }) => theme.colors.primary};
      border-bottom: 2px solid ${({ theme }) => theme.colors.primary};
      text-shadow: 1px 0 0 currentcolor;
    `}

  &:hover {
    text-shadow: 1px 0 0 currentcolor;
  }
`;

interface ISelector<T> {
  opts: T[];
  activeTab: T;
  setActiveTab: Dispatch<SetStateAction<T>>;
}

export default function Selector<T>({ opts, activeTab, setActiveTab }: ISelector<T>) {
  return (
    <ModalTabContainer>
      {opts.map((item) => (
        <ModalTab key={item + ""} $active={activeTab === item} onClick={() => setActiveTab(item)}>
          {item}
        </ModalTab>
      ))}
    </ModalTabContainer>
  );
}
