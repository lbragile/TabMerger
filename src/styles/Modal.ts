import styled, { keyframes } from "styled-components";

const fadeIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
`;

export const ModalContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 500px;
  position: absolute;
  top: 32px;
  left: 230px;
  background: ${({ theme }) => theme.colors.background};
  padding: 8px;
  box-shadow: 0 0 2px 2px ${({ theme }) => theme.colors.onBackground + "3"};
  z-index: 2;
  font-size: 12px;
  animation: ${fadeIn} 0.2s ease-in 1;
`;

export const Overlay = styled.div`
  width: 100vw;
  height: 100vh;
  background-color: ${({ theme }) => theme.colors.onBackground};
  opacity: 0.2;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1;
`;
