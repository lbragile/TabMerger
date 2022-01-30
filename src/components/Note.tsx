import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { StyledNote } from "~/styles/StyledNote";

export default function Note({ children }: { children: JSX.Element | JSX.Element[] }) {
  return (
    <StyledNote>
      <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

      <div>{Array.isArray(children) ? children.map((child) => child) : children}</div>
    </StyledNote>
  );
}
