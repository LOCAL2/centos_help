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
          {isStarted && <span className="terminal-badge terminal-badge--live">● LIVE</span>}
        </div>
        <div className="terminal-toolbar-right">
          <button
            className="terminal-btn"
            onClick={clearTerminal}
            title="Clear (Ctrl+L)"
            aria-label="Clear terminal"
            disabled={!isStarted}
          >
            <Trash2 size={13} />
          </button>
          <button
            className="terminal-btn"
            onClick={reset}
            title="Reset session"
            aria-label="Reset terminal session"
            disabled={!isStarted}
          >
            <RefreshCw size={13} />
          </button>
          <button
            className="terminal-btn"
            onClick={handleFullscreen}
            title="Toggle fullscreen (F11)"
            aria-label="Toggle fullscreen"
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
            <h3>CentOS Linux Terminal</h3>
            <p>A fully emulated CentOS 7 environment running entirely in your browser.</p>
            <p className="terminal-overlay-sub">
              60+ real commands · virtual filesystem · pipes & redirects
            </p>
            <button className="terminal-start-btn" onClick={start} autoFocus>
              <Power size={16} />
              Launch Terminal
            </button>
            <div className="terminal-shortcuts">
              <span><kbd>Ctrl+L</kbd> clear</span>
              <span><kbd>Ctrl+C</kbd> interrupt</span>
              <span><kbd>Tab</kbd> complete</span>
              <span><kbd>↑↓</kbd> history</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
