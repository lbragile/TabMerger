import { useEffect, useState } from "react";
import styled from "styled-components";

import Alpha from "./Alpha";
import Hue from "./Hue";
import Preview from "./Preview";
import Sketch from "./Sketch";

import { COLOR_PICKER_SWATCHES } from "~/constants/colorPicker";
import { extractRGBAFromStr, RGBtoHSV } from "~/utils/colorConvert";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 0 4px 0 black;
  padding: 4px;
  max-width: 208px;
  background-color: white;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px;
  grid-template-areas:
    "hue preview"
    "alpha preview";

  & .picker-hue {
    grid-area: hue;
  }

  & .picker-alpha {
    grid-area: alpha;
  }

  & .picker-preview {
    grid-area: preview;
    cursor: default;
  }
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
  const [hue, setHue] = useState(0);
  const [alpha, setAlpha] = useState(1);

  useEffect(() => {
    const [r, g, b, a] = extractRGBAFromStr(color);

    // Cannot determine hue if the color is grayscale (r = g = b)
    if (r !== g || r !== b || g !== b) {
      const { h } = RGBtoHSV({ r, g, b });
      setHue(Number(h));
    }

    setAlpha(a);
  }, [color]);

  return (
    <Container>
      <Sketch hue={hue} alpha={alpha} color={color} setColor={setColor} />

      <Grid>
        <Hue hue={hue} setHue={setHue} />
        <Alpha alpha={alpha} hue={hue} setAlpha={setAlpha} />
        <Preview color={color} />
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
