import { Fragment } from "react";
import styled from "styled-components";

import Link from "../../components/Link";

import { LICENSE_INFO } from "~/constants/urls";

const DetailsGrid = styled.div`
  display: grid;
  grid-template-columns: max-content 60%;
  gap: 12px;
  justify-content: center;

  & h4 {
    opacity: 0.5;
    justify-self: end;
  }
`;

const LicenseGrid = styled(DetailsGrid)`
  grid-template-columns: repeat(3, auto);

  & span:nth-of-type(2n + 1) {
    justify-self: right;
  }
`;

interface ILicenseName {
  title: string;
  url: string;
}

interface ILicenseDetails {
  name: ILicenseName;
  authors: string;
  license: ILicenseName;
}

const LICENSE_DETAILS: ILicenseDetails[] = [
  {
    name: { title: "TabMerger", url: LICENSE_INFO.TabMerger.repo },
    authors: "Lior Bragilevsky",
    license: { title: "GNU GPL v3.0", url: LICENSE_INFO.TabMerger.license }
  },
  {
    name: { title: "React Beautiful DnD", url: LICENSE_INFO.ReactBeautifulDnD.repo },
    authors: "Atlassian Pty Ltd",
    license: { title: "Apache v2.0", url: LICENSE_INFO.ReactBeautifulDnD.license }
  },
  {
    name: { title: "React", url: LICENSE_INFO.React.repo },
    authors: "Facebook Inc",
    license: { title: "MIT", url: LICENSE_INFO.React.license }
  },
  {
    name: { title: "React Redux", url: LICENSE_INFO.ReactRedux.repo },
    authors: "Dan Abramov",
    license: { title: "MIT", url: LICENSE_INFO.ReactRedux.license }
  },
  {
    name: { title: "React Error Boundary", url: LICENSE_INFO.ReactErrorBoundary.repo },
    authors: "Brian Vaughn",
    license: { title: "MIT", url: LICENSE_INFO.ReactErrorBoundary.license }
  },
  {
    name: { title: "React Dropzone", url: LICENSE_INFO.ReactDropzone.repo },
    authors: "Param Aggarwal",
    license: { title: "MIT", url: LICENSE_INFO.ReactDropzone.license }
  },
  {
    name: { title: "React Multi Select Component", url: LICENSE_INFO.ReactMultiSelectComponent.repo },
    authors: "Harsh Zalavadiya",
    license: { title: "MIT", url: LICENSE_INFO.ReactMultiSelectComponent.license }
  },
  {
    name: { title: "Styled Components", url: LICENSE_INFO.StyledComponents.repo },
    authors: "Glen M. & Maximilian S.",
    license: { title: "MIT", url: LICENSE_INFO.StyledComponents.license }
  },
  {
    name: { title: "Nano ID", url: LICENSE_INFO.NanoID.repo },
    authors: "Andrey Sitnik",
    license: { title: "MIT", url: LICENSE_INFO.NanoID.license }
  }
];

export default function License(): JSX.Element {
  return (
    <LicenseGrid>
      {LICENSE_DETAILS.map(({ name, authors, license }) => (
        <Fragment key={name.title}>
          <Link href={name.url} title={name.title} />

          <p>{authors}</p>

          <Link href={license.url} title={license.title} />
        </Fragment>
      ))}
    </LicenseGrid>
  );
}
