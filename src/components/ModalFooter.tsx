import React from "react";
import styled from "styled-components";

import { useDispatch } from "~/hooks/useRedux";
import { setVisibility } from "~/store/actions/modal";
import Button from "~/styles/Button";

const FooterRow = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: end;
  align-items: center;
  gap: 8px;
`;

interface IModalFooter {
  closeText?: string;
  saveText?: string;
  showSave: boolean;
  disableSave?: boolean;
  handleSave?: () => void;
}

export default function ModalFooter({
  closeText = "Close",
  saveText = "Save",
  showSave,
  disableSave,
  handleSave
}: IModalFooter) {
  const dispatch = useDispatch();

  const hide = () => dispatch(setVisibility(false));

  return (
    <FooterRow>
      {showSave && (
        <Button onClick={handleSave} $variant="primary" disabled={!!disableSave}>
          {saveText}
        </Button>
      )}

      <Button onClick={hide}>{closeText}</Button>
    </FooterRow>
  );
}
