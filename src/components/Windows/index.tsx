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
  const { active, available } = useSelector((state) => state.groups);
  const { windows, info, name } = available[active.index];

  return (
    <div>
      <Information info={info} name={name} />

      <Flex>
        {windows.map((window, i) => (
          <Window key={window.id + i} {...window} />
        ))}
      </Flex>
    </div>
  );
}
