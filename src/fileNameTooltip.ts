export type FileNameTooltipRect = {
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

export function fileNameTextIsTruncated({
  clientWidth,
  scrollWidth,
}: {
  clientWidth: number;
  scrollWidth: number;
}) {
  return scrollWidth > clientWidth + 1;
}

export function fileNameTooltipPosition({
  anchorRect,
  gap = 8,
  tooltipRect,
  viewportMargin = 8,
  viewportRect,
}: {
  anchorRect: Pick<FileNameTooltipRect, "right" | "top">;
  gap?: number;
  tooltipRect: Pick<FileNameTooltipRect, "height" | "width">;
  viewportMargin?: number;
  viewportRect: Pick<FileNameTooltipRect, "bottom" | "left" | "right" | "top">;
}) {
  const minLeft = viewportRect.left + viewportMargin;
  const maxLeft = viewportRect.right - viewportMargin - tooltipRect.width;
  const minTop = viewportRect.top + viewportMargin;
  const maxTop = viewportRect.bottom - viewportMargin - tooltipRect.height;

  return {
    left: Math.round(
      maxLeft >= minLeft ? clamp(anchorRect.right + gap, minLeft, maxLeft) : minLeft,
    ),
    top: Math.round(
      maxTop >= minTop ? clamp(anchorRect.top, minTop, maxTop) : minTop,
    ),
  };
}
