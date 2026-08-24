export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html");
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>AI Agent — ORDERE</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#e0e0e0;height:100vh;display:flex;overflow:hidden}
  
  /* Sidebar */
  .sidebar{width:240px;background:#1a1a1a;border-right:1px solid #2a2a2a;display:flex;flex-direction:column;flex-shrink:0}
  .sidebar-header{padding:20px;border-bottom:1px solid #2a2a2a}
  .agent-title{font-size:18px;font-weight:700;color:#ff6b2b}
  .agent-sub{font-size:11px;color:#666;margin-top:2px}
  .sidebar-nav{padding:12px 0;flex:1}
  .nav-label{font-size:10px;color:#444;padding:8px 16px 4px;text-transform:uppercase;letter-spacing:1px}
  .nav-item{display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;border-radius:0;transition:all .15s;font-size:13px;color:#888;border-left:3px solid transparent}
  .nav-item:hover{background:#222;color:#ddd}
  .nav-item.active{background:#1f1a16;color:#ff6b2b;border-left-color:#ff6b2b}
  .nav-icon{font-size:16px;width:20px;text-align:center}
  .sidebar-stats{padding:16px;border-top:1px solid #2a2a2a}
  .stat-row{display:flex;justify-content:space-between;margin-bottom:8px}
  .stat-label{font-size:11px;color:#555}
  .stat-value{font-size:11px;color:#ff6b2b;font-weight:600}

  /* Main */
  .main{flex:1;display:flex;flex-direction:column;overflow:hidden}
  .topbar{padding:16px 24px;background:#1a1a1a;border-bottom:1px solid #2a2a2a;display:flex;align-items:center;justify-content:space-between}
  .topbar-title{font-size:15px;font-weight:600;color:#fff}
  .status-dot{display:flex;align-items:center;gap:6px;font-size:12px;color:#4caf50}
  .dot{width:7px;height:7px;background:#4caf50;border-radius:50%;animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

  /* Chat area */
  .chat-area{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px}
  .chat-area::-webkit-scrollbar{width:4px}
  .chat-area::-webkit-scrollbar-track{background:#111}
  .chat-area::-webkit-scrollbar-thumb{background:#333;border-radius:2px}

  /* Messages */
  .msg{display:flex;gap:10px;max-width:85%}
  .msg.user{align-self:flex-end;flex-direction:row-reverse}
  .msg-avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
  .msg.user .msg-avatar{background:#ff6b2b;color:#fff}
  .msg.agent .msg-avatar{background:#2a2a2a;color:#ff6b2b}
  .msg-bubble{padding:12px 16px;border-radius:12px;font-size:13px;line-height:1.6;white-space:pre-wrap}
  .msg.user .msg-bubble{background:#ff6b2b;color:#fff;border-bottom-right-radius:3px}
  .msg.agent .msg-bubble{background:#1e1e1e;color:#ddd;border-bottom-left-radius:3px;border:1px solid #2a2a2a}
  .msg-time{font-size:10px;color:#444;margin-top:4px;text-align:right}
  .msg.agent .msg-time{text-align:left}

  /* Welcome card */
  .welcome{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:24px;margin-bottom:8px}
  .welcome h2{font-size:16px;color:#fff;margin-bottom:8px}
  .welcome p{font-size:13px;color:#666;line-height:1.6;margin-bottom:16px}
  .quick-btns{display:flex;flex-wrap:wrap;gap:8px}
  .quick-btn{background:#222;border:1px solid #333;color:#aaa;padding:8px 14px;border-radius:20px;font-size:12px;cursor:pointer;transition:all .15s}
  .quick-btn:hover{background:#2a2a2a;border-color:#ff6b2b;color:#ff6b2b}

  /* Input */
  .input-area{padding:16px 24px;background:#1a1a1a;border-top:1px solid #2a2a2a}
  .input-row{display:flex;gap:10px;align-items:flex-end}
  .input-box{flex:1;background:#111;border:1px solid #2a2a2a;border-radius:10px;padding:12px 16px;color:#e0e0e0;font-size:13px;resize:none;outline:none;font-family:inherit;max-height:120px;transition:border .15s}
  .input-box:focus{border-color:#ff6b2b}
  .input-box::placeholder{color:#444}
  .send-btn{background:#ff6b2b;border:none;color:#fff;width:42px;height:42px;border-radius:10px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s}
  .send-btn:hover{opacity:.85}
  .send-btn:disabled{opacity:.4;cursor:not-allowed}
  .input-hint{font-size:11px;color:#444;margin-top:8px}

  /* Loading */
  .typing{display:flex;gap:4px;padding:4px 0}
  .typing span{width:6px;height:6px;background:#444;border-radius:50%;animation:bounce .8s infinite}
  .typing span:nth-child(2){animation-delay:.15s}
  .typing span:nth-child(3){animation-delay:.3s}
  @keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}
</style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-header">
    <div class="agent-title">AI Agent</div>
    <div class="agent-sub">ORDERE Marketing Intelligence</div>
  </div>
  <div class="sidebar-nav">
    <div class="nav-label">Menu</div>
    <div class="nav-item active" onclick="setPage('ask')">
      <span class="nav-icon">💬</span> Ask Me
    </div>
    <div class="nav-item" onclick="setPage('history')">
      <span class="nav-icon">📋</span> History
    </div>
    <div class="nav-label" style="margin-top:8px">Coming Soon</div>
    <div class="nav-item" style="opacity:.4;cursor:not-allowed">
      <span class="nav-icon">📢</span> Ads Status
    </div>
    <div class="nav-item" style="opacity:.4;cursor:not-allowed">
      <span class="nav-icon">🛒</span> Orders Data
    </div>
    <div class="nav-item" style="opacity:.4;cursor:not-allowed">
      <span class="nav-icon">📊</span> Analytics
    </div>
  </div>
  <div class="sidebar-stats">
    <div class="nav-label" style="padding:0 0 8px">System</div>
    <div class="stat-row"><span class="stat-label">SchedulePro</span><span class="stat-value">Connected ✓</span></div>
    <div class="stat-row"><span class="stat-label">Wazzup</span><span class="stat-value" style="color:#666">Pending</span></div>
    <div class="stat-row"><span class="stat-label">Businesses</span><span class="stat-value">700+</span></div>
  </div>
</div>

<div class="main">
  <div class="topbar">
    <div class="topbar-title">Ask Me — Marketing Intelligence</div>
    <div class="status-dot"><div class="dot"></div> Live</div>
  </div>

  <div class="chat-area" id="chatArea">
    <div class="welcome">
      <h2>Hi! I'm your AI Marketing Agent</h2>
      <p>Ask me about any restaurant's marketing — scheduled posts, published content, upcoming campaigns and more. I pull live data from SchedulePro instantly.</p>
      <div class="quick-btns">
        <button class="quick-btn" onclick="sendQuick('Yasmin Restaurant marketing update')">Yasmin Restaurant update</button>
        <button class="quick-btn" onclick="sendQuick('Voujon Indian marketing update')">Voujon Indian update</button>
        <button class="quick-btn" onclick="sendQuick('Zafrani marketing update')">Zafrani update</button>
        <button class="quick-btn" onclick="sendQuick('Star Anise marketing update')">Star Anise update</button>
        <button class="quick-btn" onclick="sendQuick('Lipson Tandoori marketing update')">Lipson Tandoori update</button>
      </div>
    </div>
  </div>

  <div class="input-area">
    <div class="input-row">
      <textarea class="input-box" id="msgInput" rows="1" placeholder="Ask me anything... e.g. 'Voujon Indian marketing update'" onkeydown="handleKey(event)" oninput="autoResize(this)"></textarea>
      <button class="send-btn" id="sendBtn" onclick="sendMessage()">&#10148;</button>
    </div>
    <div class="input-hint">Press Enter to send &nbsp;·&nbsp; Shift+Enter for new line</div>
  </div>
</div>

<script>
const API = window.location.origin + "/api/query";
let history = [];

function setPage(page) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  event.target.closest('.nav-item').classList.add('active');
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function sendQuick(msg) {
  document.getElementById('msgInput').value = msg;
  sendMessage();
}

function getTime() {
  return new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

function addMessage(text, type) {
  const area = document.getElementById('chatArea');
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  const avatar = type === 'user' ? '👤' : '🤖';
  div.innerHTML = \`
    <div class="msg-avatar">\${avatar}</div>
    <div>
      <div class="msg-bubble">\${text}</div>
      <div class="msg-time">\${getTime()}</div>
    </div>
  \`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return div;
}

function addTyping() {
  const area = document.getElementById('chatArea');
  const div = document.createElement('div');
  div.className = 'msg agent';
  div.id = 'typing';
  div.innerHTML = \`
    <div class="msg-avatar">🤖</div>
    <div>
      <div class="msg-bubble">
        <div class="typing"><span></span><span></span><span></span></div>
      </div>
    </div>
  \`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('msgInput');
  const btn = document.getElementById('sendBtn');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;

  addMessage(msg, 'user');
  history.push({ role: 'user', content: msg });

  addTyping();

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    const data = await res.json();
    document.getElementById('typing')?.remove();

    const reply = data.reply || data.error || 'Something went wrong';
    addMessage(reply, 'agent');
    history.push({ role: 'agent', content: reply });

  } catch (err) {
    document.getElementById('typing')?.remove();
    addMessage('Connection error — please try again.', 'agent');
  }

  btn.disabled = false;
  input.focus();
}
</script>
</body>
</html>`);
}
