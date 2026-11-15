import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";

@Controller("dashboard")
export class DashboardController {
  @Get()
  getDashboard(@Res() res: Response) {
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>🦧 Jungle Gaming — Distributed Wagering Cockpit</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --primary: #f59e0b;
      --green: #10b981;
      --red: #ef4444;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
    h1 { font-size: 24px; color: var(--primary); display: flex; align-items: center; gap: 8px; }
    .badge { background: #334155; padding: 4px 10px; border-radius: 999px; font-size: 12px; color: #38bdf8; }
    .grid { display: grid; grid-template-columns: 1fr 2fr; gap: 20px; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
    h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 16px; }
    .balance-box { background: #0f172a; border-radius: 8px; padding: 16px; text-align: center; margin-bottom: 16px; border: 1px solid var(--border); }
    .balance-val { font-size: 36px; font-weight: bold; color: var(--green); }
    .btn-group { display: flex; flex-direction: column; gap: 10px; }
    button { background: #334155; color: white; border: none; padding: 12px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; text-align: left; display: flex; justify-content: space-between; align-items: center; transition: all 0.15s ease; }
    button:hover { background: #475569; }
    button.primary { background: var(--primary); color: #000; }
    button.primary:hover { background: #d97706; }
    button.danger { background: #dc2626; color: white; }
    button.danger:hover { background: #b91c1c; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-size: 11px; text-transform: uppercase; }
    .credit { color: var(--green); font-weight: bold; }
    .debit { color: var(--red); font-weight: bold; }
    .console { background: #090d16; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; height: 180px; overflow-y: auto; color: #38bdf8; line-height: 1.5; }
    .status-pill { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .status-processed { background: rgba(16, 185, 129, 0.2); color: var(--green); }
    .status-rejected { background: rgba(239, 68, 68, 0.2); color: var(--red); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🦧 Jungle Gaming — Distributed Wagering Processor</h1>
      <div>
        <span class="badge">Bun 1.4.4</span>
        <span class="badge">PostgreSQL 16</span>
        <span class="badge">Lock Pessimista</span>
      </div>
    </header>

    <div class="grid">
      <!-- Left Column: Controls & Balance -->
      <div class="card">
        <h2>Carteira Ativa</h2>
        <div class="balance-box">
          <div style="font-size: 12px; color: var(--muted); margin-bottom: 4px;">SALDO CONSOLIDADO</div>
          <div class="balance-val" id="balanceDisplay">R$ 0,00</div>
          <div style="font-size: 11px; color: var(--muted); margin-top: 4px;" id="walletMeta">Nenhuma carteira carregada</div>
        </div>

        <h2>Simulações em Tempo Real</h2>
        <div class="btn-group">
          <button class="primary" onclick="createWallet()">
            <span>1. Criar Carteira (R$ 100,00)</span>
            <span>➕</span>
          </button>
          <button class="danger" onclick="runSection8Scenario()">
            <span>2. Concorrência Seção 8 (2x R$ 80)</span>
            <span>⚡</span>
          </button>
          <button onclick="sendBet('25.00')">
            <span>3. Aposta Normal (R$ 25,00)</span>
            <span>🎰</span>
          </button>
          <button onclick="sendWin('50.00')">
            <span>4. Vitória WIN (R$ 50,00)</span>
            <span>🏆</span>
          </button>
          <button onclick="runAudit()">
            <span>5. Auditar Livro-Razão (Reconciliação)</span>
            <span>⚖️</span>
          </button>
        </div>
      </div>

      <!-- Right Column: Ledger & Logs -->
      <div class="card">
        <h2>Extrato Contábil — WalletLedgerEntry (Append-Only)</h2>
        <div style="max-height: 250px; overflow-y: auto; margin-bottom: 20px;">
          <table>
            <thead>
              <tr>
                <th>Direção</th>
                <th>Valor</th>
                <th>Saldo Anterior</th>
                <th>Saldo Posterior</th>
                <th>Hora</th>
              </tr>
            </thead>
            <tbody id="ledgerTableBody">
              <tr><td colspan="5" style="text-align:center; color: var(--muted);">Clique em "Criar Carteira" para iniciar</td></tr>
            </tbody>
          </table>
        </div>

        <h2>Console de Eventos & Logs Estruturados</h2>
        <div class="console" id="logConsole">
          [READY] Painel Interativo inicializado. Aguardando comando...
        </div>
      </div>
    </div>
  </div>

  <script>
    let activeWalletId = null;
    let playerId = crypto.randomUUID();

    function log(msg, type = "INFO") {
      const el = document.getElementById("logConsole");
      const time = new Date().toLocaleTimeString();
      el.innerHTML += '<br>[' + time + '][' + type + '] ' + msg;
      el.scrollTop = el.scrollHeight;
    }

    async function createWallet() {
      playerId = crypto.randomUUID();
      log("Enviando requisição POST /wallets com saldo inicial de R$ 100,00...");
      try {
        const res = await fetch("/wallets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: playerId,
            initialBalance: { amount: "100.00", currency: "BRL" }
          })
        });
        const data = await res.json();
        if (res.ok) {
          activeWalletId = data.id;
          document.getElementById("balanceDisplay").innerText = "R$ " + data.balance.amount;
          document.getElementById("walletMeta").innerText = "ID: " + activeWalletId.substring(0, 8) + "... | Versão: " + data.version;
          log("✓ Carteira criada com sucesso! ID: " + activeWalletId, "SUCCESS");
          loadLedger();
        } else {
          log("Erro ao criar carteira: " + data.message, "ERROR");
        }
      } catch (err) {
        log("Falha de rede: " + err.message, "ERROR");
      }
    }

    async function runSection8Scenario() {
      if (!activeWalletId) {
        alert("Crie uma carteira primeiro!");
        return;
      }
      log("⚡ DISPARANDO CENÁRIO DA SEÇÃO 8: Duas apostas simultâneas de R$ 80,00 disputando R$ 100,00...", "WARN");
      
      const req1 = fetch("/wagering/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "p1:" + Date.now() + "-1" },
        body: JSON.stringify({
          providerId: "pragmatic", externalTransactionId: "tx-" + Date.now() + "-1",
          playerId, walletId: activeWalletId, roundId: "r1", gameId: "fortune-tiger",
          kind: "BET", money: { amount: "80.00", currency: "BRL" }
        })
      }).then(r => r.json());

      const req2 = fetch("/wagering/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "p1:" + Date.now() + "-2" },
        body: JSON.stringify({
          providerId: "pragmatic", externalTransactionId: "tx-" + Date.now() + "-2",
          playerId, walletId: activeWalletId, roundId: "r2", gameId: "fortune-tiger",
          kind: "BET", money: { amount: "80.00", currency: "BRL" }
        })
      }).then(r => r.json());

      const [res1, res2] = await Promise.all([req1, req2]);

      log("Resultado Requisição 1: " + res1.status + " | Saldo: R$ " + res1.balance.amount);
      log("Resultado Requisição 2: " + res2.status + (res2.failureCode ? " (" + res2.failureCode + ")" : "") + " | Saldo: R$ " + res2.balance.amount);

      refreshWallet();
      loadLedger();
    }

    async function sendBet(amount) {
      if (!activeWalletId) return alert("Crie uma carteira primeiro!");
      const txId = "bet-" + Date.now();
      log("Enviando BET de R$ " + amount + "...");
      const res = await fetch("/wagering/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "p1:" + txId },
        body: JSON.stringify({
          providerId: "pragmatic", externalTransactionId: txId,
          playerId, walletId: activeWalletId, roundId: "r-" + Date.now(), gameId: "sweet-bonanza",
          kind: "BET", money: { amount, currency: "BRL" }
        })
      });
      const data = await res.json();
      log("Status: " + data.status + " | Saldo: R$ " + data.balance.amount);
      refreshWallet();
      loadLedger();
    }

    async function sendWin(amount) {
      if (!activeWalletId) return alert("Crie uma carteira primeiro!");
      const txId = "win-" + Date.now();
      log("Enviando WIN de R$ " + amount + "...");
      const res = await fetch("/wagering/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "p1:" + txId },
        body: JSON.stringify({
          providerId: "pragmatic", externalTransactionId: txId,
          playerId, walletId: activeWalletId, roundId: "r-" + Date.now(), gameId: "sweet-bonanza",
          kind: "WIN", money: { amount, currency: "BRL" }
        })
      });
      const data = await res.json();
      log("Status: " + data.status + " | Saldo: R$ " + data.balance.amount);
      refreshWallet();
      loadLedger();
    }

    async function runAudit() {
      if (!activeWalletId) return alert("Crie uma carteira primeiro!");
      log("⚖️ Auditando Livro-Razão (POST /wallets/:id/reconciliation)...");
      const res = await fetch("/wallets/" + activeWalletId + "/reconciliation", { method: "POST" });
      const data = await res.json();
      if (data.consistent) {
        log("✓ AUDITORIA 100% EXATA! Saldo na Carteira (" + data.storedBalance.amount + ") == Soma do Extrato (" + data.calculatedBalance.amount + ")", "SUCCESS");
      } else {
        log("✗ DIVERGÊNCIA DETECTADA: Diferença de R$ " + data.difference.amount, "ERROR");
      }
    }

    async function refreshWallet() {
      if (!activeWalletId) return;
      const res = await fetch("/wallets/" + activeWalletId);
      const data = await res.json();
      document.getElementById("balanceDisplay").innerText = "R$ " + data.balance.amount;
      document.getElementById("walletMeta").innerText = "ID: " + activeWalletId.substring(0, 8) + "... | Versão: " + data.version;
    }

    async function loadLedger() {
      if (!activeWalletId) return;
      const res = await fetch("/wallets/" + activeWalletId + "/ledger?limit=20");
      const data = await res.json();
      const tbody = document.getElementById("ledgerTableBody");
      tbody.innerHTML = "";
      data.entries.forEach(e => {
        const tr = document.createElement("tr");
        const dirClass = e.direction === "CREDIT" ? "credit" : "debit";
        const sign = e.direction === "CREDIT" ? "+ " : "- ";
        tr.innerHTML = \`
          <td><span class="status-pill status-\${e.direction === 'CREDIT' ? 'processed' : 'rejected'}">\${e.direction}</span></td>
          <td class="\${dirClass}">\${sign}R$ \${e.money.amount}</td>
          <td>R$ \${e.balanceBefore.amount}</td>
          <td>R$ \${e.balanceAfter.amount}</td>
          <td style="color:var(--muted); font-size:11px;">\${new Date(e.createdAt).toLocaleTimeString()}</td>
        \`;
        tbody.appendChild(tr);
      });
    }
  </script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  }
}
