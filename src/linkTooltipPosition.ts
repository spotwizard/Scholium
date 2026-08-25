export type LinkTooltipRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function linkTooltipPositionWithinBounds({
  bounds,
  margin = 8,
  tooltip,
}: {
  bounds: LinkTooltipRect;
  margin?: number;
  tooltip: LinkTooltipRect;
}) {
  const maxWidth = Math.max(0, bounds.width - margin * 2);
  const width = Math.min(tooltip.width, maxWidth);
  const minLeft = bounds.left + margin;
  const maxLeft = Math.max(minLeft, bounds.right - margin - width);
  const minTop = bounds.top + margin;
  const maxTop = Math.max(minTop, bounds.bottom - margin - tooltip.height);

  return {
    left: clamp(tooltip.left, minLeft, maxLeft),
    maxWidth,
    top: clamp(tooltip.top, minTop, maxTop),
  };
}
