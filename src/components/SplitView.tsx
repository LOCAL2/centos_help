import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CommandDetail } from './CommandDetail';
import { CommandLibrary } from './CommandLibrary';
import { TerminalView } from './Terminal/TerminalView';

export function SplitView() {
  const { id } = useParams<{ id?: string }>();
  const [leftWidth, setLeftWidth] = useState(50); // percent
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftWidth(Math.max(20, Math.min(80, pct)));
  }, []);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  if (isMobile) {
    return (
      <div className="split-view-mobile">
        <div className="split-mobile-left">
          {id ? <CommandDetail commandId={id} embedded /> : <CommandLibrary />}
        </div>
        <div className="split-mobile-right">
          <TerminalView embedded />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="split-view">
      <div className="split-panel split-panel--left" style={{ width: `${leftWidth}%` }}>
        {id ? <CommandDetail commandId={id} embedded /> : <CommandLibrary />}
      </div>

      <div
        className="split-divider"
        onMouseDown={onMouseDown}
        title="Drag to resize"
        role="separator"
        aria-label="Resize panels"
      >
        <div className="split-divider-handle" />
      </div>

      <div className="split-panel split-panel--right" style={{ width: `${100 - leftWidth}%` }}>
        <TerminalView embedded />
      </div>
    </div>
  );
}
