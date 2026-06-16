// Browser-based Linux command emulator
import { VirtualFS, VFSNode } from './linuxFs';

export interface EmulatorState {
  cwd: string;
  user: string;
  hostname: string;
  env: Record<string, string>;
  history: string[];
  historyIndex: number;
  aliases: Record<string, string>;
  lastExitCode: number;
}

export interface CommandResult {
  output: string;    // already ANSI-escaped lines joined by \r\n
  exitCode: number;
}

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  boldGreen: '\x1b[1;32m',
  boldBlue: '\x1b[1;34m',
  boldCyan: '\x1b[1;36m',
  boldYellow: '\x1b[1;33m',
};

export class LinuxEmulator {
  public fs: VirtualFS;
  public state: EmulatorState;

  constructor() {
    this.fs = new VirtualFS();
    this.state = {
      cwd: '/home/user',
      user: 'user',
      hostname: 'centos-playground',
      env: {
        HOME: '/home/user',
        USER: 'user',
        SHELL: '/bin/bash',
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        PWD: '/home/user',
        OLDPWD: '/home/user',
        HOSTNAME: 'centos-playground',
        LOGNAME: 'user',
        MAIL: '/var/spool/mail/user',
        _: '/bin/bash',
      },
      history: [],
      historyIndex: -1,
      aliases: { ll: 'ls -alF', la: 'ls -A', l: 'ls -CF' },
      lastExitCode: 0,
    };
  }

  prompt(): string {
    const shortCwd = this.state.cwd.replace('/home/user', '~');
    const u = this.state.user === 'root' ? C.boldGreen + 'root' : C.boldGreen + this.state.user;
    const h = C.boldGreen + this.state.hostname + C.reset;
    const d = C.boldBlue + shortCwd + C.reset;
    const sym = this.state.user === 'root' ? '#' : '$';
    return `${u}${C.reset}@${h}:${d}${C.reset}${sym} `;
  }

  // Main entry point: parse and run a full command line (handles pipes, redirects, &&, ||, ;)
  execute(line: string): CommandResult {
    line = this.expandVariables(line.trim());
    if (!line) return { output: '', exitCode: 0 };
    this.state.history.push(line);

    // Handle ; separated commands
    if (line.includes(';')) {
      const parts = this.splitUnquoted(line, ';');
      let out = '';
      let code = 0;
      for (const p of parts) {
        const r = this.execute(p.trim());
        if (r.output) out += (out ? '\r\n' : '') + r.output;
        code = r.exitCode;
      }
      return { output: out, exitCode: code };
    }

    // Handle && 
    if (line.includes(' && ')) {
      const parts = this.splitUnquoted(line, ' && ');
      let out = '';
      for (const p of parts) {
        const r = this.execute(p.trim());
        if (r.output) out += (out ? '\r\n' : '') + r.output;
        if (r.exitCode !== 0) return { output: out, exitCode: r.exitCode };
      }
      return { output: out, exitCode: 0 };
    }

    // Handle ||
    if (line.includes(' || ')) {
      const parts = this.splitUnquoted(line, ' || ');
      let out = '';
      for (const p of parts) {
        const r = this.execute(p.trim());
        if (r.output) out += (out ? '\r\n' : '') + r.output;
        if (r.exitCode === 0) return { output: out, exitCode: 0 };
      }
      return { output: out, exitCode: 1 };
    }

    // Handle pipes
    if (line.includes(' | ')) {
      return this.executePipeline(line);
    }

    // Handle redirects
    const { cmd, redirects } = this.parseRedirects(line);
    const result = this.runSingle(cmd);

    for (const red of redirects) {
      const path = this.fs.resolve(red.file, this.state.cwd);
      if (red.type === '>') {
        this.fs.writeFile(path, result.output.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n') + '\n');
        return { output: '', exitCode: result.exitCode };
      } else if (red.type === '>>') {
        this.fs.appendFile(path, result.output.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n') + '\n');
        return { output: '', exitCode: result.exitCode };
      }
    }

    return result;
  }

  private executePipeline(line: string): CommandResult {
    const stages = line.split(' | ').map(s => s.trim());
    let stdin = '';
    let result: CommandResult = { output: '', exitCode: 0 };
    for (const stage of stages) {
      result = this.runSingle(stage, stdin);
      stdin = result.output.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n');
    }
    return result;
  }

  private parseRedirects(line: string): { cmd: string; redirects: { type: string; file: string }[] } {
    const redirects: { type: string; file: string }[] = [];
    let cmd = line;
    const redirRe = /\s*(>>|>|<)\s*(\S+)/g;
    let m: RegExpExecArray | null;
    const clean: string[] = [];
    let lastIdx = 0;
    while ((m = redirRe.exec(line)) !== null) {
      clean.push(line.slice(lastIdx, m.index));
      redirects.push({ type: m[1], file: m[2] });
      lastIdx = m.index + m[0].length;
    }
    if (redirects.length) cmd = clean.join('').trim();
    return { cmd, redirects };
  }

  private expandVariables(line: string): string {
    return line
      .replace(/\$\{(\w+)\}/g, (_, k) => this.state.env[k] ?? '')
      .replace(/\$(\w+)/g, (_, k) => {
        if (k === '?') return String(this.state.lastExitCode);
        if (k === 'HOME') return '/home/user';
        if (k === 'PWD') return this.state.cwd;
        return this.state.env[k] ?? '';
      })
      .replace(/\$\(\((.*?)\)\)/g, (_, expr) => {
        try { return String(eval(expr)); } catch { return '0'; }
      });
  }

  private splitUnquoted(str: string, sep: string): string[] {
    const results: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      if (!inSingle && !inDouble && str.startsWith(sep, i)) {
        results.push(current);
        current = '';
        i += sep.length - 1;
      } else current += ch;
    }
    results.push(current);
    return results;
  }

  private parseArgs(line: string): string[] {
    const args: string[] = [];
    let cur = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
      if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
      if (ch === ' ' && !inSingle && !inDouble) {
        if (cur) { args.push(cur); cur = ''; }
      } else cur += ch;
    }
    if (cur) args.push(cur);
    return args;
  }

  // Run a single command (no pipes/redirects)
  private runSingle(line: string, stdin = ''): CommandResult {
    const args = this.parseArgs(line.trim());
    if (!args.length) return { output: '', exitCode: 0 };

    // Expand aliases
    let cmd = args[0];
    if (this.state.aliases[cmd]) {
      const aliasExpanded = this.state.aliases[cmd] + (args.length > 1 ? ' ' + args.slice(1).join(' ') : '');
      return this.execute(aliasExpanded);
    }

    // Expand globs in args
    const expandedArgs = [cmd, ...args.slice(1).flatMap(a => {
      const g = this.fs.glob(a, this.state.cwd);
      return g.length ? g : [a];
    })];

    // Handle assignment (VAR=value)
    if (/^\w+=/.test(cmd) && !cmd.startsWith('-')) {
      const [key, ...rest] = cmd.split('=');
      this.state.env[key] = rest.join('=');
      return { output: '', exitCode: 0 };
    }

    const dispatch: Record<string, () => CommandResult> = {
      ls: () => this.cmdLs(expandedArgs),
      dir: () => this.cmdLs(expandedArgs),
      ll: () => this.cmdLs(['ls', '-la', ...expandedArgs.slice(1)]),
      cd: () => this.cmdCd(expandedArgs),
      pwd: () => this.cmdPwd(),
      mkdir: () => this.cmdMkdir(expandedArgs),
      rmdir: () => this.cmdRmdir(expandedArgs),
      rm: () => this.cmdRm(expandedArgs),
      cp: () => this.cmdCp(expandedArgs),
      mv: () => this.cmdMv(expandedArgs),
      touch: () => this.cmdTouch(expandedArgs),
      cat: () => this.cmdCat(expandedArgs, stdin),
      tac: () => this.cmdTac(expandedArgs, stdin),
      head: () => this.cmdHead(expandedArgs, stdin),
      tail: () => this.cmdTail(expandedArgs, stdin),
      less: () => this.cmdCat(expandedArgs, stdin),
      more: () => this.cmdCat(expandedArgs, stdin),
      echo: () => this.cmdEcho(expandedArgs),
      printf: () => this.cmdPrintf(expandedArgs),
      grep: () => this.cmdGrep(expandedArgs, stdin),
      egrep: () => this.cmdGrep(['grep', '-E', ...expandedArgs.slice(1)], stdin),
      fgrep: () => this.cmdGrep(['grep', '-F', ...expandedArgs.slice(1)], stdin),
      sed: () => this.cmdSed(expandedArgs, stdin),
      awk: () => this.cmdAwk(expandedArgs, stdin),
      sort: () => this.cmdSort(expandedArgs, stdin),
      uniq: () => this.cmdUniq(expandedArgs, stdin),
      wc: () => this.cmdWc(expandedArgs, stdin),
      cut: () => this.cmdCut(expandedArgs, stdin),
      tr: () => this.cmdTr(expandedArgs, stdin),
      diff: () => this.cmdDiff(expandedArgs),
      find: () => this.cmdFind(expandedArgs),
      locate: () => this.cmdLocate(expandedArgs),
      which: () => this.cmdWhich(expandedArgs),
      whereis: () => this.cmdWhereis(expandedArgs),
      type: () => this.cmdType(expandedArgs),
      stat: () => this.cmdStat(expandedArgs),
      file: () => this.cmdFile(expandedArgs),
      chmod: () => this.cmdChmod(expandedArgs),
      chown: () => this.cmdChown(expandedArgs),
      chgrp: () => this.cmdChgrp(expandedArgs),
      umask: () => this.cmdUmask(expandedArgs),
      ln: () => this.cmdLn(expandedArgs),
      uname: () => this.cmdUname(expandedArgs),
      hostname: () => this.cmdHostname(expandedArgs),
      whoami: () => ({ output: this.state.user, exitCode: 0 }),
      id: () => this.cmdId(),
      date: () => this.cmdDate(expandedArgs),
      cal: () => this.cmdCal(expandedArgs),
      uptime: () => this.cmdUptime(),
      df: () => this.cmdDf(expandedArgs),
      du: () => this.cmdDu(expandedArgs),
      free: () => this.cmdFree(expandedArgs),
      lscpu: () => this.cmdLscpu(),
      lsblk: () => this.cmdLsblk(),
      ps: () => this.cmdPs(expandedArgs),
      top: () => this.cmdTop(),
      kill: () => this.cmdKill(expandedArgs),
      killall: () => this.cmdKillall(expandedArgs),
      pgrep: () => this.cmdPgrep(expandedArgs),
      sleep: () => ({ output: '', exitCode: 0 }),
      ping: () => this.cmdPing(expandedArgs),
      curl: () => this.cmdCurlWget(expandedArgs, 'curl'),
      wget: () => this.cmdCurlWget(expandedArgs, 'wget'),
      ssh: () => this.cmdSsh(),
      scp: () => this.cmdScp(),
      env: () => this.cmdEnv(),
      export: () => this.cmdExport(expandedArgs),
      unset: () => this.cmdUnset(expandedArgs),
      set: () => this.cmdSet(),
      source: () => this.cmdSource(expandedArgs),
      '.': () => this.cmdSource(expandedArgs),
      alias: () => this.cmdAlias(expandedArgs),
      unalias: () => this.cmdUnalias(expandedArgs),
      history: () => this.cmdHistory(expandedArgs),
      clear: () => ({ output: '\x1b[2J\x1b[H', exitCode: 0 }),
      reset: () => ({ output: '\x1bc', exitCode: 0 }),
      exit: () => ({ output: C.yellow + 'logout' + C.reset, exitCode: 0 }),
      logout: () => ({ output: C.yellow + 'logout' + C.reset, exitCode: 0 }),
      man: () => this.cmdMan(expandedArgs),
      help: () => this.cmdHelp(),
      info: () => this.cmdMan(expandedArgs),
      true: () => ({ output: '', exitCode: 0 }),
      false: () => ({ output: '', exitCode: 1 }),
      yes: () => ({ output: Array(20).fill('y').join('\r\n'), exitCode: 0 }),
      nohup: () => ({ output: 'nohup: ignoring input and appending output to nohup.out', exitCode: 0 }),
      watch: () => ({ output: C.yellow + 'watch: browser environment - showing single execution' + C.reset, exitCode: 0 }),
      bash: () => ({ output: C.yellow + 'bash: already in bash session' + C.reset, exitCode: 0 }),
      sh: () => ({ output: C.yellow + 'sh: already in shell session' + C.reset, exitCode: 0 }),
      tar: () => this.cmdTar(expandedArgs),
      gzip: () => this.cmdGzip(expandedArgs),
      gunzip: () => this.cmdGunzip(expandedArgs),
      zip: () => this.cmdZip(expandedArgs),
      unzip: () => this.cmdUnzip(expandedArgs),
      xargs: () => this.cmdXargs(expandedArgs, stdin),
      tee: () => this.cmdTee(expandedArgs, stdin),
      column: () => this.cmdColumn(expandedArgs, stdin),
      paste: () => this.cmdPaste(expandedArgs, stdin),
      join: () => this.cmdJoin(expandedArgs, stdin),
      nl: () => this.cmdNl(expandedArgs, stdin),
      od: () => ({ output: C.yellow + 'od: binary output not shown in browser terminal' + C.reset, exitCode: 0 }),
      xxd: () => ({ output: C.yellow + 'xxd: binary output not shown in browser terminal' + C.reset, exitCode: 0 }),
      strings: () => this.cmdStrings(expandedArgs),
      basename: () => this.cmdBasename(expandedArgs),
      dirname: () => this.cmdDirname(expandedArgs),
      realpath: () => this.cmdRealpath(expandedArgs),
      readlink: () => this.cmdReadlink(expandedArgs),
      mktemp: () => this.cmdMktemp(expandedArgs),
      seq: () => this.cmdSeq(expandedArgs),
      expr: () => this.cmdExpr(expandedArgs),
      bc: () => ({ output: C.yellow + 'bc: use expr for arithmetic in browser terminal' + C.reset, exitCode: 0 }),
      useradd: () => this.simulatedSudo('useradd'),
      userdel: () => this.simulatedSudo('userdel'),
      usermod: () => this.simulatedSudo('usermod'),
      passwd: () => ({ output: C.yellow + 'passwd: password change not supported in playground' + C.reset, exitCode: 0 }),
      groupadd: () => this.simulatedSudo('groupadd'),
      su: () => ({ output: C.yellow + 'su: session switching not supported in playground' + C.reset, exitCode: 0 }),
      sudo: () => this.cmdSudo(expandedArgs),
      w: () => this.cmdW(),
      who: () => this.cmdWho(),
      last: () => this.cmdLast(),
      lastlog: () => this.cmdLastlog(),
      systemctl: () => this.cmdSystemctl(expandedArgs),
      service: () => this.cmdService(expandedArgs),
      journalctl: () => this.cmdJournalctl(expandedArgs),
      crontab: () => this.cmdCrontab(expandedArgs),
      yum: () => this.cmdPackage('yum', expandedArgs),
      dnf: () => this.cmdPackage('dnf', expandedArgs),
      rpm: () => this.cmdRpm(expandedArgs),
      pip: () => this.cmdPip(expandedArgs),
      pip3: () => this.cmdPip(expandedArgs),
      git: () => this.cmdGit(expandedArgs),
      docker: () => this.cmdDocker(expandedArgs),
      'docker-compose': () => this.cmdDockerCompose(expandedArgs),
      vi: () => ({ output: C.yellow + 'vi: text editors are not available in browser terminal.\r\nUse: echo "text" > file.txt  or  printf "content" > file.txt' + C.reset, exitCode: 0 }),
      vim: () => ({ output: C.yellow + 'vim: text editors are not available in browser terminal.\r\nUse: echo "text" > file.txt  or  printf "content" > file.txt' + C.reset, exitCode: 0 }),
      nano: () => ({ output: C.yellow + 'nano: text editors are not available in browser terminal.\r\nUse: echo "text" > file.txt  or  printf "content" > file.txt' + C.reset, exitCode: 0 }),
      emacs: () => ({ output: C.yellow + 'emacs: not available in browser terminal.' + C.reset, exitCode: 0 }),
      htop: () => this.cmdTop(),
      ifconfig: () => this.cmdIfconfig(),
      ip: () => this.cmdIp(expandedArgs),
      netstat: () => this.cmdNetstat(expandedArgs),
      ss: () => this.cmdSs(expandedArgs),
      traceroute: () => this.cmdTraceroute(expandedArgs),
      dig: () => this.cmdDig(expandedArgs),
      nslookup: () => this.cmdNslookup(expandedArgs),
      host: () => this.cmdHost(expandedArgs),
      nc: () => ({ output: C.yellow + 'nc: network not available in browser terminal' + C.reset, exitCode: 0 }),
      telnet: () => ({ output: C.yellow + 'telnet: network not available in browser terminal' + C.reset, exitCode: 0 }),
      ftp: () => ({ output: C.yellow + 'ftp: network not available in browser terminal' + C.reset, exitCode: 0 }),
      ldd: () => this.cmdLdd(expandedArgs),
      strace: () => ({ output: C.yellow + 'strace: not available in browser terminal' + C.reset, exitCode: 0 }),
      time: () => this.cmdTime(expandedArgs),
      jobs: () => ({ output: '', exitCode: 0 }),
      bg: () => ({ output: '', exitCode: 0 }),
      fg: () => ({ output: '', exitCode: 0 }),
      wait: () => ({ output: '', exitCode: 0 }),
      read: () => ({ output: '', exitCode: 0 }),
      test: () => this.cmdTest(expandedArgs),
      '[': () => this.cmdTest(expandedArgs),
      '[[': () => this.cmdTest(expandedArgs),
      if: () => ({ output: C.yellow + 'if: use inline shell syntax, e.g.: [ -f file ] && echo yes || echo no' + C.reset, exitCode: 0 }),
      for: () => ({ output: C.yellow + 'for: multi-line constructs not supported. Use; separated: for i in 1 2 3; do echo $i; done' + C.reset, exitCode: 0 }),
      while: () => ({ output: C.yellow + 'while: multi-line constructs not supported.' + C.reset, exitCode: 0 }),
      xdg: () => ({ output: C.yellow + 'xdg-open: GUI not available in browser terminal' + C.reset, exitCode: 0 }),
      open: () => ({ output: C.yellow + 'open: GUI not available in browser terminal' + C.reset, exitCode: 0 }),
      tree: () => this.cmdTree(expandedArgs),
      lsof: () => this.cmdLsof(),
      fdisk: () => ({ output: C.yellow + 'fdisk: disk partitioning not available in playground' + C.reset, exitCode: 0 }),
      mount: () => this.cmdMount(),
      umount: () => ({ output: '', exitCode: 0 }),
      blkid: () => this.cmdBlkid(),
      swapon: () => ({ output: C.yellow + 'swapon: not available in playground' + C.reset, exitCode: 0 }),
      dmesg: () => this.cmdDmesg(),
      modinfo: () => ({ output: C.yellow + 'modinfo: kernel modules not available in playground' + C.reset, exitCode: 0 }),
      lsmod: () => this.cmdLsmod(),
    };

    const handler = dispatch[cmd];
    if (handler) {
      const result = handler();
      this.state.lastExitCode = result.exitCode;
      return result;
    }

    // Check if it looks like a script
    if (cmd.endsWith('.sh') || cmd.startsWith('./')) {
      const path = this.fs.resolve(cmd.replace(/^\.\//, ''), this.state.cwd);
      if (this.fs.isFile(path)) {
        const node = this.fs.get(path)!;
        if (node.permissions & 0o100) {
          return { output: C.yellow + `[Simulated script execution: ${cmd}]\r\n` + C.reset +
            node.content.split('\n').filter(l => !l.startsWith('#') && l.trim()).map(l => `→ ${l}`).join('\r\n'),
            exitCode: 0 };
        }
        return { output: `${C.red}bash: ${cmd}: Permission denied${C.reset}`, exitCode: 126 };
      }
    }

    this.state.lastExitCode = 127;
    return { output: `${C.red}bash: ${cmd}: command not found${C.reset}`, exitCode: 127 };
  }

  // ─── FILE COMMANDS ────────────────────────────────────────────────────────

  private cmdLs(args: string[]): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const paths = args.slice(1).filter(a => !a.startsWith('-'));
    const target = paths.length ? this.fs.resolve(paths[0], this.state.cwd) : this.state.cwd;
    const node = this.fs.get(target);
    if (!node) return { output: `${C.red}ls: cannot access '${paths[0]}': No such file or directory${C.reset}`, exitCode: 1 };

    const showAll = flags.includes('a') || flags.includes('A');
    const longFormat = flags.includes('l');
    const humanReadable = flags.includes('h');
    const sortTime = flags.includes('t');
    const sortSize = flags.includes('S');
    const reverse = flags.includes('r');
    const recursive = flags.includes('R');

    const listPath = (p: string): string => {
      const items = this.fs.listDir(p);
      let filtered = showAll ? items : items.filter(i => !i.name.startsWith('.'));

      if (sortTime) filtered.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      else if (sortSize) filtered.sort((a, b) => b.size - a.size);
      if (reverse) filtered.reverse();

      if (!longFormat) {
        const cols = filtered.map(i => {
          const name = i.name;
          if (i.type === 'directory') return C.boldBlue + name + '/' + C.reset;
          if (i.permissions & 0o100) return C.boldGreen + name + C.reset;
          return name;
        });
        // Format in columns (approx 80 cols)
        const maxLen = Math.max(...cols.map(c => c.replace(/\x1b\[[0-9;]*m/g, '').length), 0);
        const colWidth = maxLen + 2;
        const termCols = 80;
        const perRow = Math.max(1, Math.floor(termCols / colWidth));
        const rows: string[] = [];
        for (let i = 0; i < cols.length; i += perRow) {
          rows.push(cols.slice(i, i + perRow).map(c => {
            const plain = c.replace(/\x1b\[[0-9;]*m/g, '');
            return c + ' '.repeat(colWidth - plain.length);
          }).join('').trimEnd());
        }
        return rows.join('\r\n');
      }

      // Long format
      let total = filtered.reduce((s, i) => s + Math.ceil(i.size / 512), 0);
      const lines = [`total ${total}`];
      for (const i of filtered) {
        const perms = VirtualFS.formatPerms(i);
        const links = i.type === 'directory' ? 2 : 1;
        let sz = String(i.size);
        if (humanReadable) {
          if (i.size > 1024 * 1024) sz = (i.size / 1024 / 1024).toFixed(1) + 'M';
          else if (i.size > 1024) sz = (i.size / 1024).toFixed(1) + 'K';
        }
        const dt = VirtualFS.formatDate(i.mtime);
        const nameStr = i.type === 'directory' ? C.boldBlue + i.name + C.reset :
          (i.permissions & 0o100) ? C.boldGreen + i.name + C.reset : i.name;
        lines.push(`${perms} ${String(links).padStart(3)} ${i.owner.padEnd(8)} ${i.group.padEnd(8)} ${sz.padStart(8)} ${dt} ${nameStr}`);
      }

      if (recursive) {
        for (const i of filtered.filter(i => i.type === 'directory')) {
          const childPath = p + (p.endsWith('/') ? '' : '/') + i.name;
          lines.push('', `${childPath}:`, listPath(childPath));
        }
      }
      return lines.join('\r\n');
    };

    return { output: listPath(target), exitCode: 0 };
  }

  private cmdCd(args: string[]): CommandResult {
    const target = args[1] || '/home/user';
    const resolved = this.fs.resolve(target, this.state.cwd);
    if (!this.fs.exists(resolved)) return { output: `${C.red}bash: cd: ${target}: No such file or directory${C.reset}`, exitCode: 1 };
    if (!this.fs.isDir(resolved)) return { output: `${C.red}bash: cd: ${target}: Not a directory${C.reset}`, exitCode: 1 };
    this.state.env['OLDPWD'] = this.state.cwd;
    this.state.cwd = resolved;
    this.state.env['PWD'] = resolved;
    return { output: '', exitCode: 0 };
  }

  private cmdPwd(): CommandResult {
    return { output: this.state.cwd, exitCode: 0 };
  }

  private cmdMkdir(args: string[]): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const parents = flags.includes('p');
    const verbose = flags.includes('v');
    const dirs = args.slice(1).filter(a => !a.startsWith('-'));
    if (!dirs.length) return { output: `${C.red}mkdir: missing operand${C.reset}`, exitCode: 1 };
    const lines: string[] = [];
    for (const d of dirs) {
      const path = this.fs.resolve(d, this.state.cwd);
      if (this.fs.exists(path)) {
        if (!parents) lines.push(`${C.red}mkdir: cannot create directory '${d}': File exists${C.reset}`);
        continue;
      }
      if (parents) {
        const parts = path.split('/').filter(Boolean);
        let p = '';
        for (const part of parts) {
          p += '/' + part;
          if (!this.fs.exists(p)) { this.fs.createDir(p); if (verbose) lines.push(`mkdir: created directory '${p}'`); }
        }
      } else {
        const parent = path.substring(0, path.lastIndexOf('/')) || '/';
        if (!this.fs.exists(parent)) return { output: `${C.red}mkdir: cannot create directory '${d}': No such file or directory${C.reset}`, exitCode: 1 };
        this.fs.createDir(path);
        if (verbose) lines.push(`mkdir: created directory '${d}'`);
      }
    }
    return { output: lines.join('\r\n'), exitCode: 0 };
  }

  private cmdRmdir(args: string[]): CommandResult {
    const dirs = args.slice(1).filter(a => !a.startsWith('-'));
    for (const d of dirs) {
      const path = this.fs.resolve(d, this.state.cwd);
      if (!this.fs.exists(path)) return { output: `${C.red}rmdir: failed to remove '${d}': No such file or directory${C.reset}`, exitCode: 1 };
      if (!this.fs.isDir(path)) return { output: `${C.red}rmdir: failed to remove '${d}': Not a directory${C.reset}`, exitCode: 1 };
      if (this.fs.listDir(path).length > 0) return { output: `${C.red}rmdir: failed to remove '${d}': Directory not empty${C.reset}`, exitCode: 1 };
      this.fs.deleteNode(path);
    }
    return { output: '', exitCode: 0 };
  }

  private cmdRm(args: string[]): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const recursive = flags.includes('r') || flags.includes('R');
    const force = flags.includes('f');
    const verbose = flags.includes('v');
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    if (!files.length && !force) return { output: `${C.red}rm: missing operand${C.reset}`, exitCode: 1 };
    const lines: string[] = [];
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (!this.fs.exists(path)) {
        if (!force) lines.push(`${C.red}rm: cannot remove '${f}': No such file or directory${C.reset}`);
        continue;
      }
      const node = this.fs.get(path)!;
      if (node.type === 'directory' && !recursive) {
        lines.push(`${C.red}rm: cannot remove '${f}': Is a directory${C.reset}`); continue;
      }
      // Protect critical paths
      if (['/','','/etc','/home','/bin','/sbin','/usr','/proc','/dev'].includes(path)) {
        lines.push(`${C.red}rm: refusing to remove '${path}': protected path${C.reset}`); continue;
      }
      this.fs.deleteNode(path);
      if (verbose) lines.push(`removed '${f}'`);
    }
    return { output: lines.join('\r\n'), exitCode: 0 };
  }

  private cmdCp(args: string[]): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const recursive = flags.includes('r') || flags.includes('R');
    const verbose = flags.includes('v');
    const paths = args.slice(1).filter(a => !a.startsWith('-'));
    if (paths.length < 2) return { output: `${C.red}cp: missing destination file operand${C.reset}`, exitCode: 1 };
    const dest = this.fs.resolve(paths[paths.length - 1], this.state.cwd);
    const srcs = paths.slice(0, -1);
    for (const s of srcs) {
      const src = this.fs.resolve(s, this.state.cwd);
      if (!this.fs.exists(src)) return { output: `${C.red}cp: cannot stat '${s}': No such file or directory${C.reset}`, exitCode: 1 };
      if (this.fs.isDir(src) && !recursive) return { output: `${C.red}cp: -r not specified; omitting directory '${s}'${C.reset}`, exitCode: 1 };
      let destPath = dest;
      if (this.fs.isDir(dest)) destPath = dest + '/' + s.split('/').pop();
      this.fs.copyNode(src, destPath);
      if (verbose) console.log(`'${s}' -> '${destPath}'`);
    }
    return { output: verbose ? srcs.map(s => `'${s}' -> '${dest}'`).join('\r\n') : '', exitCode: 0 };
  }

  private cmdMv(args: string[]): CommandResult {
    const paths = args.slice(1).filter(a => !a.startsWith('-'));
    if (paths.length < 2) return { output: `${C.red}mv: missing destination file operand${C.reset}`, exitCode: 1 };
    const dest = this.fs.resolve(paths[paths.length - 1], this.state.cwd);
    const srcs = paths.slice(0, -1);
    for (const s of srcs) {
      const src = this.fs.resolve(s, this.state.cwd);
      if (!this.fs.exists(src)) return { output: `${C.red}mv: cannot stat '${s}': No such file or directory${C.reset}`, exitCode: 1 };
      let destPath = dest;
      if (this.fs.isDir(dest)) destPath = dest + '/' + s.split('/').pop();
      this.fs.moveNode(src, destPath);
    }
    return { output: '', exitCode: 0 };
  }

  private cmdTouch(args: string[]): CommandResult {
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    if (!files.length) return { output: `${C.red}touch: missing file operand${C.reset}`, exitCode: 1 };
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (this.fs.exists(path)) {
        const node = this.fs.get(path)!;
        node.mtime = new Date();
      } else {
        this.fs.createFile(path, '', 'user', 0o644);
      }
    }
    return { output: '', exitCode: 0 };
  }

  private cmdLn(args: string[]): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const paths = args.slice(1).filter(a => !a.startsWith('-'));
    if (paths.length < 2) return { output: `${C.red}ln: missing operand${C.reset}`, exitCode: 1 };
    const [src, dest] = [this.fs.resolve(paths[0], this.state.cwd), this.fs.resolve(paths[1], this.state.cwd)];
    if (!this.fs.exists(src)) return { output: `${C.red}ln: failed to create link: No such file${C.reset}`, exitCode: 1 };
    const srcNode = this.fs.get(src)!;
    this.fs.createFile(dest, flags.includes('s') ? src : srcNode.content, srcNode.owner, srcNode.permissions);
    return { output: '', exitCode: 0 };
  }

  // ─── TEXT COMMANDS ────────────────────────────────────────────────────────

  private getContent(args: string[], stdin: string): { lines: string[]; err?: string } {
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    if (!files.length && stdin) return { lines: stdin.split('\n') };
    if (!files.length) return { lines: [], err: `${args[0]}: missing file operand` };
    const allLines: string[] = [];
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (!this.fs.exists(path)) return { lines: [], err: `${args[0]}: ${f}: No such file or directory` };
      if (this.fs.isDir(path)) return { lines: [], err: `${args[0]}: ${f}: Is a directory` };
      allLines.push(...(this.fs.get(path)!.content || '').split('\n'));
    }
    return { lines: allLines };
  }

  private cmdCat(args: string[], stdin: string): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const showLines = flags.includes('n');
    const { lines, err } = this.getContent(args, stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };
    const out = lines.map((l, i) => showLines ? `${String(i + 1).padStart(6)}\t${l}` : l).join('\r\n');
    return { output: out, exitCode: 0 };
  }

  private cmdTac(args: string[], stdin: string): CommandResult {
    const { lines, err } = this.getContent(args, stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };
    return { output: [...lines].reverse().join('\r\n'), exitCode: 0 };
  }

  private cmdHead(args: string[], stdin: string): CommandResult {
    let n = 10;
    const nIdx = args.indexOf('-n');
    if (nIdx >= 0) n = parseInt(args[nIdx + 1]) || 10;
    const shortN = args.find(a => /^-\d+$/.test(a));
    if (shortN) n = parseInt(shortN.slice(1));
    const filtered = args.filter((a, i) => !(a === '-n' || (i > 0 && args[i-1] === '-n') || /^-\d+$/.test(a)));
    const { lines, err } = this.getContent(filtered, stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };
    return { output: lines.slice(0, n).join('\r\n'), exitCode: 0 };
  }

  private cmdTail(args: string[], stdin: string): CommandResult {
    let n = 10;
    const nIdx = args.indexOf('-n');
    if (nIdx >= 0) n = parseInt(args[nIdx + 1]) || 10;
    const shortN = args.find(a => /^-\d+$/.test(a));
    if (shortN) n = parseInt(shortN.slice(1));
    const follow = args.includes('-f');
    const filtered = args.filter((a, i) => !(a === '-n' || a === '-f' || (i > 0 && args[i-1] === '-n') || /^-\d+$/.test(a)));
    const { lines, err } = this.getContent(filtered, stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };
    const out = lines.slice(-n).join('\r\n');
    return { output: out + (follow ? `\r\n${C.yellow}(tail -f not supported in browser)${C.reset}` : ''), exitCode: 0 };
  }

  private cmdEcho(args: string[]): CommandResult {
    const flags = args[1]?.startsWith('-') ? args[1] : '';
    const noNewline = flags.includes('n');
    const interpret = flags.includes('e');
    const parts = args.slice(flags ? 2 : 1);
    let out = parts.join(' ');
    if (interpret) {
      out = out.replace(/\\n/g, '\r\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
               .replace(/\\a/g, '\x07').replace(/\\b/g, '\b').replace(/\\e/g, '\x1b')
               .replace(/\\033\[([0-9;]+)m/g, '\x1b[$1m');
    }
    return { output: noNewline ? out : out, exitCode: 0 };
  }

  private cmdPrintf(args: string[]): CommandResult {
    if (args.length < 2) return { output: '', exitCode: 0 };
    const fmt = args[1].replace(/\\n/g, '\r\n').replace(/\\t/g, '\t').replace(/\\e/g, '\x1b');
    const vals = args.slice(2);
    let i = 0;
    const out = fmt.replace(/%s/g, () => vals[i++] || '').replace(/%d/g, () => vals[i++] || '0').replace(/%i/g, () => vals[i++] || '0');
    return { output: out, exitCode: 0 };
  }

  private cmdGrep(args: string[], stdin: string): CommandResult {
    const flagArgs = args.filter(a => a.startsWith('-'));
    const flags = flagArgs.join('');
    const nonFlags = args.slice(1).filter(a => !a.startsWith('-'));
    const ignoreCase = flags.includes('i');
    const invertMatch = flags.includes('v');
    const showLineNum = flags.includes('n');
    const countOnly = flags.includes('c');
    const filesWithMatch = flags.includes('l');
    const recursive = flags.includes('r') || flags.includes('R');
    const word = flags.includes('w');
    const extended = flags.includes('E');

    if (!nonFlags.length) return { output: `${C.red}grep: no pattern given${C.reset}`, exitCode: 2 };
    const patternStr = nonFlags[0];
    const filePaths = nonFlags.slice(1);

    let pattern: RegExp;
    try {
      let p = word ? `\\b${patternStr}\\b` : (extended ? patternStr : patternStr.replace(/[+?{}()|]/g, '\\$&'));
      pattern = new RegExp(p, ignoreCase ? 'i' : '');
    } catch { return { output: `${C.red}grep: invalid regex${C.reset}`, exitCode: 2 }; }

    const grepLines = (content: string, label: string): string[] => {
      const lines = content.split('\n');
      const matched: string[] = [];
      let count = 0;
      for (let i = 0; i < lines.length; i++) {
        const matches = pattern.test(lines[i]);
        if (invertMatch ? !matches : matches) {
          count++;
          if (!countOnly && !filesWithMatch) {
            const prefix = filePaths.length > 1 ? `${C.magenta}${label}${C.reset}:` : '';
            const lineNum = showLineNum ? `${C.cyan}${i + 1}${C.reset}:` : '';
            const highlighted = lines[i].replace(pattern, m => `${C.boldYellow}${m}${C.reset}`);
            matched.push(`${prefix}${lineNum}${highlighted}`);
          }
        }
      }
      if (filesWithMatch && count > 0) matched.push(`${C.magenta}${label}${C.reset}`);
      if (countOnly) matched.push(`${filePaths.length > 1 ? label + ':' : ''}${count}`);
      return matched;
    };

    if (!filePaths.length) {
      if (!stdin) return { output: `${C.red}grep: missing file operand${C.reset}`, exitCode: 1 };
      const result = grepLines(stdin, '');
      return { output: result.join('\r\n'), exitCode: result.length ? 0 : 1 };
    }

    const allLines: string[] = [];
    for (const f of filePaths) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (recursive && this.fs.isDir(path)) {
        // recurse
        const recurse = (dir: string) => {
          for (const child of this.fs.listDir(dir)) {
            const cp = dir + '/' + child.name;
            if (child.type === 'directory') recurse(cp);
            else allLines.push(...grepLines(child.content, cp));
          }
        };
        recurse(path);
      } else if (!this.fs.exists(path)) {
        allLines.push(`${C.red}grep: ${f}: No such file or directory${C.reset}`);
      } else {
        allLines.push(...grepLines(this.fs.get(path)!.content, f));
      }
    }
    return { output: allLines.join('\r\n'), exitCode: allLines.length ? 0 : 1 };
  }

  private cmdSed(args: string[], stdin: string): CommandResult {
    const expr = args.find(a => !a.startsWith('-') && a !== 'sed') || '';
    const { lines, err } = this.getContent(args.filter(a => a !== expr), stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };
    if (!expr) return { output: `${C.red}sed: no script command!${C.reset}`, exitCode: 1 };

    // Support s/old/new/[g][i], d (delete matching), p (print), = (line number)
    return { output: lines.map((line, idx) => {
      if (expr === 'd') return null;
      if (expr.startsWith('s/') || expr.startsWith('s|')) {
        const sep = expr[1];
        const re = new RegExp(`\\${sep}`, 'g');
        const parts = expr.split(re);
        if (parts.length < 3) return line;
        const [, from, to, flags] = parts;
        const regexFlags = (flags?.includes('g') ? 'g' : '') + (flags?.includes('i') ? 'i' : '');
        try { return line.replace(new RegExp(from, regexFlags), to.replace(/&/g, '$&')); } catch { return line; }
      }
      if (expr === '=') return `${idx + 1}\n${line}`;
      if (expr.endsWith('d')) {
        try { const p = expr.slice(0, -1); if (new RegExp(p).test(line)) return null; } catch {}
      }
      if (expr.endsWith('p')) return line + '\r\n' + line;
      return line;
    }).filter(l => l !== null).join('\r\n'), exitCode: 0 };
  }

  private cmdAwk(args: string[], stdin: string): CommandResult {
    // Basic awk: support print, $N, -F, NR, NF
    const fIdx = args.indexOf('-F');
    const sep = fIdx >= 0 ? args[fIdx + 1] || ' ' : ' ';
    const prog = args.find(a => !a.startsWith('-') && a !== 'awk' && (fIdx < 0 || args.indexOf(a) !== fIdx + 1)) || '{print}';
    const fileArgs = args.slice(1).filter((a, i) => !a.startsWith('-') && a !== prog && !(args[i] === '-F'));
    const { lines, err } = this.getContent(['awk', ...fileArgs], stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };

    const out: string[] = [];
    for (let nr = 0; nr < lines.length; nr++) {
      const line = lines[nr];
      const fields = line.split(sep === ' ' ? /\s+/ : new RegExp(sep));
      const nf = fields.length;
      let p = prog
        .replace(/\{print\s+(.*?)\}/g, (_, expr) => {
          return expr.replace(/\$(\d+)/g, (_: string, n: string) => {
            const idx = parseInt(n);
            if (idx === 0) return line;
            return fields[idx - 1] || '';
          }).replace(/NR/g, String(nr + 1)).replace(/NF/g, String(nf));
        })
        .replace(/\{print\}/g, line);
      if (p !== prog) out.push(p.replace(/^"|"$/g, '').replace(/,/g, sep));
      else if (prog === '{print}') out.push(line);
      else out.push(line);
    }
    return { output: out.join('\r\n'), exitCode: 0 };
  }

  private cmdSort(args: string[], stdin: string): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const reverse = flags.includes('r');
    const unique = flags.includes('u');
    const numeric = flags.includes('n');
    const { lines, err } = this.getContent(args, stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };
    let sorted = [...lines];
    sorted.sort((a, b) => numeric ? parseFloat(a) - parseFloat(b) : a.localeCompare(b));
    if (reverse) sorted.reverse();
    if (unique) sorted = [...new Set(sorted)];
    return { output: sorted.join('\r\n'), exitCode: 0 };
  }

  private cmdUniq(args: string[], stdin: string): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const count = flags.includes('c');
    const { lines, err } = this.getContent(args, stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i === 0 || lines[i] !== lines[i-1]) {
        if (count) {
          let c = 1;
          while (i + c < lines.length && lines[i + c] === lines[i]) c++;
          out.push(`${String(c).padStart(7)} ${lines[i]}`);
        } else out.push(lines[i]);
      }
    }
    return { output: out.join('\r\n'), exitCode: 0 };
  }

  private cmdWc(args: string[], stdin: string): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const { lines, err } = this.getContent(args, stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };
    const text = lines.join('\n');
    const l = lines.length;
    const w = text.trim().split(/\s+/).filter(Boolean).length;
    const c = text.length;
    if (flags.includes('l')) return { output: String(l), exitCode: 0 };
    if (flags.includes('w')) return { output: String(w), exitCode: 0 };
    if (flags.includes('c')) return { output: String(c), exitCode: 0 };
    return { output: `${String(l).padStart(8)} ${String(w).padStart(8)} ${String(c).padStart(8)}`, exitCode: 0 };
  }

  private cmdCut(args: string[], stdin: string): CommandResult {
    const dIdx = args.indexOf('-d');
    const delim = dIdx >= 0 ? args[dIdx + 1] || '\t' : '\t';
    const fIdx = args.indexOf('-f');
    const fields = fIdx >= 0 ? args[fIdx + 1] || '' : '';
    const cIdx = args.indexOf('-c');
    const chars = cIdx >= 0 ? args[cIdx + 1] || '' : '';
    const fileArgs = args.filter((a, i) => !a.startsWith('-') && i !== dIdx + 1 && i !== fIdx + 1 && i !== cIdx + 1);
    const { lines, err } = this.getContent(fileArgs, stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };

    const parseRange = (spec: string, max: number): number[] => {
      const result: number[] = [];
      for (const part of spec.split(',')) {
        if (part.includes('-')) {
          const [a, b] = part.split('-').map(Number);
          for (let i = (a || 1); i <= (b || max); i++) result.push(i);
        } else result.push(Number(part));
      }
      return result;
    };

    return { output: lines.map(line => {
      if (chars) {
        const idxs = parseRange(chars, line.length);
        return idxs.map(i => line[i - 1] || '').join('');
      }
      if (fields) {
        const parts = line.split(delim);
        const idxs = parseRange(fields, parts.length);
        return idxs.map(i => parts[i - 1] || '').join(delim);
      }
      return line;
    }).join('\r\n'), exitCode: 0 };
  }

  private cmdTr(args: string[], stdin: string): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const nonFlags = args.slice(1).filter(a => !a.startsWith('-'));
    const del = flags.includes('d');
    const squeeze = flags.includes('s');
    const text = stdin || '';
    if (del && nonFlags.length >= 1) {
      const chars = nonFlags[0].split('');
      return { output: text.split('').filter(c => !chars.includes(c)).join(''), exitCode: 0 };
    }
    if (nonFlags.length >= 2) {
      const from = nonFlags[0].split('');
      const to = nonFlags[1].split('');
      let out = text.split('').map(c => {
        const i = from.indexOf(c);
        return i >= 0 ? (to[i] ?? to[to.length - 1] ?? c) : c;
      }).join('');
      if (squeeze) out = out.replace(/(.)\1+/g, '$1');
      return { output: out, exitCode: 0 };
    }
    return { output: text, exitCode: 0 };
  }

  private cmdDiff(args: string[]): CommandResult {
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    if (files.length < 2) return { output: `${C.red}diff: missing operand${C.reset}`, exitCode: 2 };
    const [p1, p2] = files.map(f => this.fs.resolve(f, this.state.cwd));
    if (!this.fs.exists(p1)) return { output: `${C.red}diff: ${files[0]}: No such file${C.reset}`, exitCode: 2 };
    if (!this.fs.exists(p2)) return { output: `${C.red}diff: ${files[1]}: No such file${C.reset}`, exitCode: 2 };
    const l1 = (this.fs.get(p1)!.content).split('\n');
    const l2 = (this.fs.get(p2)!.content).split('\n');
    const out: string[] = [];
    const max = Math.max(l1.length, l2.length);
    for (let i = 0; i < max; i++) {
      if (l1[i] !== l2[i]) {
        if (l1[i] !== undefined) out.push(`${C.red}< ${l1[i]}${C.reset}`);
        if (l2[i] !== undefined) out.push(`${C.green}> ${l2[i]}${C.reset}`);
      }
    }
    return { output: out.length ? out.join('\r\n') : '', exitCode: out.length ? 1 : 0 };
  }

  // ─── FIND / SEARCH ────────────────────────────────────────────────────────

  private cmdFind(args: string[]): CommandResult {
    const startIdx = args[1] && !args[1].startsWith('-') ? 1 : -1;
    const start = startIdx >= 0 ? this.fs.resolve(args[startIdx], this.state.cwd) : this.state.cwd;
    const nameIdx = args.indexOf('-name');
    const typeIdx = args.indexOf('-type');
    const sizeIdx = args.indexOf('-size');
    const namePattern = nameIdx >= 0 ? args[nameIdx + 1] : null;
    const typeFilter = typeIdx >= 0 ? args[typeIdx + 1] : null;
    const execIdx = args.indexOf('-exec');
    const printIdx = args.indexOf('-print');

    const nameRegex = namePattern
      ? new RegExp('^' + namePattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
      : null;

    if (!this.fs.exists(start)) return { output: `${C.red}find: '${args[1]}': No such file or directory${C.reset}`, exitCode: 1 };

    const results: string[] = [];
    const search = (dir: string) => {
      results.push(dir);
      for (const child of this.fs.listDir(dir)) {
        const cp = dir === '/' ? '/' + child.name : dir + '/' + child.name;
        const matchName = nameRegex ? nameRegex.test(child.name) : true;
        const matchType = typeFilter ? (typeFilter === 'f' ? child.type === 'file' : typeFilter === 'd' ? child.type === 'directory' : true) : true;
        if (matchName && matchType) results.push(cp);
        if (child.type === 'directory') search(cp);
      }
    };
    search(start);

    const out = results.join('\r\n');
    if (execIdx >= 0) {
      const execCmd = args.slice(execIdx + 1, args.indexOf(';', execIdx)).join(' ');
      if (execCmd) {
        const execResults = results.map(r => this.execute(execCmd.replace(/\{\}/g, r)).output).filter(Boolean);
        return { output: execResults.join('\r\n'), exitCode: 0 };
      }
    }
    return { output: out, exitCode: 0 };
  }

  private cmdLocate(args: string[]): CommandResult {
    const pattern = args[1];
    if (!pattern) return { output: `${C.red}locate: pattern is missing${C.reset}`, exitCode: 1 };
    const re = new RegExp(pattern.replace(/\./g, '\\.').replace(/\*/g, '.*'), 'i');
    const results: string[] = [];
    // Use private tree via iteration trick - expose a method
    const all = this.fs.glob('*', '/');
    // Simulate basic locate using find
    const find = this.cmdFind(['find', '/', '-name', `*${pattern}*`]);
    return find;
  }

  private cmdWhich(args: string[]): CommandResult {
    const cmds = args.slice(1);
    const binPaths = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
    const out: string[] = [];
    const known = ['ls','cd','pwd','mkdir','rm','cp','mv','touch','cat','grep','sed','awk','sort','find',
      'echo','date','ps','top','kill','chmod','chown','tar','gzip','zip','curl','wget','ssh','git',
      'docker','yum','dnf','systemctl','journalctl','env','export','history','clear','man','ping',
      'hostname','uname','whoami','id','df','du','free','wc','cut','tr','head','tail','diff','stat',
      'file','ln','tree','tee','xargs','seq','expr','bc','basename','dirname'];
    for (const cmd of cmds) {
      if (known.includes(cmd)) {
        out.push(`/usr/bin/${cmd}`);
      } else {
        out.push(`${C.red}${cmd}: command not found${C.reset}`);
      }
    }
    return { output: out.join('\r\n'), exitCode: 0 };
  }

  private cmdWhereis(args: string[]): CommandResult {
    const cmd = args[1] || '';
    return { output: `${cmd}: /usr/bin/${cmd} /usr/share/man/man1/${cmd}.1.gz`, exitCode: 0 };
  }

  private cmdType(args: string[]): CommandResult {
    const cmd = args[1] || '';
    const builtins = ['cd','echo','export','alias','source','read','set','type','help','jobs','bg','fg','exit','logout'];
    if (builtins.includes(cmd)) return { output: `${cmd} is a shell builtin`, exitCode: 0 };
    if (this.state.aliases[cmd]) return { output: `${cmd} is aliased to '${this.state.aliases[cmd]}'`, exitCode: 0 };
    return { output: `${cmd} is /usr/bin/${cmd}`, exitCode: 0 };
  }

  private cmdStat(args: string[]): CommandResult {
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    if (!files.length) return { output: `${C.red}stat: missing operand${C.reset}`, exitCode: 1 };
    const out: string[] = [];
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      const node = this.fs.get(path);
      if (!node) { out.push(`${C.red}stat: cannot stat '${f}': No such file or directory${C.reset}`); continue; }
      const perms = VirtualFS.formatPerms(node);
      out.push(
        `  File: ${path}`,
        `  Size: ${node.size}\t\tBlocks: ${Math.ceil(node.size/512)}\t\tIO Block: 4096  ${node.type}`,
        `Device: fd00h/64768d\tInode: ${Math.abs(path.split('').reduce((a,c) => a + c.charCodeAt(0), 0))}`,
        `Access: (${(node.permissions).toString(8).padStart(4,'0')}/${perms})\tUid: (1000/${node.owner})\tGid: (1000/${node.group})`,
        `Modify: ${node.mtime.toISOString()}`,
        `Change: ${node.ctime.toISOString()}`,
      );
    }
    return { output: out.join('\r\n'), exitCode: 0 };
  }

  private cmdFile(args: string[]): CommandResult {
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    const out = files.map(f => {
      const path = this.fs.resolve(f, this.state.cwd);
      const node = this.fs.get(path);
      if (!node) return `${f}: cannot open (No such file or directory)`;
      if (node.type === 'directory') return `${f}: directory`;
      const c = node.content;
      if (c.startsWith('#!/bin/bash') || c.startsWith('#!/bin/sh')) return `${f}: Bourne-Again shell script, ASCII text executable`;
      if (c.startsWith('#!')) return `${f}: script, ASCII text executable`;
      if (/^[\x00-\x7F]*$/.test(c)) return `${f}: ASCII text`;
      return `${f}: data`;
    });
    return { output: out.join('\r\n'), exitCode: 0 };
  }

  // ─── PERMISSIONS ────────────────────────────────────────────────────────

  private parseChmod(modeStr: string, currentPerms: number): number {
    // Numeric mode
    if (/^\d+$/.test(modeStr)) return parseInt(modeStr, 8);
    // Symbolic: [ugoa][+-=][rwx]
    let perms = currentPerms;
    const parts = modeStr.split(',');
    for (const part of parts) {
      const m = part.match(/^([ugoa]*)([+\-=])([rwxXs]*)$/);
      if (!m) continue;
      const [, who, op, what] = m;
      const targets = who === '' || who === 'a' ? ['u', 'g', 'o'] : who.split('');
      const bitMap: Record<string, Record<string, number>> = {
        u: { r: 0o400, w: 0o200, x: 0o100 },
        g: { r: 0o040, w: 0o020, x: 0o010 },
        o: { r: 0o004, w: 0o002, x: 0o001 },
      };
      for (const t of targets) {
        const bits = what.split('').reduce((s, c) => s | (bitMap[t]?.[c] || 0), 0);
        if (op === '+') perms |= bits;
        else if (op === '-') perms &= ~bits;
        else if (op === '=') {
          const mask = Object.values(bitMap[t] || {}).reduce((a, b) => a | b, 0);
          perms = (perms & ~mask) | bits;
        }
      }
    }
    return perms;
  }

  private cmdChmod(args: string[]): CommandResult {
    const flags = args.filter(a => a.startsWith('-')).join('');
    const recursive = flags.includes('R');
    const nonFlags = args.slice(1).filter(a => !a.startsWith('-'));
    if (nonFlags.length < 2) return { output: `${C.red}chmod: missing operand${C.reset}`, exitCode: 1 };
    const [modeStr, ...files] = nonFlags;
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (!this.fs.exists(path)) return { output: `${C.red}chmod: cannot access '${f}': No such file or directory${C.reset}`, exitCode: 1 };
      const node = this.fs.get(path)!;
      const newPerms = this.parseChmod(modeStr, node.permissions);
      this.fs.chmod(path, newPerms);
      if (recursive && this.fs.isDir(path)) {
        const recurse = (dir: string) => {
          for (const child of this.fs.listDir(dir)) {
            const cp = dir + '/' + child.name;
            const cn = this.fs.get(cp)!;
            this.fs.chmod(cp, this.parseChmod(modeStr, cn.permissions));
            if (child.type === 'directory') recurse(cp);
          }
        };
        recurse(path);
      }
    }
    return { output: '', exitCode: 0 };
  }

  private cmdChown(args: string[]): CommandResult {
    const nonFlags = args.slice(1).filter(a => !a.startsWith('-'));
    if (nonFlags.length < 2) return { output: `${C.red}chown: missing operand${C.reset}`, exitCode: 1 };
    const [ownerStr, ...files] = nonFlags;
    const [owner, group] = ownerStr.split(':');
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (!this.fs.exists(path)) return { output: `${C.red}chown: cannot access '${f}': No such file or directory${C.reset}`, exitCode: 1 };
      this.fs.chown(path, owner, group || owner);
    }
    return { output: '', exitCode: 0 };
  }

  private cmdChgrp(args: string[]): CommandResult {
    const nonFlags = args.slice(1).filter(a => !a.startsWith('-'));
    if (nonFlags.length < 2) return { output: `${C.red}chgrp: missing operand${C.reset}`, exitCode: 1 };
    const [group, ...files] = nonFlags;
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (!this.fs.exists(path)) return { output: `${C.red}chgrp: cannot access '${f}': No such file or directory${C.reset}`, exitCode: 1 };
      const node = this.fs.get(path)!;
      this.fs.chown(path, node.owner, group);
    }
    return { output: '', exitCode: 0 };
  }

  private cmdUmask(args: string[]): CommandResult {
    if (args.length < 2) return { output: '0022', exitCode: 0 };
    return { output: '', exitCode: 0 };
  }

  // ─── SYSTEM INFO ────────────────────────────────────────────────────────

  private cmdUname(args: string[]): CommandResult {
    const flags = args.slice(1).join('');
    if (!flags || flags === '-s') return { output: 'Linux', exitCode: 0 };
    if (flags.includes('a')) return { output: 'Linux centos-playground 3.10.0-1160.el7.x86_64 #1 SMP Mon Oct 19 16:18:59 UTC 2020 x86_64 x86_64 x86_64 GNU/Linux', exitCode: 0 };
    const parts: string[] = [];
    if (flags.includes('s')) parts.push('Linux');
    if (flags.includes('n')) parts.push('centos-playground');
    if (flags.includes('r')) parts.push('3.10.0-1160.el7.x86_64');
    if (flags.includes('v')) parts.push('#1 SMP Mon Oct 19 16:18:59 UTC 2020');
    if (flags.includes('m')) parts.push('x86_64');
    if (flags.includes('p')) parts.push('x86_64');
    if (flags.includes('o')) parts.push('GNU/Linux');
    return { output: parts.join(' ') || 'Linux', exitCode: 0 };
  }

  private cmdHostname(args: string[]): CommandResult {
    if (args.length > 1 && !args[1].startsWith('-')) {
      this.state.hostname = args[1];
      this.state.env['HOSTNAME'] = args[1];
      return { output: '', exitCode: 0 };
    }
    const flags = args.slice(1).join('');
    if (flags.includes('I')) return { output: '172.17.0.2', exitCode: 0 };
    if (flags.includes('f')) return { output: `${this.state.hostname}.localdomain`, exitCode: 0 };
    return { output: this.state.hostname, exitCode: 0 };
  }

  private cmdId(): CommandResult {
    if (this.state.user === 'root') return { output: 'uid=0(root) gid=0(root) groups=0(root)', exitCode: 0 };
    return { output: 'uid=1000(user) gid=1000(user) groups=1000(user),10(wheel),100(users)', exitCode: 0 };
  }

  private cmdDate(args: string[]): CommandResult {
    const fmt = args.find(a => a.startsWith('+'));
    const now = new Date();
    if (!fmt) return { output: now.toString(), exitCode: 0 };
    const f = fmt.slice(1)
      .replace(/%Y/g, now.getFullYear().toString())
      .replace(/%m/g, String(now.getMonth() + 1).padStart(2, '0'))
      .replace(/%d/g, String(now.getDate()).padStart(2, '0'))
      .replace(/%H/g, String(now.getHours()).padStart(2, '0'))
      .replace(/%M/g, String(now.getMinutes()).padStart(2, '0'))
      .replace(/%S/g, String(now.getSeconds()).padStart(2, '0'))
      .replace(/%s/g, String(Math.floor(now.getTime() / 1000)))
      .replace(/%n/g, '\r\n')
      .replace(/%A/g, ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()])
      .replace(/%B/g, ['January','February','March','April','May','June','July','August','September','October','November','December'][now.getMonth()]);
    return { output: f, exitCode: 0 };
  }

  private cmdCal(args: string[]): CommandResult {
    const now = new Date();
    const month = parseInt(args[1]) || now.getMonth() + 1;
    const year = parseInt(args[2]) || now.getFullYear();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const header = `   ${months[month-1]} ${year}`;
    const days = 'Su Mo Tu We Th Fr Sa';
    const firstDay = new Date(year, month - 1, 1).getDay();
    const totalDays = new Date(year, month, 0).getDate();
    let row = '   '.repeat(firstDay);
    const rows = [header, days];
    for (let d = 1; d <= totalDays; d++) {
      const isToday = d === now.getDate() && month === now.getMonth() + 1 && year === now.getFullYear();
      row += isToday ? `\x1b[7m${String(d).padStart(2)}\x1b[m ` : `${String(d).padStart(2)} `;
      if ((firstDay + d) % 7 === 0 || d === totalDays) { rows.push(row.trimEnd()); row = ''; }
    }
    return { output: rows.join('\r\n'), exitCode: 0 };
  }

  private cmdUptime(): CommandResult {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    return { output: ` ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00 up 1 day,  0:01,  1 user,  load average: 0.01, 0.05, 0.05`, exitCode: 0 };
  }

  private cmdDf(args: string[]): CommandResult {
    const human = args.includes('-h');
    const header = human
      ? 'Filesystem      Size  Used Avail Use% Mounted on'
      : 'Filesystem     1K-blocks      Used Available Use% Mounted on';
    const rows = [
      human ? '/dev/sda1        20G  3.2G   17G  17% /' : '/dev/sda1        20971520   3355443  17616077  17% /',
      human ? 'tmpfs           256M     0  256M   0% /dev/shm' : 'tmpfs              262144       0    262144   0% /dev/shm',
      human ? '/dev/sdb1         5G  1.0G  4.0G  20% /home' : '/dev/sdb1         5242880  1048576   4194304  20% /home',
    ];
    return { output: [header, ...rows].join('\r\n'), exitCode: 0 };
  }

  private cmdDu(args: string[]): CommandResult {
    const human = args.includes('-h');
    const summarize = args.includes('-s');
    const paths = args.slice(1).filter(a => !a.startsWith('-'));
    const target = paths.length ? this.fs.resolve(paths[0], this.state.cwd) : this.state.cwd;
    if (!this.fs.exists(target)) return { output: `${C.red}du: cannot access '${paths[0]}': No such file${C.reset}`, exitCode: 1 };

    const getSize = (path: string): number => {
      const node = this.fs.get(path);
      if (!node) return 0;
      if (node.type === 'file') return node.size;
      return this.fs.listDir(path).reduce((s, c) => s + getSize(path + '/' + c.name), 0);
    };
    const fmtSize = (s: number) => {
      if (!human) return String(Math.ceil(s / 1024));
      if (s > 1048576) return (s / 1048576).toFixed(1) + 'M';
      if (s > 1024) return (s / 1024).toFixed(1) + 'K';
      return s + 'B';
    };

    if (summarize) return { output: `${fmtSize(getSize(target))}\t${target}`, exitCode: 0 };
    const lines: string[] = [];
    const walk = (path: string) => {
      lines.push(`${fmtSize(getSize(path))}\t${path}`);
      for (const child of this.fs.listDir(path)) {
        if (child.type === 'directory') walk(path + '/' + child.name);
      }
    };
    walk(target);
    return { output: lines.join('\r\n'), exitCode: 0 };
  }

  private cmdFree(args: string[]): CommandResult {
    const human = args.includes('-h');
    const header = '              total        used        free      shared  buff/cache   available';
    const mem = human ? 'Mem:          7.8Gi       1.2Gi       4.0Gi        24Mi       2.6Gi       6.1Gi' : 'Mem:        8192000     1228800     4096000       24576     2867200     6144000';
    const swap = human ? 'Swap:         2.0Gi          0B       2.0Gi' : 'Swap:       2097148           0     2097148';
    return { output: [header, mem, swap].join('\r\n'), exitCode: 0 };
  }

  private cmdLscpu(): CommandResult {
    return { output: [
      'Architecture:          x86_64',
      'CPU op-mode(s):        32-bit, 64-bit',
      'Byte Order:            Little Endian',
      'CPU(s):                4',
      'Thread(s) per core:    2',
      'Core(s) per socket:    2',
      'Socket(s):             1',
      'NUMA node(s):          1',
      'Vendor ID:             GenuineIntel',
      'CPU family:            6',
      'Model name:            Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz',
      'CPU MHz:               2600.000',
      'L1d cache:             32K',
      'L2 cache:              256K',
      'L3 cache:              12288K',
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdLsblk(): CommandResult {
    return { output: [
      'NAME   MAJ:MIN RM  SIZE RO TYPE MOUNTPOINT',
      'sda      8:0    0   20G  0 disk',
      '├─sda1   8:1    0   18G  0 part /',
      '└─sda2   8:2    0    2G  0 part [SWAP]',
      'sdb      8:16   0    5G  0 disk',
      '└─sdb1   8:17   0    5G  0 part /home',
    ].join('\r\n'), exitCode: 0 };
  }

  // ─── PROCESS MANAGEMENT ────────────────────────────────────────────────

  private cmdPs(args: string[]): CommandResult {
    const flags = args.slice(1).join('');
    const all = flags.includes('a') || flags.includes('e');
    const full = flags.includes('f') || flags.includes('u');
    const aux = flags.includes('x') || args.includes('aux');

    const procs = [
      { pid: 1,    ppid: 0,   user: 'root', cpu: '0.0', mem: '0.1', vsz: '128048', rss: '6828', tty: '?', stat: 'Ss', start: '10:00', time: '0:01', cmd: '/usr/lib/systemd/systemd --switched-root' },
      { pid: 2,    ppid: 0,   user: 'root', cpu: '0.0', mem: '0.0', vsz: '0',      rss: '0',    tty: '?', stat: 'S',  start: '10:00', time: '0:00', cmd: '[kthreadd]' },
      { pid: 100,  ppid: 1,   user: 'root', cpu: '0.0', mem: '0.1', vsz: '55680',  rss: '1920', tty: '?', stat: 'Ss', start: '10:00', time: '0:00', cmd: '/usr/sbin/sshd -D' },
      { pid: 200,  ppid: 1,   user: 'root', cpu: '0.0', mem: '0.2', vsz: '111808', rss: '9280', tty: '?', stat: 'Ssl',start: '10:00', time: '0:00', cmd: '/usr/sbin/crond -n' },
      { pid: 1000, ppid: 100, user: 'user', cpu: '0.0', mem: '0.1', vsz: '116128', rss: '3560', tty: 'pts/0', stat: 'Ss', start: '10:01', time: '0:00', cmd: '-bash' },
      { pid: 1001, ppid: 1000,user: 'user', cpu: '0.1', mem: '0.1', vsz: '155460', rss: '2116', tty: 'pts/0', stat: 'R+', start: '10:01', time: '0:00', cmd: 'ps aux' },
    ].filter(p => aux || all || p.user === this.state.user);

    if (full || aux) {
      const header = 'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND';
      const rows = procs.map(p =>
        `${p.user.padEnd(10)} ${String(p.pid).padStart(5)} ${p.cpu.padStart(4)} ${p.mem.padStart(4)} ${p.vsz.padStart(7)} ${p.rss.padStart(6)} ${p.tty.padEnd(8)} ${p.stat.padEnd(4)} ${p.start.padStart(7)} ${p.time.padStart(7)} ${p.cmd}`
      );
      return { output: [header, ...rows].join('\r\n'), exitCode: 0 };
    }
    const header = '  PID TTY          TIME CMD';
    const rows = procs.filter(p => p.tty !== '?').map(p =>
      `${String(p.pid).padStart(5)} ${p.tty.padEnd(13)} ${p.time.padStart(7)} ${p.cmd.split(' ')[0]}`
    );
    return { output: [header, ...rows].join('\r\n'), exitCode: 0 };
  }

  private cmdTop(): CommandResult {
    const now = new Date().toLocaleTimeString();
    return { output: [
      `top - ${now} up 1 day,  0:01,  1 user,  load average: 0.01, 0.05, 0.05`,
      'Tasks:   6 total,   1 running,   5 sleeping,   0 stopped,   0 zombie',
      '%Cpu(s):  0.3 us,  0.1 sy,  0.0 ni, 99.5 id,  0.0 wa,  0.1 hi,  0.0 si',
      'KiB Mem:   8192000 total,  4096000 free,  1228800 used,  2867200 buff/cache',
      'KiB Swap:  2097148 total,  2097148 free,        0 used.  6144000 avail Mem',
      '',
      '  PID USER      PR  NI    VIRT    RES    SHR S  %CPU %MEM     TIME+ COMMAND',
      '    1 root      20   0  128048   6828   3908 S   0.0  0.1   0:01.23 systemd',
      '  100 root      20   0   55680   1920   1120 S   0.0  0.0   0:00.05 sshd',
      '  200 root      20   0  111808   9280   7040 S   0.0  0.1   0:00.12 crond',
      ` 1000 ${this.state.user.padEnd(9)}  20   0  116128   3560   2160 S   0.0  0.0   0:00.02 bash`,
      ` 1001 ${this.state.user.padEnd(9)}  20   0  155460   2116   1440 R   0.1  0.0   0:00.01 top`,
      '',
      `${C.yellow}(top is interactive — showing a snapshot)${C.reset}`,
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdKill(args: string[]): CommandResult {
    const flags = args.filter(a => a.startsWith('-'));
    const pids = args.slice(1).filter(a => !a.startsWith('-'));
    if (!pids.length) return { output: `${C.red}kill: usage: kill [-s sigspec] pid${C.reset}`, exitCode: 1 };
    const sig = flags.find(f => f.startsWith('-s'))?.slice(2) || flags.find(f => /^-\d+$/.test(f))?.slice(1) || '15';
    return { output: pids.map(p => `kill: sending signal ${sig} to pid ${p}`).join('\r\n'), exitCode: 0 };
  }

  private cmdKillall(args: string[]): CommandResult {
    const name = args[1];
    if (!name) return { output: `${C.red}killall: no process name specified${C.reset}`, exitCode: 1 };
    return { output: `killall: no process found for '${name}'`, exitCode: 1 };
  }

  private cmdPgrep(args: string[]): CommandResult {
    const name = args[args.length - 1];
    if (!name || name.startsWith('-')) return { output: '', exitCode: 1 };
    const pids: Record<string, number> = { bash: 1000, sshd: 100, crond: 200, systemd: 1 };
    const pid = pids[name];
    return pid ? { output: String(pid), exitCode: 0 } : { output: '', exitCode: 1 };
  }

  // ─── NETWORK ────────────────────────────────────────────────────────────

  private cmdPing(args: string[]): CommandResult {
    const host = args.find(a => !a.startsWith('-') && a !== 'ping') || '';
    const count = args.includes('-c') ? parseInt(args[args.indexOf('-c') + 1]) || 4 : 4;
    if (!host) return { output: `${C.red}ping: missing host operand${C.reset}`, exitCode: 1 };
    const lines = [`PING ${host} (93.184.216.34) 56(84) bytes of data.`];
    for (let i = 1; i <= Math.min(count, 4); i++) {
      const ms = (Math.random() * 20 + 5).toFixed(3);
      lines.push(`64 bytes from ${host} (93.184.216.34): icmp_seq=${i} ttl=56 time=${ms} ms`);
    }
    lines.push(`\n--- ${host} ping statistics ---`);
    lines.push(`${count} packets transmitted, ${count} received, 0% packet loss, time ${count * 1000}ms`);
    return { output: lines.join('\r\n'), exitCode: 0 };
  }

  private cmdCurlWget(args: string[], tool: string): CommandResult {
    const url = args.find(a => !a.startsWith('-') && a !== tool) || '';
    if (!url) return { output: `${C.red}${tool}: no URL specified${C.reset}`, exitCode: 1 };
    return { output: `${C.yellow}${tool}: network access is not available in the browser terminal.\r\nURL: ${url}\r\nTo fetch content in a real environment: ${tool} ${url}${C.reset}`, exitCode: 0 };
  }

  private cmdSsh(): CommandResult {
    return { output: `${C.yellow}ssh: network connections are not available in the browser terminal.${C.reset}`, exitCode: 0 };
  }

  private cmdScp(): CommandResult {
    return { output: `${C.yellow}scp: network connections are not available in the browser terminal.${C.reset}`, exitCode: 0 };
  }

  private cmdIfconfig(): CommandResult {
    return { output: [
      'eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500',
      '        inet 172.17.0.2  netmask 255.255.0.0  broadcast 172.17.255.255',
      '        inet6 fe80::42:acff:fe11:2  prefixlen 64  scopeid 0x20<link>',
      '        ether 02:42:ac:11:00:02  txqueuelen 0  (Ethernet)',
      '        RX packets 100  bytes 8400 (8.4 KB)',
      '        TX packets 80  bytes 6720 (6.7 KB)',
      '',
      'lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536',
      '        inet 127.0.0.1  netmask 255.0.0.0',
      '        inet6 ::1  prefixlen 128  scopeid 0x10<host>',
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdIp(args: string[]): CommandResult {
    const sub = args[1] || '';
    if (sub === 'addr' || sub === 'a') return this.cmdIfconfig();
    if (sub === 'route' || sub === 'r') return { output: 'default via 172.17.0.1 dev eth0\n172.17.0.0/16 dev eth0 proto kernel scope link src 172.17.0.2', exitCode: 0 };
    if (sub === 'link' || sub === 'l') return { output: '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP', exitCode: 0 };
    return { output: 'Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nOBJECT := { addr | route | link | neigh | rule }', exitCode: 0 };
  }

  private cmdNetstat(args: string[]): CommandResult {
    return { output: [
      'Active Internet connections (servers and established)',
      'Proto Recv-Q Send-Q Local Address           Foreign Address         State',
      'tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN',
      'tcp        0      0 127.0.0.1:25            0.0.0.0:*               LISTEN',
      'tcp        0     52 172.17.0.2:22           172.17.0.1:54321        ESTABLISHED',
      'Active UNIX domain sockets',
      'Proto RefCnt Flags       Type       State         I-Node   Path',
      'unix  2      [ ACC ]     STREAM     LISTENING      12345   /run/systemd/private/tmp-XXXXXX',
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdSs(args: string[]): CommandResult {
    const flags = args.slice(1).join('');
    const listening = flags.includes('l');
    return { output: [
      'Netid  State      Recv-Q Send-Q    Local Address:Port    Peer Address:Port',
      'tcp    LISTEN     0      128       *:22                  *:*',
      ...(listening ? [] : ['tcp    ESTAB      0      0         172.17.0.2:22         172.17.0.1:54321']),
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdTraceroute(args: string[]): CommandResult {
    const host = args.find(a => !a.startsWith('-') && a !== 'traceroute') || '';
    if (!host) return { output: `${C.red}traceroute: missing host${C.reset}`, exitCode: 1 };
    const hops = [['1', '172.17.0.1', '0.5 ms'], ['2', '10.0.0.1', '2.1 ms'], ['3', '192.168.1.1', '5.3 ms'], ['*', '*', '*']];
    const out = [`traceroute to ${host} (93.184.216.34), 30 hops max, 60 byte packets`];
    hops.forEach(([n, ip, t]) => out.push(` ${n.padStart(2)}  ${ip} (${ip})  ${t}`));
    return { output: out.join('\r\n'), exitCode: 0 };
  }

  private cmdDig(args: string[]): CommandResult {
    const host = args.find(a => !a.startsWith('-') && !a.startsWith('@') && a !== 'dig') || 'example.com';
    return { output: `; <<>> DiG 9.11.4 <<>> ${host}\n;; QUESTION SECTION:\n;${host}.\t\tIN\tA\n\n;; ANSWER SECTION:\n${host}.\t\t300\tIN\tA\t93.184.216.34\n\n;; Query time: 5 msec\n;; SERVER: 8.8.8.8#53(8.8.8.8)`, exitCode: 0 };
  }

  private cmdNslookup(args: string[]): CommandResult {
    const host = args.find(a => !a.startsWith('-') && a !== 'nslookup') || '';
    if (!host) return { output: `${C.red}nslookup: missing hostname${C.reset}`, exitCode: 1 };
    return { output: `Server:\t\t8.8.8.8\nAddress:\t8.8.8.8#53\n\nNon-authoritative answer:\nName:\t${host}\nAddress: 93.184.216.34`, exitCode: 0 };
  }

  private cmdHost(args: string[]): CommandResult {
    const host = args[1] || '';
    return { output: `${host} has address 93.184.216.34\n${host} mail is handled by 0 .`, exitCode: 0 };
  }

  // ─── ENV / SHELL ────────────────────────────────────────────────────────

  private cmdEnv(): CommandResult {
    const lines = Object.entries(this.state.env).map(([k, v]) => `${k}=${v}`);
    return { output: lines.join('\r\n'), exitCode: 0 };
  }

  private cmdExport(args: string[]): CommandResult {
    for (const a of args.slice(1)) {
      if (a.includes('=')) {
        const [k, ...v] = a.split('=');
        this.state.env[k] = v.join('=');
      } else {
        // just mark as exported (already in env)
      }
    }
    if (args.length === 1) {
      const lines = Object.entries(this.state.env).map(([k, v]) => `declare -x ${k}="${v}"`);
      return { output: lines.join('\r\n'), exitCode: 0 };
    }
    return { output: '', exitCode: 0 };
  }

  private cmdUnset(args: string[]): CommandResult {
    for (const a of args.slice(1)) delete this.state.env[a];
    return { output: '', exitCode: 0 };
  }

  private cmdSet(): CommandResult {
    const lines = Object.entries(this.state.env).map(([k, v]) => `${k}='${v}'`);
    return { output: lines.join('\r\n'), exitCode: 0 };
  }

  private cmdSource(args: string[]): CommandResult {
    const file = args[1];
    if (!file) return { output: `${C.red}source: filename argument required${C.reset}`, exitCode: 1 };
    const path = this.fs.resolve(file, this.state.cwd);
    if (!this.fs.exists(path)) return { output: `${C.red}bash: ${file}: No such file or directory${C.reset}`, exitCode: 1 };
    const content = this.fs.get(path)!.content;
    let lastResult: CommandResult = { output: '', exitCode: 0 };
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) lastResult = this.execute(trimmed);
    }
    return lastResult;
  }

  private cmdAlias(args: string[]): CommandResult {
    if (args.length === 1) {
      return { output: Object.entries(this.state.aliases).map(([k, v]) => `alias ${k}='${v}'`).join('\r\n'), exitCode: 0 };
    }
    for (const a of args.slice(1)) {
      if (a.includes('=')) {
        const eq = a.indexOf('=');
        const k = a.slice(0, eq);
        const v = a.slice(eq + 1).replace(/^['"]|['"]$/g, '');
        this.state.aliases[k] = v;
      } else {
        if (this.state.aliases[a]) return { output: `alias ${a}='${this.state.aliases[a]}'`, exitCode: 0 };
      }
    }
    return { output: '', exitCode: 0 };
  }

  private cmdUnalias(args: string[]): CommandResult {
    if (args.includes('-a')) { this.state.aliases = {}; return { output: '', exitCode: 0 }; }
    for (const a of args.slice(1)) delete this.state.aliases[a];
    return { output: '', exitCode: 0 };
  }

  private cmdHistory(args: string[]): CommandResult {
    const n = parseInt(args[1]) || this.state.history.length;
    const lines = this.state.history.slice(-n).map((cmd, i, arr) => {
      const num = this.state.history.length - arr.length + i + 1;
      return `  ${String(num).padStart(4)}  ${cmd}`;
    });
    return { output: lines.join('\r\n'), exitCode: 0 };
  }

  // ─── USER MANAGEMENT ────────────────────────────────────────────────────

  private cmdW(): CommandResult {
    const now = new Date();
    const time = now.toLocaleTimeString();
    return { output: [
      ` ${time} up 1 day,  0:01,  1 user,  load average: 0.01, 0.05, 0.05`,
      'USER     TTY      FROM             LOGIN@   IDLE JCPU   PCPU WHAT',
      `${this.state.user.padEnd(8)} pts/0    172.17.0.1      10:01    0.00s  0.05s  0.01s w`,
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdWho(): CommandResult {
    return { output: `${this.state.user}   pts/0        ${new Date().toLocaleDateString()} 10:01 (172.17.0.1)`, exitCode: 0 };
  }

  private cmdLast(): CommandResult {
    return { output: [
      `${this.state.user}   pts/0        172.17.0.1      Mon Jun 16 10:01   still logged in`,
      `${this.state.user}   pts/0        172.17.0.1      Sun Jun 15 09:00 - 11:00  (02:00)`,
      '',
      'wtmp begins Sun Jun 15 09:00:00 2025',
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdLastlog(): CommandResult {
    return { output: [
      'Username         Port     From             Latest',
      `root             pts/0    172.17.0.1       Mon Jun 16 10:00:00 +0000 2025`,
      `${this.state.user.padEnd(16)} pts/0    172.17.0.1       Mon Jun 16 10:01:00 +0000 2025`,
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdSudo(args: string[]): CommandResult {
    if (args.length < 2) return { output: 'usage: sudo [-u user] command', exitCode: 1 };
    if (args[1] === '-u') {
      const user = args[2];
      const cmd = args.slice(3).join(' ');
      const prevUser = this.state.user;
      this.state.user = user;
      const r = this.execute(cmd);
      this.state.user = prevUser;
      return r;
    }
    const cmd = args.slice(1).join(' ');
    const prevUser = this.state.user;
    this.state.user = 'root';
    const r = this.execute(cmd);
    this.state.user = prevUser;
    return r;
  }

  private simulatedSudo(cmd: string): CommandResult {
    return { output: `${C.yellow}${cmd}: simulated — user management commands run but changes are not persistent.${C.reset}`, exitCode: 0 };
  }

  // ─── SERVICE MANAGEMENT ────────────────────────────────────────────────

  private cmdSystemctl(args: string[]): CommandResult {
    const sub = args[1] || 'status';
    const unit = args[2] || '';
    const fakeServices: Record<string, string> = {
      sshd: 'active (running)', httpd: 'inactive (dead)', nginx: 'inactive (dead)',
      crond: 'active (running)', firewalld: 'active (running)', docker: 'inactive (dead)',
    };
    if (sub === 'list-units' || sub === 'status' && !unit) {
      const lines = ['UNIT                     LOAD   ACTIVE SUB     DESCRIPTION'];
      Object.entries(fakeServices).forEach(([svc, st]) => {
        lines.push(`  ${svc}.service          ${C.green}loaded${C.reset} ${st.includes('running') ? C.green + 'active' + C.reset : C.red + 'inactive' + C.reset}  running  ${svc} daemon`);
      });
      return { output: lines.join('\r\n'), exitCode: 0 };
    }
    if (unit) {
      const status = fakeServices[unit] || 'inactive (dead)';
      const active = status.includes('running');
      if (sub === 'status') {
        return { output: [
          `● ${unit}.service - ${unit} daemon`,
          `   Loaded: loaded (/usr/lib/systemd/system/${unit}.service; enabled)`,
          `   Active: ${active ? C.green + status + C.reset : C.red + status + C.reset}`,
          active ? `  Process: 100 ExecStart=/usr/sbin/${unit} -D` : '',
        ].filter(Boolean).join('\r\n'), exitCode: active ? 0 : 3 };
      }
      if (sub === 'start') { fakeServices[unit] = 'active (running)'; return { output: '', exitCode: 0 }; }
      if (sub === 'stop') { fakeServices[unit] = 'inactive (dead)'; return { output: '', exitCode: 0 }; }
      if (sub === 'restart') return { output: '', exitCode: 0 };
      if (sub === 'enable') return { output: `Created symlink /etc/systemd/system/multi-user.target.wants/${unit}.service`, exitCode: 0 };
      if (sub === 'disable') return { output: `Removed symlink /etc/systemd/system/multi-user.target.wants/${unit}.service`, exitCode: 0 };
      if (sub === 'is-active') return { output: active ? 'active' : 'inactive', exitCode: active ? 0 : 3 };
      if (sub === 'is-enabled') return { output: 'enabled', exitCode: 0 };
    }
    return { output: `${C.yellow}systemctl: ${sub} not fully simulated${C.reset}`, exitCode: 0 };
  }

  private cmdService(args: string[]): CommandResult {
    const [, name, action] = args;
    if (!name || !action) return { output: 'Usage: service <name> <start|stop|restart|status>', exitCode: 1 };
    return this.cmdSystemctl(['systemctl', action, name]);
  }

  private cmdJournalctl(args: string[]): CommandResult {
    const flags = args.slice(1).join(' ');
    const unit = args.find(a => a.startsWith('-u'))?.slice(2) || args[args.indexOf('-u') + 1];
    const lines = [
      '-- Logs begin at Mon 2025-06-16 10:00:00 UTC --',
      `Jun 16 10:00:01 centos-playground systemd[1]: Started System Logging Service.`,
      `Jun 16 10:00:02 centos-playground systemd[1]: Started OpenSSH server daemon.`,
      `Jun 16 10:00:03 centos-playground sshd[100]: Server listening on 0.0.0.0 port 22.`,
      `Jun 16 10:01:00 centos-playground sshd[200]: Accepted publickey for user from 172.17.0.1`,
    ];
    if (unit) return { output: lines.filter(l => l.includes(unit) || l.includes('begin')).join('\r\n'), exitCode: 0 };
    if (args.includes('-f')) return { output: lines.join('\r\n') + `\r\n${C.yellow}(journalctl -f not supported in browser)${C.reset}`, exitCode: 0 };
    if (flags.includes('-n')) {
      const n = parseInt(args[args.indexOf('-n') + 1]) || 10;
      return { output: lines.slice(-n).join('\r\n'), exitCode: 0 };
    }
    return { output: lines.join('\r\n'), exitCode: 0 };
  }

  private cmdCrontab(args: string[]): CommandResult {
    if (args.includes('-l')) return { output: '# m h dom mon dow command\n0 2 * * * /home/user/backup.sh', exitCode: 0 };
    if (args.includes('-e')) return { output: `${C.yellow}crontab: editor not available in browser terminal${C.reset}`, exitCode: 0 };
    if (args.includes('-r')) return { output: '', exitCode: 0 };
    return { output: 'usage: crontab [-l|-e|-r]', exitCode: 0 };
  }

  // ─── PACKAGE MANAGEMENT ────────────────────────────────────────────────

  private cmdPackage(tool: string, args: string[]): CommandResult {
    const sub = args[1] || 'help';
    const pkg = args.slice(2).filter(a => a !== '-y').join(' ');
    if (sub === 'install' || sub === 'update' || sub === 'upgrade') {
      return { output: [
        `${tool === 'yum' ? 'Loaded plugins: fastestmirror' : 'Last metadata expiration check: 0:05:32 ago'}`,
        `Resolving Dependencies...`,
        `--> Running transaction check`,
        `---> Package ${pkg || 'package'}.x86_64 0:1.0.0 will be installed`,
        `Dependencies Resolved`,
        `Transaction Summary`,
        `Install  1 Package`,
        `Total download size: 1.2 M`,
        `Installed size: 3.5 M`,
        `Downloading packages...`,
        `Running transaction`,
        `  Installing : ${pkg || 'package'}.x86_64`,
        `Installed: ${pkg || 'package'}.x86_64`,
        `Complete!`,
      ].join('\r\n'), exitCode: 0 };
    }
    if (sub === 'remove' || sub === 'erase') return { output: `Removed: ${pkg}`, exitCode: 0 };
    if (sub === 'search') return { output: `${C.yellow}Searching for '${pkg}'...\r\n======================== Matched: ${pkg} ========================\r\n${pkg}.x86_64 : ${pkg} package for CentOS${C.reset}`, exitCode: 0 };
    if (sub === 'info') return { output: `Name        : ${pkg}\nArch        : x86_64\nVersion     : 1.0.0\nRelease     : 1.el7\nSize        : 3.5 M\nRepo        : base`, exitCode: 0 };
    if (sub === 'list') return { output: `Installed Packages\nbash.x86_64                  4.2.46-35.el7\nopenssl.x86_64               1.0.2k-26.el7\ncurl.x86_64                  7.29.0-59.el7`, exitCode: 0 };
    return { output: `Usage: ${tool} [install|remove|update|search|info|list]`, exitCode: 0 };
  }

  private cmdRpm(args: string[]): CommandResult {
    const flags = args.slice(1).join(' ');
    if (flags.includes('-q')) return { output: 'bash-4.2.46-35.el7.x86_64\nopenssl-1.0.2k-26.el7.x86_64\ncurl-7.29.0-59.el7.x86_64', exitCode: 0 };
    if (flags.includes('-qa')) return { output: 'bash-4.2.46-35.el7.x86_64\ncoreutils-8.22-24.el7.x86_64\ncurl-7.29.0-59.el7.x86_64', exitCode: 0 };
    if (flags.includes('-i') || flags.includes('-U')) return { output: 'Installing package...', exitCode: 0 };
    return { output: 'Usage: rpm [-qa] [-q package] [-i package.rpm]', exitCode: 0 };
  }

  private cmdPip(args: string[]): CommandResult {
    const sub = args[1] || 'help';
    const pkg = args.slice(2).join(' ');
    if (sub === 'install') return { output: `Collecting ${pkg}\r\nSuccessfully installed ${pkg}`, exitCode: 0 };
    if (sub === 'list') return { output: 'Package    Version\n---------- -------\npip        23.0.1\nsetuptools 67.6.0\nwheel      0.40.0', exitCode: 0 };
    if (sub === 'freeze') return { output: 'pip==23.0.1\nsetuptools==67.6.0\nwheel==0.40.0', exitCode: 0 };
    if (sub === 'uninstall') return { output: `Successfully uninstalled ${pkg}`, exitCode: 0 };
    return { output: 'Usage: pip [install|uninstall|list|freeze|show]', exitCode: 0 };
  }

  // ─── ARCHIVE ────────────────────────────────────────────────────────────

  private cmdTar(args: string[]): CommandResult {
    const flags = args.slice(1).join('');
    const files = args.filter(a => !a.startsWith('-') && a !== 'tar');
    if (flags.includes('c')) {
      const archive = files[0] || 'archive.tar.gz';
      const srcs = files.slice(1);
      return { output: `tar: Creating archive ${archive}\n` + srcs.map(f => `tar: adding ${f}`).join('\n'), exitCode: 0 };
    }
    if (flags.includes('x')) {
      const archive = files[0] || 'archive.tar.gz';
      return { output: `tar: Extracting ${archive}\ntar: x file1.txt\ntar: x file2.txt`, exitCode: 0 };
    }
    if (flags.includes('t') || flags.includes('l')) {
      const archive = files[0] || 'archive.tar.gz';
      return { output: `tar: listing ${archive}\nfile1.txt\nfile2.txt\ndir/\ndir/file3.txt`, exitCode: 0 };
    }
    return { output: 'Usage: tar [czxvtf] [archive] [files...]', exitCode: 0 };
  }

  private cmdGzip(args: string[]): CommandResult {
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    const keep = args.includes('-k');
    const list = args.includes('-l');
    if (list) return { output: `         compressed        uncompressed  ratio uncompressed_name\n               1024                2048  50.0% ${files[0] || 'file'}.gz`, exitCode: 0 };
    if (!files.length) return { output: `${C.red}gzip: missing operand${C.reset}`, exitCode: 1 };
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (!this.fs.exists(path)) return { output: `${C.red}gzip: ${f}: No such file or directory${C.reset}`, exitCode: 1 };
      const node = this.fs.get(path)!;
      this.fs.createFile(path + '.gz', `[gzip compressed: ${node.size} bytes]`, node.owner, node.permissions);
      if (!keep) this.fs.deleteNode(path);
    }
    return { output: '', exitCode: 0 };
  }

  private cmdGunzip(args: string[]): CommandResult {
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (!this.fs.exists(path)) return { output: `${C.red}gunzip: ${f}: No such file or directory${C.reset}`, exitCode: 1 };
      this.fs.createFile(path.replace(/\.gz$/, ''), 'decompressed content', 'user', 0o644);
      this.fs.deleteNode(path);
    }
    return { output: '', exitCode: 0 };
  }

  private cmdZip(args: string[]): CommandResult {
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    if (files.length < 2) return { output: `${C.red}zip: missing operand${C.reset}`, exitCode: 1 };
    const [archive, ...srcs] = files;
    return { output: `  adding: ${srcs.join('\n  adding: ')}\n  archive: ${archive}`, exitCode: 0 };
  }

  private cmdUnzip(args: string[]): CommandResult {
    const file = args.find(a => !a.startsWith('-') && a !== 'unzip') || '';
    if (!file) return { output: `${C.red}unzip: missing archive${C.reset}`, exitCode: 1 };
    return { output: `Archive:  ${file}\n  inflating: file1.txt\n  inflating: file2.txt`, exitCode: 0 };
  }

  // ─── GIT ────────────────────────────────────────────────────────────────

  private cmdGit(args: string[]): CommandResult {
    const sub = args[1] || 'help';
    const rest = args.slice(2);

    const gitHelp = `${C.boldYellow}usage: git [--version] [--help] <command> [<args>]\n\nCommon commands:\n${C.reset}   init        Create empty repo\n   clone       Clone a repository\n   add         Stage changes\n   commit      Record changes\n   push        Push to remote\n   pull        Fetch and merge\n   status      Show status\n   log         Show commit log\n   branch      List/create/delete branches\n   checkout    Switch branches or restore files\n   merge       Merge branches\n   diff        Show changes\n   reset       Reset changes\n   stash       Stash changes\n   tag         Create a tag\n   remote      Manage remotes`;

    if (sub === '--version') return { output: 'git version 2.40.1', exitCode: 0 };
    if (sub === 'help' || sub === '--help') return { output: gitHelp, exitCode: 0 };

    // Check if we're in a git repo
    const isGitRepo = this.fs.exists(this.state.cwd + '/.git') || this.state.cwd.includes('myapp');

    if (sub === 'init') {
      const dir = rest[0] ? this.fs.resolve(rest[0], this.state.cwd) : this.state.cwd;
      this.fs.createDir(dir + '/.git');
      this.fs.createDir(dir + '/.git/objects');
      this.fs.createDir(dir + '/.git/refs');
      this.fs.createFile(dir + '/.git/HEAD', 'ref: refs/heads/main\n');
      this.fs.createFile(dir + '/.git/config', '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n');
      return { output: `Initialized empty Git repository in ${dir}/.git/`, exitCode: 0 };
    }
    if (sub === 'clone') {
      const url = rest[0] || '';
      const name = url.split('/').pop()?.replace('.git', '') || 'repo';
      const destPath = this.fs.resolve(name, this.state.cwd);
      this.fs.createDir(destPath);
      this.fs.createDir(destPath + '/.git');
      this.fs.createFile(destPath + '/README.md', `# ${name}\n\nCloned from ${url}\n`);
      return { output: `Cloning into '${name}'...\nremote: Enumerating objects: 10\nremote: Counting objects: 100% (10/10)\nDone.`, exitCode: 0 };
    }
    if (!isGitRepo && !['init','clone'].includes(sub)) {
      return { output: `${C.red}fatal: not a git repository (or any parent): .git${C.reset}`, exitCode: 128 };
    }
    if (sub === 'status') return { output: [
      'On branch main',
      "Your branch is up to date with 'origin/main'.",
      '',
      'Changes not staged for commit:',
      '  (use "git add <file>..." to update what will be committed)',
      `\t${C.red}modified:   app.sh${C.reset}`,
      '',
      'Untracked files:',
      '  (use "git add <file>..." to include in what will be committed)',
      `\t${C.red}config.txt${C.reset}`,
    ].join('\r\n'), exitCode: 0 };
    if (sub === 'add') return { output: '', exitCode: 0 };
    if (sub === 'commit') {
      const msg = rest.includes('-m') ? rest[rest.indexOf('-m') + 1] : 'update';
      return { output: `[main abc1234] ${msg}\n 1 file changed, 1 insertion(+)`, exitCode: 0 };
    }
    if (sub === 'log') return { output: [
      `${C.yellow}commit abc1234def5678 (HEAD -> main, origin/main)${C.reset}`,
      'Author: user <user@example.com>',
      `Date:   ${new Date().toUTCString()}`,
      '',
      '    Initial commit',
      '',
      `${C.yellow}commit def9876abc5432${C.reset}`,
      'Author: user <user@example.com>',
      'Date:   Mon Jun 15 10:00:00 2025 +0000',
      '',
      '    Add README',
    ].join('\r\n'), exitCode: 0 };
    if (sub === 'branch') {
      if (rest.length === 0 || rest[0] === '-a') return { output: `* ${C.green}main${C.reset}\n  develop\n  feature/new-feature`, exitCode: 0 };
      return { output: '', exitCode: 0 };
    }
    if (sub === 'checkout') {
      const branch = rest.filter(r => !r.startsWith('-'))[0];
      return { output: branch ? `Switched to branch '${branch}'` : 'Already on main', exitCode: 0 };
    }
    if (sub === 'merge') return { output: `Merge made by the 'recursive' strategy.`, exitCode: 0 };
    if (sub === 'push') return { output: 'Enumerating objects: 3\nCounting objects: 100%\nWriting objects: 100%\nTo origin\n   abc1234..def9876  main -> main', exitCode: 0 };
    if (sub === 'pull') return { output: 'Already up to date.', exitCode: 0 };
    if (sub === 'fetch') return { output: '', exitCode: 0 };
    if (sub === 'stash') return { output: rest[0] === 'pop' ? 'Dropped refs/stash@{0}' : 'Saved working directory and index state WIP on main', exitCode: 0 };
    if (sub === 'diff') return { output: `${C.yellow}diff --git a/app.sh b/app.sh\nindex abc..def 100644\n--- a/app.sh\n+++ b/app.sh\n@@ -1,3 +1,4 @@\n #!/bin/bash\n echo "Starting..."\n+echo "Added line"\n echo "Done!"${C.reset}`, exitCode: 0 };
    if (sub === 'reset') return { output: 'Unstaged changes after reset:\nM\tapp.sh', exitCode: 0 };
    if (sub === 'remote') return { output: 'origin\thttps://github.com/user/myapp.git (fetch)\norigin\thttps://github.com/user/myapp.git (push)', exitCode: 0 };
    if (sub === 'tag') return rest.length ? { output: '', exitCode: 0 } : { output: 'v1.0.0\nv1.1.0', exitCode: 0 };
    if (sub === 'config') {
      const key = rest[0] || '';
      if (key === '--list') return { output: 'user.name=user\nuser.email=user@example.com\ncore.editor=vi', exitCode: 0 };
      return { output: '', exitCode: 0 };
    }
    if (sub === 'show') return { output: `commit abc1234\nAuthor: user\nDate: ${new Date().toUTCString()}\n\n    Initial commit`, exitCode: 0 };
    return { output: `git: '${sub}' is a valid command. See 'git --help'.`, exitCode: 0 };
  }

  // ─── DOCKER ────────────────────────────────────────────────────────────

  private cmdDocker(args: string[]): CommandResult {
    const sub = args[1] || 'help';
    const containerNote = `${C.cyan}[Note: Running in browser terminal - Docker commands are simulated]${C.reset}`;
    if (sub === '--version' || sub === 'version') return { output: 'Docker version 24.0.5, build ced0996', exitCode: 0 };
    if (sub === 'ps') {
      const all = args.includes('-a');
      const header = 'CONTAINER ID   IMAGE         COMMAND                  CREATED         STATUS         PORTS     NAMES';
      const rows = all ? [
        'abc1234def56   nginx:latest  "/docker-entrypoint.…"   2 hours ago     Exited (0)               web-server',
        '789xyz012345   redis:7       "docker-entrypoint.s…"   1 hour ago      Exited (0)               redis-cache',
      ] : [];
      return { output: [containerNote, header, ...rows].join('\r\n'), exitCode: 0 };
    }
    if (sub === 'images') return { output: [
      containerNote,
      'REPOSITORY    TAG       IMAGE ID       CREATED         SIZE',
      'nginx         latest    abc123456789   2 weeks ago     187MB',
      'redis         7         def987654321   3 weeks ago     117MB',
      'centos        7         ghi246810121   4 months ago    204MB',
    ].join('\r\n'), exitCode: 0 };
    if (sub === 'pull') return { output: `${containerNote}\nPulling from library/${args[2] || 'image'}\nStatus: Downloaded newer image`, exitCode: 0 };
    if (sub === 'run') return { output: `${containerNote}\nabc1234def56`, exitCode: 0 };
    if (sub === 'stop' || sub === 'start' || sub === 'restart') return { output: `${containerNote}\n${args[2] || ''}`, exitCode: 0 };
    if (sub === 'rm') return { output: `${containerNote}\n${args[2] || ''}`, exitCode: 0 };
    if (sub === 'rmi') return { output: `${containerNote}\nUntagged: ${args[2] || ''}`, exitCode: 0 };
    if (sub === 'exec') return { output: containerNote, exitCode: 0 };
    if (sub === 'logs') return { output: `${containerNote}\n2025-06-16T10:00:00.000Z Starting...\n2025-06-16T10:00:01.000Z Ready`, exitCode: 0 };
    if (sub === 'build') return { output: `${containerNote}\nStep 1/3 : FROM centos:7\nSuccessfully built abc123456789`, exitCode: 0 };
    if (sub === 'inspect') return { output: `${containerNote}\n[{"Id": "abc1234", "State": {"Status": "running"}}]`, exitCode: 0 };
    if (sub === 'network') return { output: `${containerNote}\nNETWORK ID     NAME      DRIVER    SCOPE\nabc123         bridge    bridge    local\ndef456         host      host      local`, exitCode: 0 };
    if (sub === 'volume') return { output: `${containerNote}\nDRIVER    VOLUME NAME`, exitCode: 0 };
    if (sub === 'info') return { output: `${containerNote}\nContainers: 2\nImages: 3\nServer Version: 24.0.5\nStorage Driver: overlay2`, exitCode: 0 };
    return { output: `${containerNote}\nUsage: docker [OPTIONS] COMMAND\nRun 'docker COMMAND --help' for more information`, exitCode: 0 };
  }

  private cmdDockerCompose(args: string[]): CommandResult {
    const sub = args[1] || 'help';
    const note = `${C.cyan}[docker-compose commands are simulated]${C.reset}`;
    if (sub === 'up') return { output: `${note}\nStarting services...\nDone.`, exitCode: 0 };
    if (sub === 'down') return { output: `${note}\nStopping services...\nDone.`, exitCode: 0 };
    if (sub === 'ps') return { output: `${note}\nName    Command   State   Ports`, exitCode: 0 };
    if (sub === 'logs') return { output: `${note}\n[service logs here]`, exitCode: 0 };
    if (sub === 'build') return { output: `${note}\nBuilding services...`, exitCode: 0 };
    return { output: `${note}\nUsage: docker-compose [up|down|ps|logs|build]`, exitCode: 0 };
  }

  // ─── MISC UTILITIES ─────────────────────────────────────────────────────

  private cmdMan(args: string[]): CommandResult {
    const cmd = args[1] || '';
    if (!cmd) return { output: `${C.red}What manual page do you want?${C.reset}`, exitCode: 1 };
    return { output: `${C.bold}${cmd.toUpperCase()}(1)${C.reset}\r\n\r\n${C.bold}NAME${C.reset}\r\n       ${cmd} - see 'centos-help' sidebar for full documentation\r\n\r\n${C.bold}SYNOPSIS${C.reset}\r\n       ${cmd} [OPTION]... [ARGS]...\r\n\r\n${C.bold}DESCRIPTION${C.reset}\r\n       Use the Command Library tab for full documentation, options, and examples.\r\n\r\n${C.yellow}Tip: Press Ctrl+C to exit man${C.reset}`, exitCode: 0 };
  }

  private cmdHelp(): CommandResult {
    return { output: [
      `${C.boldGreen}CentOS Playground - Browser Terminal${C.reset}`,
      `${C.cyan}This is a full Linux emulator running in your browser.${C.reset}`,
      '',
      `${C.bold}Available command categories:${C.reset}`,
      `  ${C.yellow}File Management:${C.reset}   ls, cd, pwd, mkdir, rm, cp, mv, touch, ln, stat, file, tree`,
      `  ${C.yellow}Text Processing:${C.reset}   cat, head, tail, grep, sed, awk, sort, uniq, wc, cut, tr, diff`,
      `  ${C.yellow}System Info:${C.reset}       uname, hostname, date, uptime, df, du, free, lscpu, lsblk, ps, top`,
      `  ${C.yellow}Permissions:${C.reset}       chmod, chown, chgrp, umask`,
      `  ${C.yellow}Search:${C.reset}            find, locate, which, whereis, type`,
      `  ${C.yellow}Network:${C.reset}           ping, curl, wget, ifconfig, ip, netstat, ss, dig, nslookup`,
      `  ${C.yellow}Archive:${C.reset}           tar, gzip, gunzip, zip, unzip`,
      `  ${C.yellow}Package Mgmt:${C.reset}      yum, dnf, rpm, pip`,
      `  ${C.yellow}Services:${C.reset}          systemctl, service, journalctl, crontab`,
      `  ${C.yellow}User Mgmt:${C.reset}         whoami, id, w, who, last, sudo`,
      `  ${C.yellow}Git:${C.reset}               git init/clone/add/commit/push/pull/status/log/branch`,
      `  ${C.yellow}Docker:${C.reset}            docker ps/images/run/stop/rm/build/logs`,
      `  ${C.yellow}Shell:${C.reset}             echo, export, alias, history, env, set, source`,
      '',
      `${C.bold}Keyboard shortcuts:${C.reset}`,
      `  ${C.cyan}Ctrl+L${C.reset}  clear screen    ${C.cyan}Ctrl+C${C.reset}  interrupt`,
      `  ${C.cyan}Tab${C.reset}     autocomplete     ${C.cyan}↑↓${C.reset}      history navigation`,
      '',
      `${C.dim}Pipes, redirects (> >>), && and ; chains are all supported.${C.reset}`,
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdTree(args: string[]): CommandResult {
    const flags = args.slice(1).join('');
    const maxDepth = flags.includes('L') ? parseInt(args[args.indexOf('-L') + 1]) || 3 : 3;
    const showHidden = flags.includes('a');
    const target = args.find((a, i) => i > 0 && !a.startsWith('-') && args[i-1] !== '-L') || this.state.cwd;
    const startPath = this.fs.resolve(target, this.state.cwd);
    if (!this.fs.exists(startPath)) return { output: `${C.red}tree: '${target}': No such file${C.reset}`, exitCode: 1 };

    let fileCount = 0;
    let dirCount = 0;
    const lines: string[] = [startPath];

    const walk = (path: string, prefix: string, depth: number) => {
      if (depth > maxDepth) return;
      const children = this.fs.listDir(path).filter(c => showHidden || !c.name.startsWith('.'));
      children.forEach((child, i) => {
        const isLast = i === children.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPath = path + (path === '/' ? '' : '/') + child.name;
        const name = child.type === 'directory' ? C.boldBlue + child.name + C.reset : child.name;
        lines.push(prefix + connector + name);
        if (child.type === 'directory') { dirCount++; walk(childPath, prefix + (isLast ? '    ' : '│   '), depth + 1); }
        else fileCount++;
      });
    };
    walk(startPath, '', 1);
    lines.push(`\n${dirCount} directories, ${fileCount} files`);
    return { output: lines.join('\r\n'), exitCode: 0 };
  }

  private cmdXargs(args: string[], stdin: string): CommandResult {
    const cmd = args.slice(1).join(' ');
    if (!cmd) return { output: `${C.red}xargs: missing command${C.reset}`, exitCode: 1 };
    const items = stdin.trim().split(/\s+/);
    const results = items.map(item => this.execute(`${cmd} ${item}`).output).filter(Boolean);
    return { output: results.join('\r\n'), exitCode: 0 };
  }

  private cmdTee(args: string[], stdin: string): CommandResult {
    const append = args.includes('-a');
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (append) this.fs.appendFile(path, stdin + '\n');
      else this.fs.writeFile(path, stdin + '\n');
    }
    return { output: stdin, exitCode: 0 };
  }

  private cmdColumn(args: string[], stdin: string): CommandResult {
    const lines = (stdin || '').split('\n').filter(Boolean);
    if (!lines.length) return { output: '', exitCode: 0 };
    return { output: lines.join('\r\n'), exitCode: 0 };
  }

  private cmdPaste(args: string[], _stdin: string): CommandResult {
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    if (!files.length) return { output: '', exitCode: 0 };
    const allCols = files.map(f => {
      const path = this.fs.resolve(f, this.state.cwd);
      return this.fs.exists(path) ? this.fs.get(path)!.content.split('\n') : [];
    });
    const maxLen = Math.max(...allCols.map(c => c.length));
    const out: string[] = [];
    for (let i = 0; i < maxLen; i++) out.push(allCols.map(c => c[i] || '').join('\t'));
    return { output: out.join('\r\n'), exitCode: 0 };
  }

  private cmdJoin(args: string[], _stdin: string): CommandResult {
    return { output: `${C.yellow}join: basic implementation - see full docs in Command Library${C.reset}`, exitCode: 0 };
  }

  private cmdNl(args: string[], stdin: string): CommandResult {
    const { lines, err } = this.getContent(args, stdin);
    if (err) return { output: `${C.red}${err}${C.reset}`, exitCode: 1 };
    return { output: lines.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\r\n'), exitCode: 0 };
  }

  private cmdStrings(args: string[]): CommandResult {
    const files = args.slice(1).filter(a => !a.startsWith('-'));
    const out: string[] = [];
    for (const f of files) {
      const path = this.fs.resolve(f, this.state.cwd);
      if (!this.fs.exists(path)) return { output: `${C.red}strings: ${f}: No such file${C.reset}`, exitCode: 1 };
      const content = this.fs.get(path)!.content;
      const matches = content.match(/[\x20-\x7E]{4,}/g) || [];
      out.push(...matches);
    }
    return { output: out.join('\r\n'), exitCode: 0 };
  }

  private cmdBasename(args: string[]): CommandResult {
    const path = args[1] || '';
    const suffix = args[2] || '';
    let base = path.split('/').pop() || path;
    if (suffix && base.endsWith(suffix)) base = base.slice(0, -suffix.length);
    return { output: base, exitCode: 0 };
  }

  private cmdDirname(args: string[]): CommandResult {
    const path = args[1] || '.';
    const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) || '/' : '.';
    return { output: dir, exitCode: 0 };
  }

  private cmdRealpath(args: string[]): CommandResult {
    const path = args[1] || '.';
    return { output: this.fs.resolve(path, this.state.cwd), exitCode: 0 };
  }

  private cmdReadlink(args: string[]): CommandResult {
    const path = this.fs.resolve(args[1] || '', this.state.cwd);
    const node = this.fs.get(path);
    if (!node) return { output: `${C.red}readlink: ${args[1]}: No such file${C.reset}`, exitCode: 1 };
    return { output: node.type === 'symlink' ? node.content : path, exitCode: 0 };
  }

  private cmdMktemp(args: string[]): CommandResult {
    const dir = args.includes('-d');
    const name = `/tmp/tmp.${Math.random().toString(36).substr(2, 8)}`;
    if (dir) this.fs.createDir(name); else this.fs.createFile(name, '');
    return { output: name, exitCode: 0 };
  }

  private cmdSeq(args: string[]): CommandResult {
    const nums = args.slice(1).map(Number).filter(n => !isNaN(n));
    if (!nums.length) return { output: `${C.red}seq: missing operand${C.reset}`, exitCode: 1 };
    const [first, second, third] = nums;
    let start = 1, step = 1, end = first;
    if (nums.length === 2) { start = first; end = second; }
    if (nums.length === 3) { start = first; step = second; end = third; }
    const out: number[] = [];
    for (let i = start; step > 0 ? i <= end : i >= end; i += step) out.push(i);
    return { output: out.join('\r\n'), exitCode: 0 };
  }

  private cmdExpr(args: string[]): CommandResult {
    const expr = args.slice(1).join(' ');
    try {
      const safe = expr.replace(/[^0-9+\-*/%() ]/g, '');
      const result = eval(safe);
      return { output: String(result), exitCode: result ? 0 : 1 };
    } catch {
      return { output: `${C.red}expr: syntax error${C.reset}`, exitCode: 2 };
    }
  }

  private cmdTest(args: string[]): CommandResult {
    const a = args[1] || '';
    const op = args[2] || '';
    const b = args[3] || '';
    if (!a) return { output: '', exitCode: 1 };
    // File tests
    if (a === '-f') { const p = this.fs.resolve(op, this.state.cwd); return { output: '', exitCode: this.fs.isFile(p) ? 0 : 1 }; }
    if (a === '-d') { const p = this.fs.resolve(op, this.state.cwd); return { output: '', exitCode: this.fs.isDir(p) ? 0 : 1 }; }
    if (a === '-e') { const p = this.fs.resolve(op, this.state.cwd); return { output: '', exitCode: this.fs.exists(p) ? 0 : 1 }; }
    if (a === '-z') return { output: '', exitCode: op === '' ? 0 : 1 };
    if (a === '-n') return { output: '', exitCode: op !== '' ? 0 : 1 };
    if (a === '-r') { const p = this.fs.resolve(op, this.state.cwd); return { output: '', exitCode: this.fs.exists(p) ? 0 : 1 }; }
    if (a === '-w') { const p = this.fs.resolve(op, this.state.cwd); return { output: '', exitCode: this.fs.exists(p) ? 0 : 1 }; }
    if (a === '-x') { const p = this.fs.resolve(op, this.state.cwd); const n = this.fs.get(p); return { output: '', exitCode: (n && n.permissions & 0o100) ? 0 : 1 }; }
    // String / numeric comparisons
    if (op === '==' || op === '=') return { output: '', exitCode: a === b ? 0 : 1 };
    if (op === '!=' ) return { output: '', exitCode: a !== b ? 0 : 1 };
    if (op === '-eq') return { output: '', exitCode: parseInt(a) === parseInt(b) ? 0 : 1 };
    if (op === '-ne') return { output: '', exitCode: parseInt(a) !== parseInt(b) ? 0 : 1 };
    if (op === '-lt') return { output: '', exitCode: parseInt(a) < parseInt(b) ? 0 : 1 };
    if (op === '-le') return { output: '', exitCode: parseInt(a) <= parseInt(b) ? 0 : 1 };
    if (op === '-gt') return { output: '', exitCode: parseInt(a) > parseInt(b) ? 0 : 1 };
    if (op === '-ge') return { output: '', exitCode: parseInt(a) >= parseInt(b) ? 0 : 1 };
    return { output: '', exitCode: a ? 0 : 1 };
  }

  private cmdTime(args: string[]): CommandResult {
    const cmd = args.slice(1).join(' ');
    if (!cmd) return { output: '', exitCode: 0 };
    const start = Date.now();
    const result = this.execute(cmd);
    const elapsed = (Date.now() - start) / 1000;
    return { output: result.output + `\r\nreal\t0m${elapsed.toFixed(3)}s\r\nuser\t0m0.001s\r\nsys\t0m0.000s`, exitCode: result.exitCode };
  }

  private cmdLsof(): CommandResult {
    return { output: [
      'COMMAND  PID  USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
      `bash    1000  ${this.state.user}  cwd    DIR   8,1     4096  123 ${this.state.cwd}`,
      `bash    1000  ${this.state.user}  txt    REG   8,1  1037528  456 /bin/bash`,
      `bash    1000  ${this.state.user}    0u   CHR 136,0      0t0    3 /dev/pts/0`,
      `bash    1000  ${this.state.user}    1u   CHR 136,0      0t0    3 /dev/pts/0`,
      `sshd     100  root    3u  IPv4  12345      0t0  TCP *:ssh (LISTEN)`,
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdMount(): CommandResult {
    return { output: [
      '/dev/sda1 on / type xfs (rw,relatime,attr2)',
      'tmpfs on /dev/shm type tmpfs (rw,nosuid,nodev)',
      'tmpfs on /run type tmpfs (rw,nosuid,nodev,mode=755)',
      '/dev/sdb1 on /home type xfs (rw,relatime)',
      'proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)',
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdBlkid(): CommandResult {
    return { output: [
      '/dev/sda1: UUID="abc-123" TYPE="xfs" PARTLABEL="root" PARTUUID="xyz-456"',
      '/dev/sda2: UUID="def-789" TYPE="swap" PARTUUID="uvw-012"',
      '/dev/sdb1: UUID="ghi-345" TYPE="xfs" PARTUUID="rst-678"',
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdDmesg(): CommandResult {
    return { output: [
      '[    0.000000] Initializing cgroup subsys cpuset',
      '[    0.000000] Linux version 3.10.0-1160.el7.x86_64',
      '[    0.000000] Command line: BOOT_IMAGE=/vmlinuz-3.10.0',
      '[    1.234567] NET: Registered protocol family 2',
      '[    2.345678] eth0: renamed from veth3a2b1c0',
      '[    3.456789] EXT4-fs (sda1): mounted filesystem with ordered data mode',
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdLdd(args: string[]): CommandResult {
    const bin = args[1] || '';
    return { output: [
      `\tlinux-vdso.so.1 =>  (0x00007ffd12345000)`,
      `\tlibtinfo.so.5 => /lib64/libtinfo.so.5 (0x00007f1234567890)`,
      `\tlibdl.so.2 => /lib64/libdl.so.2 (0x00007f0987654321)`,
      `\tlibc.so.6 => /lib64/libc.so.6 (0x00007fefabcdef00)`,
      `\t/lib64/ld-linux-x86-64.so.2 (0x00007fff11223344)`,
    ].join('\r\n'), exitCode: 0 };
  }

  private cmdLsmod(): CommandResult {
    return { output: [
      'Module                  Size  Used by',
      'iptable_nat            12875  0',
      'ip_nat                 26787  1 iptable_nat',
      'overlay                94572  0',
      'br_netfilter           22256  0',
      'bridge                151336  1 br_netfilter',
    ].join('\r\n'), exitCode: 0 };
  }

  // ─── TAB COMPLETION ──────────────────────────────────────────────────────

  tabComplete(partial: string): string[] {
    const parts = partial.split(' ');
    const completing = parts[parts.length - 1];
    const isFirstWord = parts.length === 1;

    if (isFirstWord) {
      const allCmds = ['ls','ll','la','cd','pwd','mkdir','rmdir','rm','cp','mv','touch','cat','tac','less','more',
        'head','tail','echo','printf','grep','egrep','fgrep','sed','awk','sort','uniq','wc','cut','tr','diff',
        'find','locate','which','whereis','type','stat','file','chmod','chown','chgrp','umask','ln','tree',
        'uname','hostname','whoami','id','date','cal','uptime','df','du','free','lscpu','lsblk','ps','top','htop',
        'kill','killall','pgrep','ping','curl','wget','ssh','scp','ifconfig','ip','netstat','ss','traceroute',
        'dig','nslookup','host','env','export','unset','alias','unalias','history','clear','reset','exit',
        'man','help','source','bash','sh','tar','gzip','gunzip','zip','unzip','xargs','tee','seq','expr',
        'basename','dirname','realpath','mktemp','nl','strings','test','time','lsof','mount','dmesg','lsmod',
        'systemctl','service','journalctl','crontab','yum','dnf','rpm','pip','git','docker','sudo','w','who','last',
      ];
      const aliases = Object.keys(this.state.aliases);
      return [...allCmds, ...aliases].filter(c => c.startsWith(completing)).sort();
    }

    // Complete filenames
    const dir = completing.includes('/') ? completing.substring(0, completing.lastIndexOf('/') + 1) : '';
    const filePrefix = completing.includes('/') ? completing.substring(completing.lastIndexOf('/') + 1) : completing;
    const searchDir = dir ? this.fs.resolve(dir, this.state.cwd) : this.state.cwd;
    if (!this.fs.exists(searchDir)) return [];
    const children = this.fs.listDir(searchDir)
      .filter(c => c.name.startsWith(filePrefix))
      .map(c => dir + c.name + (c.type === 'directory' ? '/' : ''));
    return children;
  }
}
