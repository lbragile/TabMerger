import React from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { Scrollbar } from "../../styles/Scrollbar";
import Information from "./Information";
import Window from "./Window";

const Flex = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 460px;
  overflow: auto;
`;

export default function Windows(): JSX.Element {
  const { active, available } = useSelector((state) => state.groups);
  const { index } = active;
  const { windows, info, name, updatedAt } = available[index];

  return (
    <div>
      <Information info={info} name={name} updatedAt={updatedAt} index={index} />

      <Flex>
        {windows.map((window, i) => (
          <Window key={i} {...window} />
        ))}
      </Flex>
    </div>
  );
}
