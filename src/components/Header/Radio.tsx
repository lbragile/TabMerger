import React from "react";
import { useDispatch } from "react-redux";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { setFilterChoice } from "../../store/actions/header";

const RadioInput = styled.input`
  width: 14px;
  height: 14px;
  border: 1px solid black;
  border-radius: 50%;
  cursor: pointer;
`;

const Label = styled.label`
  font-size: 16px;
  cursor: pointer;
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
`;

const LABELS = { search: ["current", "global"], include: ["tab", "group"] };

export default function Radio({ label }: { label: string }): JSX.Element {
  const dispatch = useDispatch();

  const { filterChoice } = useSelector((state) => state.header);
  const { search, include } = filterChoice;

  const lowercaseLabel = label.toLowerCase();
  const searchChecked = lowercaseLabel === search;
  const includeChecked = lowercaseLabel === include;

  return (
    <Row>
      <RadioInput
        type="radio"
        id={label}
        checked={searchChecked || includeChecked}
        onClick={() => {
          const payload =
            LABELS.search.includes(lowercaseLabel) && !searchChecked
              ? { search: lowercaseLabel, include: lowercaseLabel === "current" ? "tab" : include }
              : LABELS.include.includes(lowercaseLabel) && !includeChecked
              ? { search, include: lowercaseLabel }
              : undefined;

          if (payload) {
            dispatch(setFilterChoice({ filterChoice: payload }));
          }
        }}
      />
      <Label htmlFor={label}>{label}</Label>
    </Row>
  );
}
