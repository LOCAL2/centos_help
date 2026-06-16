// Browser-based terminal hook using LinuxEmulator (no backend/Docker required)
import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { LinuxEmulator } from '../lib/linuxEmulator';

export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>) {
  const terminalRef    = useRef<Terminal | null>(null);
  const fitAddonRef    = useRef<FitAddon | null>(null);
  const emulatorRef    = useRef<LinuxEmulator | null>(null);
  // Use a ref for isStarted to avoid stale closures inside onData
  const isStartedRef   = useRef(false);
  const [isStarted, setIsStarted] = useState(false);

  // ── init xterm instance (runs once) ──────────────────────────────────────
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
        black: '#1a1a2e',   red: '#f87171',   green: '#4ade80',
        yellow: '#facc15',  blue: '#60a5fa',  magenta: '#c084fc',
        cyan: '#22d3ee',    white: '#e2e8f0',
        brightBlack: '#374151',  brightRed: '#fca5a5',   brightGreen: '#86efac',
        brightYellow: '#fde047', brightBlue: '#93c5fd',  brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',   brightWhite: '#f9fafb',
      },
      scrollback: 10000,
      allowProposedApi: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    try { fitAddon.fit(); } catch {}

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
  }, [containerRef]);

  // ── start: show banner + register ONE onData handler ─────────────────────
  const start = useCallback(() => {
    // Guard: only start once
    if (isStartedRef.current) return;

    initTerminal();
    const term = terminalRef.current;
    if (!term) return;

    isStartedRef.current = true;
    setIsStarted(true);

    const emu = new LinuxEmulator();
    emulatorRef.current = emu;

    // Welcome banner
    term.writeln('\x1b[1;32m╔═══════════════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[1;32m║  \x1b[1;33m  เทอร์มินัล CentOS 7 Linux - ทดลองบน Browser  \x1b[1;32m  ║\x1b[0m');
    term.writeln('\x1b[1;32m║  \x1b[0;36m  พิมพ์ \'help\' เพื่อดูคำสั่งที่ใช้ได้             \x1b[1;32m  ║\x1b[0m');
    term.writeln('\x1b[1;32m║  \x1b[0;36m  60+ คำสั่ง Linux · pipe · redirect            \x1b[1;32m  ║\x1b[0m');
    term.writeln('\x1b[1;32m╚═══════════════════════════════════════════════════════╝\x1b[0m');
    term.writeln('');
    term.write(emu.prompt());

    // Mutable state lives in plain variables – not in React state
    // so the single closure below always sees the latest values
    let inputBuffer  = '';
    let historyIndex = -1;
    let tabCount     = 0;
    let lastTabInput = '';

    // ── single onData registration ──────────────────────────────────────────
    term.onData((data: string) => {
      const e = emulatorRef.current!;

      // ── control sequences ─────────────────────────────────────────────────
      switch (data) {
        case '\x0c': // Ctrl+L – clear screen
          term.clear();
          term.write(e.prompt());
          return;

        case '\x03': // Ctrl+C – interrupt
          term.writeln('^C');
          inputBuffer  = '';
          historyIndex = -1;
          term.write(e.prompt());
          return;

        case '\x04': // Ctrl+D – EOF
          if (!inputBuffer) term.writeln('logout');
          return;

        case '\x01': // Ctrl+A – start of line (no cursor movement yet)
          return;
        case '\x05': // Ctrl+E – end of line
          return;

        case '\x15': // Ctrl+U – clear line
          inputBuffer = '';
          term.write('\r\x1b[K' + e.prompt());
          return;

        case '\x0b': // Ctrl+K – clear to end
          return;

        case '\x17': { // Ctrl+W – delete last word
          const sp = inputBuffer.trimEnd().lastIndexOf(' ');
          inputBuffer = sp >= 0 ? inputBuffer.slice(0, sp + 1) : '';
          term.write('\r\x1b[K' + e.prompt() + inputBuffer);
          return;
        }

        case '\x7f': // Backspace
        case '\b':
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            term.write('\b \b');
          }
          return;

        case '\r': // Enter
        case '\n': {
          term.writeln('');
          const line = inputBuffer.trim();
          inputBuffer  = '';
          historyIndex = -1;
          tabCount     = 0;

          if (line) {
            e.state.history.push(line);
            const result = e.execute(line);
            if (result.output === '\x1b[2J\x1b[H') {
              term.clear();
            } else if (result.output === '\x1bc') {
              term.reset();
            } else if (result.output) {
              term.writeln(result.output);
            }
          }
          term.write(e.prompt());
          return;
        }
      }

      // ── escape sequences ──────────────────────────────────────────────────
      if (data === '\t') {
        const completions = e.tabComplete(inputBuffer);
        if (completions.length === 1) {
          const parts = inputBuffer.split(' ');
          parts[parts.length - 1] = completions[0];
          inputBuffer = parts.join(' ');
          term.write('\r\x1b[K' + e.prompt() + inputBuffer);
        } else if (completions.length > 1) {
          if (inputBuffer === lastTabInput && tabCount > 0) {
            term.writeln('');
            const maxLen = Math.max(...completions.map(c => c.length));
            const perRow = Math.max(1, Math.floor(80 / (maxLen + 2)));
            for (let i = 0; i < completions.length; i += perRow) {
              term.writeln(
                completions.slice(i, i + perRow).map(c => c.padEnd(maxLen + 2)).join('')
              );
            }
            term.write(e.prompt() + inputBuffer);
          } else {
            // fill common prefix
            const common = completions.reduce((a, b) => {
              let i = 0;
              while (i < a.length && i < b.length && a[i] === b[i]) i++;
              return a.slice(0, i);
            });
            const curPartial = inputBuffer.split(' ').pop() || '';
            if (common.length > curPartial.length) {
              const parts = inputBuffer.split(' ');
              parts[parts.length - 1] = common;
              inputBuffer = parts.join(' ');
              term.write('\r\x1b[K' + e.prompt() + inputBuffer);
            }
          }
          tabCount++;
          lastTabInput = inputBuffer;
        }
        return;
      }
      tabCount = 0;

      if (data === '\x1b[A') { // Arrow up
        const hist = e.state.history;
        if (!hist.length) return;
        if (historyIndex === -1) historyIndex = hist.length;
        if (historyIndex > 0) {
          historyIndex--;
          inputBuffer = hist[historyIndex];
          term.write('\r\x1b[K' + e.prompt() + inputBuffer);
        }
        return;
      }

      if (data === '\x1b[B') { // Arrow down
        const hist = e.state.history;
        if (historyIndex === -1) return;
        if (historyIndex < hist.length - 1) {
          historyIndex++;
          inputBuffer = hist[historyIndex];
        } else {
          historyIndex = -1;
          inputBuffer  = '';
        }
        term.write('\r\x1b[K' + e.prompt() + inputBuffer);
        return;
      }

      // Ignore other escape sequences (arrow left/right, Home, End, Del, etc.)
      if (data.startsWith('\x1b')) return;

      // ── printable character ───────────────────────────────────────────────
      inputBuffer += data;
      term.write(data);
    });
  }, [initTerminal]); // ← no isStarted in deps; guard via ref

  // ── reset session ─────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    emulatorRef.current = new LinuxEmulator();
    terminalRef.current?.clear();
    terminalRef.current?.writeln('\x1b[33mรีเซ็ต session แล้ว เริ่ม session ใหม่\x1b[0m');
    if (emulatorRef.current)
      terminalRef.current?.write(emulatorRef.current.prompt());
  }, []);

  // ── clear screen ─────────────────────────────────────────────────────────
  const clearTerminal = useCallback(() => {
    terminalRef.current?.clear();
    if (emulatorRef.current)
      terminalRef.current?.write(emulatorRef.current.prompt());
  }, []);

  // ── resize ────────────────────────────────────────────────────────────────
  const resize = useCallback(() => {
    if (!fitAddonRef.current) return;
    try { fitAddonRef.current.fit(); } catch {}
  }, []);

  // ── inject command from outside (Split View "Try in Terminal") ────────────
  const runCommand = useCallback((cmd: string) => {
    const term = terminalRef.current;
    const emu  = emulatorRef.current;
    if (!term || !emu) return;
    term.writeln('\x1b[90m' + emu.prompt() + cmd + '\x1b[0m');
    const result = emu.execute(cmd);
    if (result.output) term.writeln(result.output);
    term.write(emu.prompt());
  }, []);

  // ── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      terminalRef.current?.dispose();
      terminalRef.current  = null;
      isStartedRef.current = false;
    };
  }, []);

  return { isStarted, start, reset, clearTerminal, resize, runCommand };
}
