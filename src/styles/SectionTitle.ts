import styled from "styled-components";

export const SectionTitle = styled.h3`
  padding: 4px;
  background: ${({ theme }) => theme.colors.secondary};
  color: ${({ theme }) => theme.colors.onSecondary};
`;
