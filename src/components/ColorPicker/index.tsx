import { useState } from "react";
import styled from "styled-components";

import Alpha from "./Alpha";
import Hue from "./Hue";
import Sketch from "./Sketch";

import { COLOR_PICKER_SWATCHES } from "~/constants/colorPicker";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 0 4px 0 black;
  padding: 4px;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px;
  grid-template-areas:
    "hue preview"
    "alpha preview";
`;

const StyledHue = styled(Hue)`
  grid-area: hue;
`;

const StyledAlpha = styled(Alpha)`
  grid-area: alpha;
`;

const Preview = styled.div`
  background-color: red;
  width: 28px;
  height: 28px;
  grid-area: preview;
`;

const SwatchGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 2px;
  justify-items: center;
`;

const Swatch = styled.div<{ $color: string }>`
  background-color: ${({ $color }) => $color};
  width: 16px;
  height: 16px;
  box-shadow: rgb(0 0 0 / 10%) 0 0 0 1px inset, rgb(0 0 0 / 15%) 0 0 4px inset;
  cursor: pointer;
`;

export default function ColorPicker({ setColor }: { setColor: (arg: string) => void }): JSX.Element {
  const [hue, setHue] = useState(30);
  const [alpha, setAlpha] = useState(1);

  return (
    <Container>
      <Sketch hue={hue} alpha={alpha} setColor={setColor} />

      <Grid>
        <StyledHue hue={hue} setHue={setHue} />
        <StyledAlpha alpha={alpha} hue={hue} setAlpha={setAlpha} />
        <Preview />
      </Grid>

      <SwatchGrid>
        {COLOR_PICKER_SWATCHES.map((color) => (
          <Swatch
            key={color}
            tabIndex={0}
            role="button"
            $color={color}
            title={color}
            onClick={() => ""}
            onKeyPress={({ key }) => key === "Enter" && ""}
          />
        ))}
      </SwatchGrid>
    </Container>
  );
}
