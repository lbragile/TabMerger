import React, { useEffect, useRef, useState } from "react";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";
import Group from "./Group";
import { useSelector } from "../../hooks/useSelector";
import { addGroup, updateInfo } from "../../store/actions/groups";
import { useDispatch } from "../../hooks/useDispatch";
import { Scrollbar } from "../../styles/Scrollbar";

const Column = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  align-items: center;
  row-gap: 4px;
  height: 100%;
  overflow-y: auto;
`;

const AddIcon = styled(FontAwesomeIcon)`
  margin-top: 8px;
  cursor: pointer;
  font-size: 20px;

  &:hover {
    color: rgb(0, 0, 0, 0.5);
  }
`;

export default function SidePanel(): JSX.Element {
  const dispatch = useDispatch();
  const { available } = useSelector((state) => state.groups);

  const sidePanelRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(false);

  /**
   * update each group's information if it doesn't match the current ...
   * ... whenever the list of groups updates
   */
  useEffect(() => {
    available.forEach((group, i) => {
      const { windows: allWindows, info } = group;
      const countArr = allWindows.map((currentWindow) => currentWindow.tabs?.length ?? 0);
      const total = countArr.reduce((total, val) => total + val, 0);
      const newInfo = `${total}T | ${allWindows.length}W`;
      if (info !== newInfo) {
        dispatch(updateInfo({ index: i, info: newInfo }));
      }
    });

    setOverflow(sidePanelRef.current ? sidePanelRef.current.scrollHeight > sidePanelRef.current.clientHeight : false);
  }, [dispatch, available]);

  return (
    <Column ref={sidePanelRef}>
      {available.map((data) => (
        <Group key={data.id} data={data} available={available} overflow={overflow} />
      ))}

      <AddIcon icon={faPlus} tabIndex={0} onClick={() => dispatch(addGroup())} />
    </Column>
  );
}
