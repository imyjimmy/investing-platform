import { useRef, useState } from "react";

type Props = {
  label: string;
  controls: string;
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  side?: "left" | "right";
  onResize: (width: number) => void;
};

export function PanelResizeHandle({
  label,
  controls,
  width,
  min,
  max,
  defaultWidth,
  side = "left",
  onResize,
}: Props) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const resize = (next: number) => onResize(Math.min(max, Math.max(min, next)));
  return (
    <div
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      className={`panel-resize-handle ${dragging ? "is-dragging" : ""}`}
      role="separator"
      tabIndex={0}
      title="Drag to resize · Double-click to reset"
      onDoubleClick={() => resize(defaultWidth)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          resize(
            drag.current.width +
              (event.clientX - drag.current.x) * (side === "left" ? 1 : -1),
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        setDragging(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        if (event.key === "Home") resize(min);
        else if (event.key === "End") resize(max);
        else
          resize(
            width +
              (event.key === "ArrowRight" ? 16 : -16) *
                (side === "left" ? 1 : -1),
          );
      }}
    />
  );
}
