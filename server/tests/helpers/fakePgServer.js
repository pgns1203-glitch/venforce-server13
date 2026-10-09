// server/tests/helpers/fakePgServer.js
// Servidor TCP que fala o MÍNIMO do protocolo do PostgreSQL para o `pg` real
// conectar, rodar queries e — o ponto — ter a conexão derrubada pelo lado do
// servidor sem aviso (o que o `pg` reporta como "Connection terminated
// unexpectedly"). Sem SSL: o teste monta o Pool com ssl:false.
//
// Toda query devolve UMA linha com UMA coluna booleana `locked` = true (serve
// para `pg_try_advisory_lock` e é inofensiva para BEGIN/COMMIT/INSERT). Query
// com `pg_sleep` fica SEM resposta (query em voo quando a conexão cai).
// `derrubarTodas()` destrói os sockets abertos (crash do backend/restart do
// PostgreSQL); `queries` registra o texto de cada query recebida.

const net = require("net");

function msg(tipo, corpo) {
  const b = Buffer.alloc(5 + corpo.length);
  b.write(tipo, 0, "ascii");
  b.writeInt32BE(4 + corpo.length, 1);
  corpo.copy(b, 5);
  return b;
}

function int32(n) { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; }
function int16(n) { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; }
function cstr(s) { return Buffer.from(`${s}\0`, "utf8"); }

const AUTH_OK = msg("R", int32(0));
const READY = msg("Z", Buffer.from("I"));
const PARSE_OK = msg("1", Buffer.alloc(0));
const BIND_OK = msg("2", Buffer.alloc(0));
const ROW_DESC = msg("T", Buffer.concat([
  int16(1), cstr("locked"), int32(0), int16(0), int32(16), int16(1), int32(-1), int16(0),
]));
const DATA_ROW = msg("D", Buffer.concat([int16(1), int32(1), Buffer.from("t")]));
const COMPLETE = msg("C", cstr("SELECT 1"));

async function iniciarFakePg() {
  const sockets = new Set();
  const queries = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buf = Buffer.alloc(0);
    let iniciado = false;
    let pendurar = false;
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!iniciado) {
          if (buf.length < 8) return;
          const len = buf.readInt32BE(0);
          if (buf.length < len) return;
          const codigo = buf.readInt32BE(4);
          buf = buf.subarray(len);
          if (codigo === 80877103) { socket.write("N"); continue; } // SSLRequest → sem SSL
          iniciado = true;
          socket.write(Buffer.concat([AUTH_OK, READY]));
          continue;
        }
        if (buf.length < 5) return;
        const tipo = String.fromCharCode(buf[0]);
        const len = buf.readInt32BE(1);
        if (buf.length < 1 + len) return;
        const corpo = buf.subarray(5, 1 + len);
        buf = buf.subarray(1 + len);
        if (tipo === "Q") {
          const texto = corpo.toString("utf8").replace(/\0$/, "");
          queries.push(texto);
          if (!/pg_sleep/.test(texto)) socket.write(Buffer.concat([ROW_DESC, DATA_ROW, COMPLETE, READY]));
        } else if (tipo === "P") {
          const semNome = corpo.indexOf(0);
          const fim = corpo.indexOf(0, semNome + 1);
          const texto = corpo.subarray(semNome + 1, fim).toString("utf8");
          queries.push(texto);
          pendurar = /pg_sleep/.test(texto);
        } else if (tipo === "S") {
          if (!pendurar) socket.write(Buffer.concat([PARSE_OK, BIND_OK, ROW_DESC, DATA_ROW, COMPLETE, READY]));
        } else if (tipo === "X") {
          socket.end();
        }
        // B/D/E: respondidos em bloco no Sync.
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    queries,
    connectionString: `postgres://teste:teste@127.0.0.1:${port}/teste`,
    conexoesAbertas: () => sockets.size,
    derrubarTodas() {
      for (const s of sockets) s.destroy();
    },
    async fechar() {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { iniciarFakePg };
