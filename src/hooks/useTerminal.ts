// Browser-based terminal hook using LinuxEmulator (no backend/Docker required)
import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { LinuxEmulator } from '../lib/linuxEmulator';

export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const emulatorRef = useRef<LinuxEmulator | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isStarted, setIsStarted] = useState(false);

  const initTerminal = useCallback(() => {
    if (!containerRef.current || terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
      theme: {
        background: '#0d1117',
        foreground: '#e2e8f0',
        cursor: '#4ade80',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f78',
        black: '#1a1a2e',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#374151',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f9fafb',
      },
      scrollback: 10000,
      allowProposedApi: true,
      convertEol: true,
      cols: 100,
      rows: 30,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    try { fitAddon.fit(); } catch {}

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    setIsReady(true);
  }, [containerRef]);

  const start = useCallback(() => {
    initTerminal();
    const term = terminalRef.current;
    if (!term || isStarted) return;

    const emu = new LinuxEmulator();
    emulatorRef.current = emu;

    // Welcome banner
    term.writeln('\x1b[1;32m╔═══════════════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[1;32m║   \x1b[1;33m CentOS 7 Linux Playground - Browser Terminal   \x1b[1;32m  ║\x1b[0m');
    term.writeln('\x1b[1;32m║   \x1b[0;36m Type \'help\' for available commands              \x1b[1;32m  ║\x1b[0m');
    term.writeln('\x1b[1;32m║   \x1b[0;36m 60+ real Linux commands supported               \x1b[1;32m  ║\x1b[0m');
    term.writeln('\x1b[1;32m╚═══════════════════════════════════════════════════════╝\x1b[0m');
    term.writeln('');
    term.write(emu.prompt());

    let inputBuffer = '';
    let historyIndex = -1;
    let tabPressCount = 0;
    let lastTabPartial = '';

    // Handle keyboard input
    term.onData((data) => {
      const emu = emulatorRef.current!;

      // Ctrl+L - clear
      if (data === '\x0c') {
        term.clear();
        term.write(emu.prompt());
        return;
      }
      // Ctrl+C - interrupt
      if (data === '\x03') {
        term.writeln('^C');
        inputBuffer = '';
        historyIndex = -1;
        term.write(emu.prompt());
        return;
      }
      // Ctrl+D - EOF (on empty line)
      if (data === '\x04') {
        if (!inputBuffer) {
          term.writeln('logout');
        }
        return;
      }
      // Ctrl+A - go to start
      if (data === '\x01') return;
      // Ctrl+E - go to end
      if (data === '\x05') return;
      // Ctrl+U - clear line
      if (data === '\x15') {
        term.write('\r\x1b[K' + emu.prompt());
        inputBuffer = '';
        return;
      }
      // Ctrl+K - clear from cursor to end
      if (data === '\x0b') return;
      // Ctrl+W - delete word
      if (data === '\x17') {
        const lastSpace = inputBuffer.trimEnd().lastIndexOf(' ');
        inputBuffer = lastSpace >= 0 ? inputBuffer.slice(0, lastSpace + 1) : '';
        term.write('\r\x1b[K' + emu.prompt() + inputBuffer);
        return;
      }

      // Tab completion
      if (data === '\t') {
        const completions = emu.tabComplete(inputBuffer);
        if (completions.length === 1) {
          const parts = inputBuffer.split(' ');
          parts[parts.length - 1] = completions[0];
          inputBuffer = parts.join(' ');
          term.write('\r\x1b[K' + emu.prompt() + inputBuffer);
        } else if (completions.length > 1) {
          if (inputBuffer === lastTabPartial && tabPressCount > 0) {
            // Show all completions
            term.writeln('');
            const maxLen = Math.max(...completions.map(c => c.length));
            const cols = Math.max(1, Math.floor(100 / (maxLen + 2)));
            for (let i = 0; i < completions.length; i += cols) {
              term.writeln(completions.slice(i, i + cols).map(c => c.padEnd(maxLen + 2)).join(''));
            }
            term.write(emu.prompt() + inputBuffer);
          } else {
            // Complete common prefix
            const common = completions.reduce((a, b) => {
              let i = 0;
              while (i < a.length && i < b.length && a[i] === b[i]) i++;
              return a.slice(0, i);
            });
            if (common.length > (inputBuffer.split(' ').pop() || '').length) {
              const parts = inputBuffer.split(' ');
              parts[parts.length - 1] = common;
              inputBuffer = parts.join(' ');
              term.write('\r\x1b[K' + emu.prompt() + inputBuffer);
            }
          }
          tabPressCount++;
          lastTabPartial = inputBuffer;
        }
        return;
      }
      tabPressCount = 0;

      // Enter
      if (data === '\r' || data === '\n') {
        term.writeln('');
        const line = inputBuffer.trim();
        inputBuffer = '';
        historyIndex = -1;

        if (line) {
          emu.state.history.push(line);
          const result = emu.execute(line);
          // Handle clear specially
          if (result.output === '\x1b[2J\x1b[H') {
            term.clear();
          } else if (result.output === '\x1bc') {
            term.reset();
          } else if (result.output) {
            term.writeln(result.output);
          }
        }
        term.write(emu.prompt());
        return;
      }

      // Backspace
      if (data === '\x7f' || data === '\b') {
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
          term.write('\b \b');
        }
        return;
      }

      // Arrow up - history
      if (data === '\x1b[A') {
        const history = emu.state.history;
        if (history.length === 0) return;
        if (historyIndex === -1) historyIndex = history.length;
        if (historyIndex > 0) {
          historyIndex--;
          inputBuffer = history[historyIndex];
          term.write('\r\x1b[K' + emu.prompt() + inputBuffer);
        }
        return;
      }

      // Arrow down - history
      if (data === '\x1b[B') {
        const history = emu.state.history;
        if (historyIndex === -1) return;
        if (historyIndex < history.length - 1) {
          historyIndex++;
          inputBuffer = history[historyIndex];
        } else {
          historyIndex = -1;
          inputBuffer = '';
        }
        term.write('\r\x1b[K' + emu.prompt() + inputBuffer);
        return;
      }

      // Arrow left / right - ignore for now (no cursor movement in buffer)
      if (data === '\x1b[C' || data === '\x1b[D') return;

      // Home / End keys
      if (data === '\x1b[H' || data === '\x1b[F') return;

      // Delete key
      if (data === '\x1b[3~') return;

      // Skip other escape sequences
      if (data.startsWith('\x1b')) return;

      // Normal printable character
      inputBuffer += data;
      term.write(data);
    });

    setIsStarted(true);
  }, [initTerminal, isStarted]);

  const reset = useCallback(() => {
    emulatorRef.current = new LinuxEmulator();
    terminalRef.current?.clear();
    terminalRef.current?.writeln('\x1b[33mTerminal reset. New session started.\x1b[0m');
    terminalRef.current?.write(emulatorRef.current.prompt());
  }, []);

  const clearTerminal = useCallback(() => {
    terminalRef.current?.clear();
    if (emulatorRef.current) {
      terminalRef.current?.write(emulatorRef.current.prompt());
    }
  }, []);

  const resize = useCallback(() => {
    if (!fitAddonRef.current || !terminalRef.current) return;
    try { fitAddonRef.current.fit(); } catch {}
  }, []);

  // Inject a command from outside (e.g., "Try in Terminal" button)
  const runCommand = useCallback((cmd: string) => {
    const term = terminalRef.current;
    const emu = emulatorRef.current;
    if (!term || !emu) return;
    term.writeln('\x1b[90m' + emu.prompt() + cmd + '\x1b[0m');
    const result = emu.execute(cmd);
    if (result.output) term.writeln(result.output);
    term.write(emu.prompt());
  }, []);

  useEffect(() => {
    return () => {
      terminalRef.current?.dispose();
    };
  }, []);

  return { isReady, isStarted, start, reset, clearTerminal, resize, runCommand };
}
