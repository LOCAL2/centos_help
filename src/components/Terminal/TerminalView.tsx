import { useRef, useEffect } from 'react';
import { Terminal as TermIcon, Power, PowerOff, Expand, Minimize2, Trash2, Copy } from 'lucide-react';
import { useTerminal } from '../../hooks/useTerminal';
import 'xterm/css/xterm.css';

interface TerminalViewProps {
  embedded?: boolean;
}

export function TerminalView({ embedded = false }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { session, isConnecting, error, connect, disconnect, resize, clearTerminal } = useTerminal(containerRef);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => { resize(); });
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [resize]);

  useEffect(() => {
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  const isConnected = session?.status === 'connected';
  const isDisconnected = !session || session.status === 'disconnected' || session.status === 'error';

  const handleFullscreen = () => {
    if (!document.fullscreenElement && wrapperRef.current) {
      wrapperRef.current.requestFullscreen();
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  };

  const handleCopySelection = () => {
    const selection = window.getSelection()?.toString();
    if (selection) navigator.clipboard.writeText(selection).catch(() => {});
  };

  const getStatusClass = () => {
    if (isConnecting) return 'status-indicator--connecting';
    if (isConnected) return 'status-indicator--connected';
    return 'status-indicator--disconnected';
  };

  const getStatusText = () => {
    if (isConnecting) return 'Connecting...';
    if (isConnected) return session.sessionId === 'mock' ? 'Mock Mode' : 'Connected';
    return 'Disconnected';
  };

  return (
    <div ref={wrapperRef} className={`terminal-wrapper${embedded ? ' terminal-wrapper--embedded' : ''}`}>
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-left">
          <TermIcon size={16} className="terminal-icon" />
          <span className="terminal-title">CentOS Terminal</span>
          <span className={`status-indicator ${getStatusClass()}`} />
          <span className="terminal-status-text">{getStatusText()}</span>
          {error && <span className="terminal-error-badge" title={error}>⚠ Docker unavailable (Mock mode)</span>}
        </div>
        <div className="terminal-toolbar-right">
          <button
            className="terminal-btn"
            onClick={clearTerminal}
            title="Clear terminal"
            aria-label="Clear terminal"
          >
            <Trash2 size={14} />
          </button>
          <button
            className="terminal-btn"
            onClick={handleCopySelection}
            title="Copy selection"
            aria-label="Copy selection"
          >
            <Copy size={14} />
          </button>
          <button
            className="terminal-btn"
            onClick={handleFullscreen}
            title="Toggle fullscreen"
            aria-label="Toggle fullscreen"
          >
            {document.fullscreenElement ? <Minimize2 size={14} /> : <Expand size={14} />}
          </button>
          {isDisconnected ? (
            <button
              className="terminal-connect-btn terminal-connect-btn--connect"
              onClick={connect}
              disabled={isConnecting}
              aria-label="Connect to terminal"
            >
              <Power size={14} />
              <span>{isConnecting ? 'Connecting...' : 'Connect'}</span>
            </button>
          ) : (
            <button
              className="terminal-connect-btn terminal-connect-btn--disconnect"
              onClick={disconnect}
              aria-label="Disconnect terminal"
            >
              <PowerOff size={14} />
              <span>Disconnect</span>
            </button>
          )}
        </div>
      </div>

      <div className="terminal-container" ref={containerRef} />

      {isDisconnected && !isConnecting && (
        <div className="terminal-overlay">
          <div className="terminal-overlay-content">
            <TermIcon size={48} className="terminal-overlay-icon" />
            <h3>CentOS 7 Terminal</h3>
            <p>Start a live CentOS session in a Docker container.</p>
            <p className="terminal-overlay-sub">If Docker is unavailable, a mock terminal will be used.</p>
            <button className="terminal-start-btn" onClick={connect}>
              <Power size={16} />
              Start Terminal
            </button>
            <div className="terminal-shortcuts">
              <span><kbd>Ctrl+C</kbd> interrupt</span>
              <span><kbd>Ctrl+L</kbd> clear</span>
              <span><kbd>Tab</kbd> complete</span>
              <span><kbd>↑↓</kbd> history</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
