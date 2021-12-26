import { library } from "@fortawesome/fontawesome-svg-core";
import { far } from "@fortawesome/free-regular-svg-icons";
import {
  faCog,
  faEllipsisV,
  faMask,
  faSearch,
  faStar,
  faTimes,
  faTimesCircle,
  faWindowMaximize,
  faWindowRestore
} from "@fortawesome/free-solid-svg-icons";
import { useRef } from "react";
import { DragDropContext } from "react-beautiful-dnd";
import styled, { ThemeProvider } from "styled-components";

import useDnd from "../hooks/useDnd";
import { useSelector } from "../hooks/useRedux";
import useStorage from "../hooks/useStorage";
import useUpdateInfo from "../hooks/useUpdateInfo";
import useUpdateWindows from "../hooks/useUpdateWindows";
import { GlobalStyle } from "../styles/Global";
import Theme from "../styles/Theme";

import Header from "./Header";
import SidePanel from "./SidePanel";
import Windows from "./Windows";

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

const App = (): JSX.Element => {
  const { filterChoice } = useSelector((state) => state.header);
  const { filteredGroups } = useSelector((state) => state.filter);
  const { active, available } = useSelector((state) => state.groups);

  const sidePanelRef = useRef<HTMLDivElement | null>(null);

  useStorage({ available, active });
  useUpdateWindows();
  useUpdateInfo();

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
};

library.add(
  far,
  faCog,
  faSearch,
  faTimes,
  faWindowRestore,
  faEllipsisV,
  faWindowMaximize,
  faTimesCircle,
  faStar,
  faMask
);

export default App;
