import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";

import { useDispatch } from "~/hooks/useRedux";
import { setVisibility } from "~/store/actions/modal";

const HeaderRow = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const CloseIconContainer = styled.span`
  padding: 4px 8px;
  cursor: pointer;
  display: flex;

  &:hover {
    color: red;
    background-color: #ff000020;
  }
`;

const CloseIcon = styled(FontAwesomeIcon)`
  font-size: 16px;
`;

export default function ModalHeader({ title }: { title: string }) {
  const dispatch = useDispatch();

  const hide = () => dispatch(setVisibility(false));

  return (
    <HeaderRow>
      <h3>{title}</h3>

      <CloseIconContainer
        tabIndex={0}
        role="button"
        onClick={hide}
        onPointerDown={(e) => e.preventDefault()}
        onKeyPress={({ key }) => key === "Enter" && hide()}
      >
        <CloseIcon icon="times" />
      </CloseIconContainer>
    </HeaderRow>
  );
}
