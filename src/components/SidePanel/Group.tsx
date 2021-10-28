import React, { useRef, useState } from "react";
import styled, { css } from "styled-components";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { useDispatch } from "../../hooks/useDispatch";
import { deleteGroup, updateActive } from "../../store/actions/groups";
import { IGroupsState } from "../../store/reducers/groups";
import { relativeTimeStr } from "../../utils/helper";
import { useSelector } from "../../hooks/useSelector";

const Container = styled.div`
  position: relative;
`;

const CloseIcon = styled(FontAwesomeIcon)`
  color: rgba(0, 0, 0, 0.3);
  display: none;
  position: absolute;
  top: 4px;
  right: 4px;
  cursor: pointer;

  &:hover {
    color: rgba(255, 0, 0, 0.3);
  }
`;

const Button = styled.button.attrs((props: { active: boolean; color: string; $overflow: boolean }) => props)`
  ${({ $overflow: overflow }) => css`
    width: ${overflow ? "195px" : "209px"};
    margin-right: ${overflow ? "4px" : "0"};
  `}
  height: 49px;
  border-radius: 4px;
  background-color: ${({ active }) => (active ? "#BEDDF4" : "transparent")};
  border: 1px solid ${({ color }) => color};
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 4px 8px 4px 16px;
  cursor: pointer;

  &:hover ${CloseIcon} {
    display: block;
  }
`;

const Headline = styled.div`
  font-size: 16px;
  font-weight: 600;
  width: 95%;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
`;

const Information = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
`;

const ColorIndicator = styled.div.attrs((props: { color: string }) => props)`
  width: 8px;
  height: 100%;
  background-color: ${({ color }) => color};
  position: absolute;
  top: 0;
  left: 0;
`;

const PopUpContainer = styled.div`
  position: absolute;
  top: 0;
  left: calc(100% + 4px);
`;

const Popup = styled.div`
  position: relative;
  height: 100%;
  padding: 8px;
  background-color: #333;
  color: white;
  border-radius: 4px;
  font-weight: 500;
  display: grid;
  place-items: center;
  white-space: nowrap;

  &::before {
    content: "";
    position: absolute;
    left: -8px;
    top: 50%;
    transform: translateY(-50%);
    border: 4px solid transparent;
    border-right: 4px solid #333;
  }
`;

interface IGroup {
  data: IGroupsState["available"][number];
  available: IGroupsState["available"];
  overflow: boolean;
}

export default function Group({ data, available, overflow }: IGroup): JSX.Element | null {
  const dispatch = useDispatch();
  const { filterChoice, inputValue } = useSelector((state) => state.header);

  const { isActive, name, id, color, updatedAt, permanent, info } = data;
  const index = available.findIndex((group) => group.id === id);

  const headlineRef = useRef<HTMLDivElement>(null);
  const [showOverflow, setShowOverflow] = useState(false);

  return (filterChoice === "group" && name.toLowerCase().includes(inputValue.toLowerCase())) ||
    filterChoice === "tab" ? (
    <Container>
      <Button
        color={color}
        active={isActive}
        $overflow={overflow}
        onClick={() => !isActive && dispatch(updateActive({ index, id }))}
      >
        <Headline
          ref={headlineRef}
          onMouseOver={() => {
            const elem = headlineRef.current;
            if (elem) {
              setShowOverflow(elem.scrollWidth > elem.clientWidth);
            }
          }}
          onMouseLeave={() => setShowOverflow(false)}
          onFocus={() => console.log("focused")}
        >
          {name}
        </Headline>

        <Information>
          <span>{info ?? "0T | 0W"}</span> <span>{relativeTimeStr(updatedAt)}</span>
        </Information>

        <ColorIndicator
          color={color}
          role="button"
          tabIndex={0}
          onClick={() => console.log("open color picker")}
          onKeyPress={() => console.log("keyPress")}
        />

        {!permanent && (
          <CloseIcon
            icon={faTimes}
            onClick={(e) => {
              e.stopPropagation();
              dispatch(deleteGroup({ index, id }));
            }}
          />
        )}
      </Button>

      {showOverflow && (
        <PopUpContainer>
          <Popup>{name}</Popup>
        </PopUpContainer>
      )}
    </Container>
  ) : null;
}
