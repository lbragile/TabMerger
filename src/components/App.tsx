import { library } from "@fortawesome/fontawesome-svg-core";
import { far } from "@fortawesome/free-regular-svg-icons";
import {
  faCog,
  faEllipsisV,
  faExclamationCircle,
  faMask,
  faSearch,
  faStar,
  faTimes,
  faTimesCircle,
  faWindowMaximize,
  faWindowRestore,
  faCopy,
  faAngleDown,
  faAngleUp
} from "@fortawesome/free-solid-svg-icons";
import { useRef } from "react";
import { DragDropContext } from "react-beautiful-dnd";
import styled, { ThemeProvider } from "styled-components";

import Header from "./Header";
import SidePanel from "./SidePanel";
import Windows from "./Windows";

import useDnd from "~/hooks/useDnd";
import { useSelector } from "~/hooks/useRedux";
import useStorage from "~/hooks/useStorage";
import useUpdateInfo from "~/hooks/useUpdateInfo";
import useUpdateWindows from "~/hooks/useUpdateWindows";
import { GlobalStyle } from "~/styles/Global";
import Theme from "~/styles/Theme";


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

/**
 * Icons listed here no longer need to be imported in other files.
 * Instead a string can be passed to the `icon` property.
 * By default, the icons are all "solid", which is why `far` is also added ...
 * ... simply do `icon={["far", "icon-name"]}` to use the "regular" version of "icon-name"
 * @see https://fontawesome.com/v5.15/how-to-use/on-the-web/using-with/react#using
 */
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
  faMask,
  faExclamationCircle,
  faCopy,
  faAngleDown,
  faAngleUp
);

export default App;
