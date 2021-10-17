import React from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import Information from "./Information";
import Window from "./Window";

const Flex = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export default function Windows(): JSX.Element {
  const { windows } = useSelector((state) => state.group);

  return (
    <div>
      <Information />

      <Flex>
        {windows.map((window, i) => (
          <Window key={window.id + i} {...window} />
        ))}
      </Flex>
    </div>
  );
}
