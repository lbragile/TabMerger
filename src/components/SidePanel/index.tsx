import React, { useEffect } from "react";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";
import Group from "./Group";
import { useSelector } from "../../hooks/useSelector";
import { addGroup, updateInfo } from "../../store/actions/groups";
import { useDispatch } from "../../hooks/useDispatch";

const Column = styled.div`
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
  const { active, available } = useSelector((state) => state.groups);

  /**
   * update each group's information if it doesn't match the current ...
   * ... whenever the list of groups updates
   */
  useEffect(() => {
    available.forEach((group, i) => {
      const { windows, info } = group;
      const countArr = windows.map((window) => window.tabs.length);
      const total = countArr.reduce((total, val) => total + val, 0);
      const newInfo = `${total}T | ${windows.length}W`;
      if (info !== newInfo) {
        dispatch(updateInfo({ index: i, info: newInfo }));
      }
    });
  }, [dispatch, available]);

  return (
    <Column>
      {available.map((data) => (
        <Group key={data.id} data={data} active={active} available={available} />
      ))}

      <AddIcon icon={faPlus} onClick={() => dispatch(addGroup())} />
    </Column>
  );
}
