import { Dispatch, SetStateAction } from "react";
import styled, { css } from "styled-components";

const ModalTabContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-evenly;
  border-bottom: 1px solid #f0f0f0;
`;

const ModalTab = styled.button<{ $active: boolean }>`
  outline: none;
  border: none;
  background-color: transparent;
  font-size: 14px;
  text-transform: uppercase;
  padding: 2px 8px;
  cursor: pointer;
  ${({ $active }) =>
    $active &&
    css`
      color: #007bff;
      border-bottom: 2px solid #007bff;
      font-weight: bold;
    `}

  &:hover {
    font-weight: bold;
  }
`;

interface ISelector<T> {
  opts: T[];
  activeTab: T;
  setActiveTab: Dispatch<SetStateAction<T>>;
}

export default function Selector<T = string>({ opts, activeTab, setActiveTab }: ISelector<T>) {
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
