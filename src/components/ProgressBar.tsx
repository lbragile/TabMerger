import styled from "styled-components";

const Container = styled.div`
  width: 100%;
  background-color: inherit;
  position: absolute;
  bottom: 0;
  left: 0;
`;

const Progress = styled.div<{ $completed: number }>`
  height: 5px;
  width: ${({ $completed }) => $completed + "%"};
  background-color: goldenrod;
  text-align: right;
  transition: width 1s linear;
`;

export default function ProgressBar({ completed }: { completed: number }) {
  return (
    <Container>
      <Progress $completed={completed} />
    </Container>
  );
}
