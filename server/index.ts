import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import Dockerode from "dockerode";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Docker client
let docker: Dockerode | null = null;
let dockerAvailable = false;

const tryConnectDocker = async () => {
  const socketPaths = ["/var/run/docker.sock", "//./pipe/docker_engine"];
  for (const socketPath of socketPaths) {
    try {
      const d = new Dockerode({ socketPath });
      await d.ping();
      docker = d;
      dockerAvailable = true;
      console.log(`✅ Docker connected via ${socketPath}`);
      return;
    } catch {
      // try next
    }
  }
  console.warn("⚠️  Docker not available — mock terminal mode will be used");
};

interface Session {
  id: string;
  containerId: string;
  isMock: boolean;
  exec?: any;
  stream?: any;
  ws?: WebSocket;
  lastActivity: number;
  createdAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_TIMEOUT = 30 * 60 * 1000;

setInterval(async () => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      await cleanupSession(id);
    }
  }
}, 60 * 1000);

async function cleanupSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  try {
    if (session.stream) session.stream.destroy();
    if (!session.isMock && docker) {
      const container = docker.getContainer(session.containerId);
      await container.stop({ t: 2 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    }
  } catch (err) {
    console.error(`Error cleaning up session ${sessionId}:`, err);
  } finally {
    sessions.delete(sessionId);
  }
}

async function createDockerSession(sessionId: string): Promise<Session> {
  if (!docker) throw new Error("Docker not available");
  const container = await docker.createContainer({
    Image: "centos:7",
    Cmd: ["/bin/bash"],
    AttachStdin: true, AttachStdout: true, AttachStderr: true,
    Tty: true, OpenStdin: true, StdinOnce: false, User: "root",
    WorkingDir: "/root", Hostname: "centos-playground",
    Env: [
      "TERM=xterm-256color", "HOME=/root", "USER=root", "SHELL=/bin/bash",
      "PS1=\\[\\033[01;32m\\]root@centos-playground\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\# ",
      "LANG=en_US.UTF-8",
    ],
    HostConfig: {
      Memory: 256 * 1024 * 1024, NanoCpus: 500000000, NetworkMode: "none",
      SecurityOpt: ["no-new-privileges"], PidsLimit: 50,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=50m" },
    },
    Labels: { "centos-playground-session": sessionId, "managed-by": "centos-help" },
  });
  await container.start();
  const session: Session = { id: sessionId, containerId: container.id, isMock: false, lastActivity: Date.now(), createdAt: Date.now() };
  sessions.set(sessionId, session);
  return session;
}

// ─── Mock Terminal ───────────────────────────────────────────────────────────
function handleMockCommand(cmd: string, ws: WebSocket) {
  const parts = cmd.trim().split(/\s+/);
  const base = parts[0];
  const send = (data: string) => ws.send(JSON.stringify({ type: "output", data }));

  const prompt = "\r\n\x1b[32mroot@centos-mock:~# \x1b[0m";

  if (!base) { send(prompt); return; }
  switch (base) {
    case "clear": send("\x1b[2J\x1b[H" + "\x1b[32mroot@centos-mock:~# \x1b[0m"); break;
    case "pwd":   send("/root" + prompt); break;
    case "whoami": send("root" + prompt); break;
    case "hostname": send("centos-mock" + prompt); break;
    case "date":  send(new Date().toString() + prompt); break;
    case "uname": send("Linux centos-mock 3.10.0-1160.el7.x86_64 #1 SMP x86_64 GNU/Linux" + prompt); break;
    case "ls": {
      const out = parts.includes("-la")
        ? "total 0\ndrwx------ 2 root root  40 Jan 1 00:00 .\ndrwxr-xr-x 1 root root 100 Jan 1 00:00 ..\n-rw-r--r-- 1 root root  18 Jan 1 00:00 .bash_logout\n-rw-r--r-- 1 root root 176 Jan 1 00:00 .bashrc"
        : ".bash_logout  .bashrc  .bash_profile";
      send(out + prompt); break;
    }
    case "echo": send(parts.slice(1).join(" ") + prompt); break;
    case "cat": {
      if (parts[1] === "/etc/os-release") send('NAME="CentOS Linux"\nVERSION="7 (Core)"\nID=centos' + prompt);
      else send(`cat: ${parts[1] ?? ""}: No such file or directory` + prompt);
      break;
    }
    case "id": send("uid=0(root) gid=0(root) groups=0(root)" + prompt); break;
    case "uptime": send(" 00:00:01 up 1 min,  1 user,  load average: 0.00, 0.00, 0.00" + prompt); break;
    case "free": send("              total        used        free\nMem:        1000000      200000      800000\nSwap:             0           0           0" + prompt); break;
    case "df": send("Filesystem     1K-blocks  Used Available Use% Mounted on\noverlay         20000000  5000000  15000000  25% /\ntmpfs              65536       0     65536   0% /dev" + prompt); break;
    case "ps": send("  PID TTY          TIME CMD\n    1 pts/0    00:00:00 bash\n   42 pts/0    00:00:00 ps" + prompt); break;
    case "help": send([
      "\x1b[1;33mAvailable mock commands:\x1b[0m",
      "  ls, cat, pwd, cd, echo, date, whoami, hostname",
      "  uname, id, uptime, free, df, ps, clear, help, exit"
    ].join("\r\n") + prompt); break;
    case "exit": ws.send(JSON.stringify({ type: "exit", message: "Session ended" })); break;
    default: send(`\x1b[31m-bash: ${base}: command not found\x1b[0m` + prompt);
  }
}

// ─── REST Endpoints ──────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", sessions: sessions.size, dockerAvailable });
});

app.post("/api/terminal/session", async (req, res) => {
  const sessionId = uuidv4();
  if (dockerAvailable && docker) {
    try {
      const session = await createDockerSession(sessionId);
      return res.json({ sessionId, containerId: session.containerId, message: "Docker session created" });
    } catch (err: any) {
      console.error("Docker session error:", err.message);
      // Fall through to mock
    }
  }
  // Mock session
  const mockSession: Session = { id: sessionId, containerId: "mock-" + sessionId, isMock: true, lastActivity: Date.now(), createdAt: Date.now() };
  sessions.set(sessionId, mockSession);
  res.json({ sessionId, containerId: mockSession.containerId, message: "Mock session created", dockerAvailable: false });
});

app.delete("/api/terminal/session/:sessionId", async (req, res) => {
  await cleanupSession(req.params.sessionId);
  res.json({ message: "Session deleted" });
});

// ─── WebSocket ───────────────────────────────────────────────────────────────
wss.on("connection", (ws: WebSocket, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) { ws.send(JSON.stringify({ type: "error", message: "No session ID" })); ws.close(); return; }

  const session = sessions.get(sessionId);
  if (!session) { ws.send(JSON.stringify({ type: "error", message: "Session not found" })); ws.close(); return; }

  session.ws = ws;
  console.log(`WS connected: ${sessionId} (${session.isMock ? "mock" : "docker"})`);

  const welcome = "\r\n\x1b[1;32m╔══════════════════════════════════════════════╗\x1b[0m\r\n\x1b[1;32m║   \x1b[1;33mCentOS 7 Linux Playground Terminal\x1b[1;32m       ║\x1b[0m\r\n\x1b[1;32m║   \x1b[0;36mType 'help' for available commands\x1b[1;32m        ║\x1b[0m\r\n\x1b[1;32m╚══════════════════════════════════════════════╝\x1b[0m\r\n\r\n";

  if (session.isMock) {
    ws.send(JSON.stringify({ type: "output", data: welcome }));
    ws.send(JSON.stringify({ type: "output", data: "\x1b[33m⚠ Running in mock mode (Docker unavailable)\x1b[0m\r\nType 'help' to list available commands.\r\n\r\n\x1b[32mroot@centos-mock:~# \x1b[0m" }));

    let inputBuffer = "";
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        session.lastActivity = Date.now();
        if (msg.type === "input") {
          const char: string = msg.data;
          if (char === "\r") {
            ws.send(JSON.stringify({ type: "output", data: "\r\n" }));
            handleMockCommand(inputBuffer, ws);
            inputBuffer = "";
          } else if (char === "\x7f") {
            if (inputBuffer.length > 0) {
              inputBuffer = inputBuffer.slice(0, -1);
              ws.send(JSON.stringify({ type: "output", data: "\b \b" }));
            }
          } else if (char === "\x03") {
            inputBuffer = "";
            ws.send(JSON.stringify({ type: "output", data: "^C\r\n\x1b[32mroot@centos-mock:~# \x1b[0m" }));
          } else {
            inputBuffer += char;
            ws.send(JSON.stringify({ type: "output", data: char }));
          }
        }
      } catch {}
    });
  } else {
    // Docker mode
    if (!docker) { ws.send(JSON.stringify({ type: "error", message: "Docker unavailable" })); ws.close(); return; }
    const container = docker.getContainer(session.containerId);
    container.attach({ stream: true, stdin: true, stdout: true, stderr: true }, (err, stream) => {
      if (err || !stream) { ws.send(JSON.stringify({ type: "error", message: "Attach failed" })); return; }
      session.stream = stream;
      ws.send(JSON.stringify({ type: "output", data: welcome }));
      stream.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "output", data: chunk.toString() }));
        session.lastActivity = Date.now();
      });
      stream.on("end", () => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "exit", message: "Container exited" })); });
      stream.write("clear\n");
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          session.lastActivity = Date.now();
          if (msg.type === "input") stream.write(msg.data);
          else if (msg.type === "resize") container.resize({ h: msg.rows, w: msg.cols }).catch(() => {});
        } catch {}
      });
    });
  }

  ws.on("close", () => { console.log(`WS closed: ${sessionId}`); if (session.stream) session.stream.destroy(); });
  ws.on("error", (err) => console.error(`WS error ${sessionId}:`, err));
});

const PORT = process.env.PORT ?? 3001;
server.listen(PORT, async () => {
  console.log(`🚀 CentOS Help Server on port ${PORT}`);
  await tryConnectDocker();
});

export default app;
