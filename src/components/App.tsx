import { useRef } from "react";
import styled, { ThemeProvider } from "styled-components";
import { useSelector } from "../hooks/useSelector";
import useUpdateWindows from "../hooks/useUpdateWindows";
import { GlobalStyle } from "../styles/Global";
import Header from "./Header";
import SidePanel from "./SidePanel";
import Windows from "./Windows";
import { DragDropContext } from "react-beautiful-dnd";
import useStorage from "../hooks/useStorage";
import useDnd from "../hooks/useDnd";
import Theme from "../styles/Theme";

const Container = styled.div`
  width: 780px;
  height: 600px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const MainArea = styled.div`
  display: grid;
  grid-template-columns: minmax(210px, 1fr) 3fr;
  column-gap: 16px;
  align-items: start;
  padding: 10px 8px;
  overflow: hidden;
`;

export default function App(): JSX.Element {
  const { filterChoice } = useSelector((state) => state.header);
  const { filteredGroups } = useSelector((state) => state.filter);
  const { active, available } = useSelector((state) => state.groups);

  const sidePanelRef = useRef<HTMLDivElement | null>(null);

  useStorage({ available, active });
  useUpdateWindows();

  const { onBeforeCapture, onDragStart, onDragUpdate, onDragEnd } = useDnd(sidePanelRef);

  return (
    <Container>
      <GlobalStyle />

      <ThemeProvider theme={Theme}>
        <Header />

        <DragDropContext
          onBeforeCapture={onBeforeCapture}
          onDragStart={onDragStart}
          onDragUpdate={onDragUpdate}
          onDragEnd={onDragEnd}
        >
          {(filterChoice === "tab" || (filterChoice === "group" && filteredGroups.length > 0)) && (
            <MainArea>
              <div ref={sidePanelRef}>
                <SidePanel />
              </div>

              <Windows />
            </MainArea>
          )}
        </DragDropContext>
      </ThemeProvider>
    </Container>
  );
}
