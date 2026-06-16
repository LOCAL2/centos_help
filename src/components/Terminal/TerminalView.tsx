import { useRef, useEffect, useState } from 'react';
import { Terminal as TermIcon, Power, RefreshCw, Expand, Minimize2, Trash2 } from 'lucide-react';
import { useTerminal } from '../../hooks/useTerminal';
import 'xterm/css/xterm.css';

interface TerminalViewProps {
  embedded?: boolean;
  /** If provided, this command will be run once the terminal starts */
  initialCommand?: string;
}

export function TerminalView({ embedded = false, initialCommand }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { isStarted, start, reset, clearTerminal, resize, runCommand } = useTerminal(containerRef);

  // Auto-resize on layout changes
  useEffect(() => {
    const ro = new ResizeObserver(() => resize());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [resize]);

  useEffect(() => {
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  // Run initial command once terminal is started (used from Split View)
  useEffect(() => {
    if (isStarted && initialCommand) {
      const timer = setTimeout(() => runCommand(initialCommand), 200);
      return () => clearTimeout(timer);
    }
  }, [isStarted, initialCommand, runCommand]);

  const handleFullscreen = () => {
    if (!document.fullscreenElement && wrapperRef.current) {
      wrapperRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Listen for fullscreen change (e.g. user presses Esc)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`terminal-wrapper${embedded ? ' terminal-wrapper--embedded' : ''}${isFullscreen ? ' terminal-wrapper--fullscreen' : ''}`}
    >
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-left">
          {/* macOS-style dots */}
          <span className="terminal-dot terminal-dot--red" />
          <span className="terminal-dot terminal-dot--yellow" />
          <span className="terminal-dot terminal-dot--green" />
          <TermIcon size={14} className="terminal-icon" />
          <span className="terminal-title">user@centos-playground</span>
          {isStarted && <span className="terminal-badge terminal-badge--live">● เชื่อมต่อ</span>}
        </div>
        <div className="terminal-toolbar-right">
          <button
            className="terminal-btn"
            onClick={clearTerminal}
            title="ล้างหน้าจอ (Ctrl+L)"
            aria-label="ล้างหน้าจอ"
            disabled={!isStarted}
          >
            <Trash2 size={13} />
          </button>
          <button
            className="terminal-btn"
            onClick={reset}
            title="รีเซ็ต session"
            aria-label="รีเซ็ต session"
            disabled={!isStarted}
          >
            <RefreshCw size={13} />
          </button>
          <button
            className="terminal-btn"
            onClick={handleFullscreen}
            title="เต็มจอ"
            aria-label="เต็มจอ"
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Expand size={13} />}
          </button>
        </div>
      </div>

      {/* xterm.js mounts here */}
      <div className="terminal-container" ref={containerRef} />

      {/* Overlay shown before terminal is started */}
      {!isStarted && (
        <div className="terminal-overlay">
          <div className="terminal-overlay-content">
            <TermIcon size={52} className="terminal-overlay-icon" />
            <h3>เทอร์มินัล CentOS Linux</h3>
            <p>จำลอง CentOS 7 ทำงานใน browser ได้เลย ไม่ต้องติดตั้ง</p>
            <p className="terminal-overlay-sub">
              60+ คำสั่งจริง · ระบบไฟล์เสมือน · pipe & redirect
            </p>
            <button className="terminal-start-btn" onClick={start} autoFocus>
              <Power size={16} />
              เปิดเทอร์มินัล
            </button>
            <div className="terminal-shortcuts">
              <span><kbd>Ctrl+L</kbd> ล้างหน้าจอ</span>
              <span><kbd>Ctrl+C</kbd> หยุด</span>
              <span><kbd>Tab</kbd> เติมคำ</span>
              <span><kbd>↑↓</kbd> ประวัติ</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
