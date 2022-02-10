import styled from "styled-components";

export const WindowTitle = styled.input`
  all: unset;
  font-size: 15px;
  width: calc(100% - 8px);
  padding: 0 4px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;

  &:hover,
  &:focus-visible {
    background-color: ${({ theme }) => theme.headers.secondary};
  }
`;

export const WindowHeadline = styled.div`
  display: grid;
  grid-template-columns: auto 25ch auto;
  column-gap: 6px;
  justify-content: start;
  align-items: center;
  background-color: transparent;
  padding: 0 2px;
  border: 1px dashed initial;

  & svg {
    max-width: 14px;
    transition: transform 0.3s ease;

    &:hover,
    &:focus-visible {
      transform: scale(1.25);
    }
  }
`;

export const TabCounter = styled.span`
  color: ${({ theme }) => theme.colors.onBackground};
  opacity: 0.75;
  cursor: default;
`;
