export type FloatingNoteAnchorRect = {
  bottom: number;
  top: number;
  targetBottom: number;
  targetX: number;
};

export type FloatingNoteViewportRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type AnchoredFloatingNoteGeometry = {
  connector: {
    angle: number;
    left: number;
    top: number;
    width: number;
  };
  left: number;
  placement: "above" | "below";
  top: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function anchoredFloatingNoteGeometry({
  anchorRect,
  cardHeight,
  cardWidth,
  connectorGap = 18,
  flipAboveWhenNeeded = false,
  lockedPlacement,
  panelEdgeOffset,
  viewportMargin,
  viewportRect,
}: {
  anchorRect: FloatingNoteAnchorRect;
  cardHeight: number;
  cardWidth: number;
  connectorGap?: number;
  flipAboveWhenNeeded?: boolean;
  lockedPlacement?: "above" | "below";
  panelEdgeOffset?: number;
  viewportMargin: number;
  viewportRect: FloatingNoteViewportRect;
}): AnchoredFloatingNoteGeometry {
  const maxPanelLeft = viewportRect.right - viewportMargin - cardWidth;
  const minPanelLeft = viewportRect.left + viewportMargin;
  const preferredLeft = clamp(
    anchorRect.targetX - cardWidth / 2,
    minPanelLeft,
    maxPanelLeft,
  );
  const left = maxPanelLeft >= minPanelLeft ? preferredLeft : minPanelLeft;
  const right = left + cardWidth;
  const belowTop = anchorRect.bottom + connectorGap;
  const belowFits =
    belowTop + cardHeight <= viewportRect.bottom - viewportMargin;
  const placement =
    lockedPlacement ?? (flipAboveWhenNeeded && !belowFits ? "above" : "below");
  const preferredTop =
    panelEdgeOffset === undefined
      ? placement === "above"
        ? anchorRect.top - connectorGap - cardHeight
        : belowTop
      : placement === "above"
        ? anchorRect.top + panelEdgeOffset - cardHeight
        : anchorRect.bottom + panelEdgeOffset;
  const minPanelTop = viewportRect.top + viewportMargin;
  const maxPanelTop = viewportRect.bottom - viewportMargin - cardHeight;
  const top =
    panelEdgeOffset === undefined &&
    flipAboveWhenNeeded &&
    maxPanelTop >= minPanelTop
      ? clamp(preferredTop, minPanelTop, maxPanelTop)
      : preferredTop;
  const anchorY = placement === "above" ? anchorRect.top : anchorRect.bottom;
  const panelEdgeY = placement === "above" ? top + cardHeight : top;
  const sourceX = clamp(anchorRect.targetX, left, right);
  const connectorDeltaX = sourceX - anchorRect.targetX;
  const connectorDeltaY = panelEdgeY - anchorY;

  return {
    connector: {
      angle:
        Math.round(Math.atan2(connectorDeltaY, connectorDeltaX) * (180 / Math.PI) * 100) /
        100,
      left: Math.round(anchorRect.targetX),
      top: Math.round(anchorY),
      width: Math.round(
        Math.sqrt(
          connectorDeltaX * connectorDeltaX + connectorDeltaY * connectorDeltaY,
        ),
      ),
    },
    left,
    placement,
    top,
  };
}
