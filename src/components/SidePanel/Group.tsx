import React, { useRef, useState } from "react";
import styled from "styled-components";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes } from "@fortawesome/free-solid-svg-icons";

const Wrapper = styled.div`
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

const Button = styled.button.attrs((props: { active: boolean; color: string }) => props)`
  width: 209px;
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

const PopUpWrapper = styled.div`
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

export default function Group({
  name,
  info,
  color,
  permanent = undefined
}: {
  name: string;
  info: { tab: string; when: string };
  color: string;
  permanent?: boolean;
}): JSX.Element {
  const headlineRef = useRef<HTMLDivElement>(null);
  const [showOverflow, setShowOverflow] = useState(false);

  return (
    <Wrapper>
      <Button color={color} onClick={() => console.log("activate group")}>
        <Headline
          ref={headlineRef}
          onMouseOver={() => {
            const elem = headlineRef.current;
            if (elem) {
              setShowOverflow(elem.scrollWidth > elem.clientWidth);
            }
          }}
          onMouseLeave={() => setShowOverflow(false)}
        >
          {name}
        </Headline>

        <Information>
          <span>{info.tab}</span> <span>{info.when}</span>
        </Information>

        <ColorIndicator color={color} onClick={() => console.log("open color picker")} />

        {!permanent && <CloseIcon icon={faTimes} />}
      </Button>

      {showOverflow && (
        <PopUpWrapper>
          <Popup>{name}</Popup>
        </PopUpWrapper>
      )}
    </Wrapper>
  );
}
