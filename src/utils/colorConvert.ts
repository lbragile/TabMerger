/**
 * @see https://www.rapidtables.com/convert/color/hsv-to-rgb.html
 */
export function HSVtoRGB({ h, s, v }: { h: number; s: number; v: number }): { r: string; g: string; b: string } {
  const C = v * s;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - C;

  const Rp = h < 60 || (300 <= h && h < 360) ? C : 120 <= h && h < 240 ? 0 : X;
  const Gp = 240 <= h && h < 360 ? 0 : 60 <= h && h < 180 ? C : X;
  const Bp = h < 120 ? 0 : 180 <= h && h < 300 ? C : X;

  const [r, g, b] = [Rp, Gp, Bp].map((val) => ((val + m) * 255).toFixed(2));

  return { r, g, b };
}

/**
 * @see https://www.rapidtables.com/convert/color/rgb-to-hsv.html
 */
export function RGBtoHSV({ r, g, b }: { r: number; g: number; b: number }): { h: string; s: string; v: string } {
  const [Rp, Gp, Bp] = [r, g, b].map((val) => val / 255);

  const cMax = Math.max(Rp, Gp, Bp);
  const cMin = Math.min(Rp, Gp, Bp);
  const delta = cMax - cMin;

  const H =
    delta === 0
      ? 0
      : cMax === Rp
      ? ((Gp - Bp) / delta) % 6
      : cMax === Gp
      ? (Bp - Rp) / delta + 2
      : (Rp - Gp) / delta + 4;

  const S = delta === 0 ? 0 : delta / cMax;

  const modHue = (H * 60) % 360;
  const newHue = modHue < 0 ? modHue + 360 : modHue;

  const [h, s, v] = [newHue, S, cMax].map((val) => val.toFixed(2));

  return { h, s, v };
}

export const extractRGBAFromStr = (colorStr: string): number[] => {
  return colorStr
    .replace(/^rgba\((.+?), (.+?), (.+?), (.+?)\)$/, "$1,$2,$3,$4")
    .split(",")
    .map((val) => Number(val));
};
