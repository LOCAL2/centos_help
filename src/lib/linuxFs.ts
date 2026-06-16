// Virtual Linux Filesystem for browser-based emulator

export type FileType = 'file' | 'directory' | 'symlink';

// Re-exported as a type alias so it can be used in import/export
export type VFSNodeType = VFSNode;

export interface VFSNode {
  type: FileType;
  name: string;
  content: string;       // file content or symlink target
  permissions: number;   // octal e.g. 0o755
  owner: string;
  group: string;
  size: number;
  mtime: Date;
  ctime: Date;
}

export type VFSTree = Map<string, VFSNode>;

export class VirtualFS {
  private tree: VFSTree = new Map();

  constructor() {
    this.init();
  }

  private mknode(path: string, type: FileType, content = '', perms = 0o644, owner = 'user') {
    this.tree.set(path, {
      type,
      name: path.split('/').pop() || '/',
      content,
      permissions: perms,
      owner,
      group: owner === 'root' ? 'root' : 'user',
      size: content.length,
      mtime: new Date(),
      ctime: new Date(),
    });
  }

  private mkdir(path: string, owner = 'user', perms = 0o755) {
    this.mknode(path, 'directory', '', perms, owner);
  }

  private mkfile(path: string, content: string, owner = 'user', perms = 0o644) {
    this.mknode(path, 'file', content, perms, owner);
  }

  private init() {
    // Core directories
    this.mkdir('/', 'root', 0o755);
    this.mkdir('/bin', 'root', 0o755);
    this.mkdir('/sbin', 'root', 0o755);
    this.mkdir('/etc', 'root', 0o755);
    this.mkdir('/home', 'root', 0o755);
    this.mkdir('/home/user', 'user', 0o755);
    this.mkdir('/home/user/Desktop', 'user', 0o755);
    this.mkdir('/home/user/Documents', 'user', 0o755);
    this.mkdir('/home/user/Downloads', 'user', 0o755);
    this.mkdir('/home/user/projects', 'user', 0o755);
    this.mkdir('/home/user/projects/myapp', 'user', 0o755);
    this.mkdir('/tmp', 'root', 0o1777);
    this.mkdir('/var', 'root', 0o755);
    this.mkdir('/var/log', 'root', 0o755);
    this.mkdir('/usr', 'root', 0o755);
    this.mkdir('/usr/bin', 'root', 0o755);
    this.mkdir('/usr/local', 'root', 0o755);
    this.mkdir('/usr/local/bin', 'root', 0o755);
    this.mkdir('/proc', 'root', 0o555);
    this.mkdir('/dev', 'root', 0o755);

    // /etc files
    this.mkfile('/etc/hostname', 'centos-playground\n', 'root', 0o644);
    this.mkfile('/etc/os-release',
      'NAME="CentOS Linux"\nVERSION="7 (Core)"\nID=centos\nID_LIKE=rhel fedora\n' +
      'VERSION_ID=7\nPRETTY_NAME="CentOS Linux 7 (Core)"\n', 'root', 0o644);
    this.mkfile('/etc/passwd',
      'root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000::/home/user:/bin/bash\n', 'root', 0o644);
    this.mkfile('/etc/shells', '/bin/sh\n/bin/bash\n/bin/zsh\n', 'root', 0o644);
    this.mkfile('/etc/fstab',
      'UUID=abc123 /  xfs  defaults 0 0\ntmpfs  /tmp  tmpfs  defaults 0 0\n', 'root', 0o644);

    // /home/user files
    this.mkfile('/home/user/.bashrc',
      '# .bashrc\nexport PS1="\\u@\\h:\\w\\$ "\nalias ll="ls -alF"\nalias la="ls -A"\n' +
      'alias l="ls -CF"\nexport PATH=$PATH:/usr/local/bin\n', 'user', 0o644);
    this.mkfile('/home/user/.bash_history',
      'ls -la\npwd\ncd /etc\ncat /etc/os-release\nps aux\n', 'user', 0o600);
    this.mkfile('/home/user/.profile',
      '# .profile\n[ -f ~/.bashrc ] && . ~/.bashrc\n', 'user', 0o644);
    this.mkfile('/home/user/README.md',
      '# Welcome to CentOS Playground\n\nThis is a browser-based Linux terminal.\n' +
      'Try commands like:\n- ls -la\n- cat /etc/os-release\n- mkdir test && cd test\n' +
      '- echo "Hello World" > hello.txt\n- cat hello.txt\n', 'user', 0o644);

    // /home/user/projects/myapp
    this.mkfile('/home/user/projects/myapp/app.sh',
      '#!/bin/bash\necho "Starting myapp..."\nfor i in 1 2 3; do\n  echo "Step $i"\ndone\necho "Done!"\n',
      'user', 0o755);
    this.mkfile('/home/user/projects/myapp/config.txt',
      'HOST=localhost\nPORT=8080\nDEBUG=false\n', 'user', 0o644);

    // /var/log
    this.mkfile('/var/log/messages',
      'Jun 16 10:00:01 centos-playground systemd[1]: Started Session 1 of user user.\n' +
      'Jun 16 10:00:02 centos-playground sshd[1234]: Accepted publickey for user\n', 'root', 0o640);
    this.mkfile('/var/log/secure', 'Jun 16 10:00:01 centos-playground sudo: user : TTY=pts/0\n', 'root', 0o600);

    // /tmp
    this.mkfile('/tmp/example.txt', 'This is a temporary file.\n', 'user', 0o644);

    // /proc (virtual)
    this.mkfile('/proc/version',
      'Linux version 3.10.0-1160.el7.x86_64 (mockbuild@kbuilder.bsys.centos.org)\n', 'root', 0o444);
    this.mkfile('/proc/cpuinfo',
      'processor\t: 0\nvendor_id\t: GenuineIntel\ncpu family\t: 6\nmodel name\t: ' +
      'Intel(R) Core(TM) i7-9750H\ncpu MHz\t\t: 2600.000\ncache size\t: 12288 KB\n', 'root', 0o444);
    this.mkfile('/proc/meminfo',
      'MemTotal:       8192000 kB\nMemFree:        4096000 kB\nMemAvailable:   6144000 kB\n' +
      'Buffers:         204800 kB\nCached:         1024000 kB\nSwapTotal:      2097148 kB\nSwapFree:       2097148 kB\n',
      'root', 0o444);
    this.mkfile('/proc/uptime', '86400.00 172800.00\n', 'root', 0o444);
  }

  // Resolve a path (handle ~, .., .)
  resolve(path: string, cwd: string): string {
    if (path === '~' || path === '') return '/home/user';
    if (path.startsWith('~/')) path = '/home/user' + path.slice(1);
    if (!path.startsWith('/')) path = cwd + '/' + path;
    // Normalize
    const parts = path.split('/').filter(Boolean);
    const stack: string[] = [];
    for (const p of parts) {
      if (p === '.') continue;
      else if (p === '..') stack.pop();
      else stack.push(p);
    }
    return '/' + stack.join('/');
  }

  get(path: string): VFSNode | undefined {
    return this.tree.get(path);
  }

  exists(path: string): boolean {
    return this.tree.has(path);
  }

  isDir(path: string): boolean {
    return this.tree.get(path)?.type === 'directory';
  }

  isFile(path: string): boolean {
    return this.tree.get(path)?.type === 'file';
  }

  // List children of a directory
  listDir(path: string): VFSNode[] {
    const norm = path === '/' ? '/' : path.replace(/\/$/, '');
    const children: VFSNode[] = [];
    for (const [p, node] of this.tree) {
      if (p === norm) continue;
      const parent = p.substring(0, p.lastIndexOf('/')) || '/';
      if (parent === norm) children.push(node);
    }
    return children.sort((a, b) => a.name.localeCompare(b.name));
  }

  createFile(path: string, content = '', owner = 'user', perms = 0o644): void {
    this.mkfile(path, content, owner, perms);
  }

  createDir(path: string, owner = 'user', perms = 0o755): void {
    this.mkdir(path, owner, perms);
  }

  writeFile(path: string, content: string): void {
    const node = this.tree.get(path);
    if (node) {
      node.content = content;
      node.size = content.length;
      node.mtime = new Date();
    } else {
      this.mkfile(path, content);
    }
  }

  appendFile(path: string, content: string): void {
    const node = this.tree.get(path);
    if (node && node.type === 'file') {
      node.content += content;
      node.size = node.content.length;
      node.mtime = new Date();
    } else {
      this.mkfile(path, content);
    }
  }

  deleteNode(path: string): void {
    // Also delete children if directory
    for (const p of [...this.tree.keys()]) {
      if (p === path || p.startsWith(path + '/')) this.tree.delete(p);
    }
  }

  moveNode(src: string, dest: string): void {
    for (const [p, node] of [...this.tree.entries()]) {
      if (p === src || p.startsWith(src + '/')) {
        const newPath = dest + p.slice(src.length);
        this.tree.delete(p);
        this.tree.set(newPath, { ...node, name: newPath.split('/').pop() || '' });
      }
    }
  }

  copyNode(src: string, dest: string): void {
    const srcNode = this.tree.get(src);
    if (!srcNode) return;
    if (srcNode.type === 'file') {
      this.mkfile(dest, srcNode.content, srcNode.owner, srcNode.permissions);
    } else {
      for (const [p, node] of this.tree.entries()) {
        if (p === src || p.startsWith(src + '/')) {
          const newPath = dest + p.slice(src.length);
          this.tree.set(newPath, { ...node, name: newPath.split('/').pop() || '' });
        }
      }
    }
  }

  chmod(path: string, perms: number): void {
    const node = this.tree.get(path);
    if (node) { node.permissions = perms; node.ctime = new Date(); }
  }

  chown(path: string, owner: string, group: string): void {
    const node = this.tree.get(path);
    if (node) { node.owner = owner; node.group = group; node.ctime = new Date(); }
  }

  // Format permissions as rwxrwxrwx
  static formatPerms(node: VFSNode): string {
    const p = node.permissions;
    const type = node.type === 'directory' ? 'd' : node.type === 'symlink' ? 'l' : '-';
    const bits = [
      (p & 0o400) ? 'r' : '-', (p & 0o200) ? 'w' : '-', (p & 0o100) ? 'x' : '-',
      (p & 0o040) ? 'r' : '-', (p & 0o020) ? 'w' : '-', (p & 0o010) ? 'x' : '-',
      (p & 0o004) ? 'r' : '-', (p & 0o002) ? 'w' : '-', (p & 0o001) ? 'x' : '-',
    ];
    return type + bits.join('');
  }

  // Format mtime like ls -l
  static formatDate(d: Date): string {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const m = months[d.getMonth()];
    const day = String(d.getDate()).padStart(2, ' ');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m} ${day} ${h}:${min}`;
  }

  // Glob expansion (simple * and ?)
  glob(pattern: string, cwd: string): string[] {
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return [pattern];
    }
    const absPattern = this.resolve(pattern, cwd);
    const dir = absPattern.substring(0, absPattern.lastIndexOf('/')) || '/';
    const filePattern = absPattern.split('/').pop() || '';
    const regex = new RegExp('^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    const results: string[] = [];
    for (const [p] of this.tree) {
      const parent = p.substring(0, p.lastIndexOf('/')) || '/';
      const name = p.split('/').pop() || '';
      if (parent === dir && regex.test(name)) results.push(p);
    }
    return results.length ? results : [pattern];
  }
}
