import { useState } from "react";
import styled from "styled-components";

import Alpha from "./Alpha";
import Hue from "./Hue";
import Sketch from "./Sketch";

import { COLOR_PICKER_SWATCHES } from "~/constants/colorPicker";
import { extractRGBAFromStr, RGBtoHSV } from "~/utils/colorConvert";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 0 4px 0 black;
  padding: 4px;
  background-color: white;
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

const Preview = styled.div<{ $color: string }>`
  background-color: ${({ $color }) => $color};
  width: 28px;
  height: 28px;
  grid-area: preview;
  box-shadow: rgb(0 0 0 / 10%) 0 0 0 1px inset, rgb(0 0 0 / 15%) 0 0 4px inset;
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

const ColorIndicator = styled.p`
  font-size: 12px;
  text-align: center;
`;

interface IColorPicker {
  color: string;
  setColor: (arg: string) => void;
}

export default function ColorPicker({ color, setColor }: IColorPicker): JSX.Element {
  const [hue, setHue] = useState(() => {
    const [r, g, b] = extractRGBAFromStr(color);
    const { h } = RGBtoHSV({ r, g, b });

    return Number(h);
  });

  const [alpha, setAlpha] = useState(() => extractRGBAFromStr(color).at(-1) ?? 1);

  return (
    <Container>
      <Sketch hue={hue} alpha={alpha} color={color} setColor={setColor} />

      <Grid>
        <StyledHue hue={hue} setHue={setHue} />
        <StyledAlpha alpha={alpha} hue={hue} setAlpha={setAlpha} />
        <Preview $color={color} />
      </Grid>

      <SwatchGrid>
        {COLOR_PICKER_SWATCHES.map((swatchColor) => (
          <Swatch
            key={swatchColor}
            tabIndex={0}
            role="button"
            $color={swatchColor}
            title={swatchColor}
            onClick={() => setColor(swatchColor)}
            onKeyPress={({ key }) => key === "Enter" && setColor(swatchColor)}
          />
        ))}
      </SwatchGrid>

      <ColorIndicator>{color}</ColorIndicator>
    </Container>
  );
}
