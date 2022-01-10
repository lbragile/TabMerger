import { StyledLink } from "~/styles/StyledLink";
import { createActiveTab } from "~/utils/helper";

export default function Link({ href, title, color }: { href: string; title: string; color?: string }): JSX.Element {
  return (
    <StyledLink
      $color={color}
      tabIndex={0}
      role="link"
      title={href}
      onClick={() => createActiveTab(href)}
      onKeyPress={({ key }) => key === "Enter" && createActiveTab(href)}
    >
      {title}
    </StyledLink>
  );
}
