import { useEffect, useRef, useState } from "react";
import { scrollMetrics } from "../lib/scroll";
import "./water-scroll.css";
export function WaterScroll() {
  const rail = useRef<HTMLDivElement>(null),
    [metrics, setMetrics] = useState({
      progress: 0,
      thumb: 36,
      offset: 0,
      range: 0,
    });
  const dragging = useRef(false);
  const grabOffset = useRef(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = document.documentElement;
        const next = scrollMetrics(
          window.scrollY,
          window.innerHeight,
          root.scrollHeight,
          rail.current?.clientHeight || 400,
        );
        setMetrics(next);
        root.classList.toggle("water-scroll-ready", next.range > 0);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    const content = document.getElementById("root");
    if (content) observer.observe(content);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(frame);
      document.documentElement.classList.remove("water-scroll-ready");
    };
  }, []);
  function seek(y: number) {
    const rect = rail.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = Math.min(
      1,
      Math.max(
        0,
        (y - rect.top - grabOffset.current) /
          Math.max(1, rect.height - metrics.thumb),
      ),
    );
    window.scrollTo({ top: fraction * metrics.range, behavior: "instant" });
  }
  return (
    <div
      ref={rail}
      className={`water-scroll ${metrics.range ? "is-scrollable" : ""}`}
      role="scrollbar"
      aria-label="Page scroll position"
      aria-controls="root"
      aria-hidden={!metrics.range}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(metrics.progress * 100)}
      tabIndex={metrics.range ? 0 : -1}
      onKeyDown={(event) => {
        const positions: Record<string, number> = {
          Home: 0,
          End: metrics.range,
          ArrowDown: window.scrollY + 60,
          ArrowUp: window.scrollY - 60,
          PageDown: window.scrollY + window.innerHeight * 0.85,
          PageUp: window.scrollY - window.innerHeight * 0.85,
        };
        if (event.key in positions) {
          event.preventDefault();
          window.scrollTo({ top: positions[event.key], behavior: "instant" });
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        dragging.current = true;
        const rect = event.currentTarget.getBoundingClientRect();
        grabOffset.current = (event.target as Element).closest(
          ".water-scroll-thumb",
        )
          ? event.clientY - rect.top - metrics.offset
          : metrics.thumb / 2;
        event.currentTarget.setPointerCapture(event.pointerId);
        seek(event.clientY);
      }}
      onPointerMove={(event) => {
        if (dragging.current) seek(event.clientY);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <span className="water-scroll-track" aria-hidden="true">
        <span
          className="water-scroll-fill"
          style={{ height: `${metrics.progress * 100}%` }}
        />
        <span
          className="water-scroll-thumb"
          style={{
            height: metrics.thumb,
            transform: `translateY(${metrics.offset}px)`,
          }}
        >
          <i />
          <i />
        </span>
      </span>
      <span className="water-scroll-percentage" aria-hidden="true">
        {Math.round(metrics.progress * 100)}%
      </span>
    </div>
  );
}
