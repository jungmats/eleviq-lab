/* ElevIQ Lab — Demo 1 console.
 *
 * PROTOTYPE / VISUAL DRAFT. The exchange below is SIMULATED in the browser so
 * the page layout, copy and interaction can be reviewed before the real edge
 * functions are wired in. Nothing here does real cryptography yet.
 *
 * When wired for real, runScenario() is replaced by:
 *   1. sign the Request in-browser with web-bot-auth (demo key), and
 *   2. fetch('/api/identity/price-list', { headers }) against the Pages Function,
 * then render the actual response. Everything else on the page stays as is.
 */

const AGENTS = {
  'ChatGPT-User/1.0 (+https://openai.com/bot)':      { name: 'ChatGPT-User',     operator: 'OpenAI',      domain: 'openai.com' },
  'ClaudeBot/1.0 (+https://anthropic.com/claudebot)':{ name: 'ClaudeBot',        operator: 'Anthropic',   domain: 'anthropic.com' },
  'PerplexityBot/1.0 (+https://perplexity.ai/bot)':  { name: 'PerplexityBot',    operator: 'Perplexity',  domain: 'perplexity.ai' },
  'ResearchCrawler/0.1':                             { name: 'ResearchCrawler',  operator: 'unknown',     domain: null },
};

const HOST = 'eleviq-lab.pages.dev';
const PATH = '/api/identity/price-list';

const FULL_LIST = {
  resource: 'Q3 partner price list',
  access: 'verified-agent',
  currency: 'EUR',
  tiers: [
    { tier: 'Referral',   monthly: 0,    commission: '12%' },
    { tier: 'Reseller',   monthly: 490,  commission: '25%', min_seats: 10 },
    { tier: 'Strategic',  monthly: 1900, commission: '34%', min_seats: 50, mdf: true },
  ],
  valid_until: '2026-09-30',
};

const TEASER = {
  resource: 'Q3 partner price list',
  access: 'public',
  teaser: 'Three partner tiers (Referral, Reseller, Strategic). Full pricing and commission rates require a verified agent.',
  note: 'Send this request signed with Web Bot Auth to receive the full list.',
  how_to_authenticate: 'https://' + HOST + '/.well-known/http-message-signatures-directory',
};

/* ----- fake-but-plausible signature material (prototype only) ----- */

function b64url(n) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

const KEYS = {
  trusted:   () => 'poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0w'.slice(0, 43),
  untrusted: () => b64url(43),
};

/* ----- rendering ----- */

const $ = (id) => document.getElementById(id);

function currentAgent() {
  const ua = $('ua').value;
  return { ua, ...AGENTS[ua] };
}
function currentScenario() {
  return document.querySelector('input[name="scenario"]:checked').value;
}

function h(name) { return '<span class="h-name">' + name + '</span>'; }

function renderRequest(scenario, agent, sig) {
  const lines = [
    'GET ' + PATH + ' HTTP/1.1',
    h('Host') + ': ' + HOST,
    h('User-Agent') + ': ' + agent.ua,
    h('Accept') + ': application/json',
  ];
  if (scenario !== 'unsigned') {
    lines.push(h('Signature-Agent') + ': "https://' + HOST + '"');
    lines.push(h('Signature-Input') + ': sig=("@authority" "signature-agent");'
      + 'created=' + sig.created + ';expires=' + sig.expires
      + ';keyid="' + sig.keyid + '";alg="ed25519";tag="web-bot-auth"');
    lines.push(h('Signature') + ': sig=:' + sig.sigval + ':');
  }
  return lines.join('\n');
}

function curlFor(scenario, agent, sig) {
  const parts = [
    "curl -sD - 'https://" + HOST + PATH + "'",
    "  -H 'User-Agent: " + agent.ua + "'",
    "  -H 'Accept: application/json'",
  ];
  if (scenario !== 'unsigned') {
    parts.push("  -H 'Signature-Agent: \"https://" + HOST + "\"'");
    parts.push("  -H 'Signature-Input: sig=(\"@authority\" \"signature-agent\");created="
      + sig.created + ";expires=" + sig.expires + ";keyid=\"" + sig.keyid
      + "\";alg=\"ed25519\";tag=\"web-bot-auth\"'");
    parts.push("  -H 'Signature: sig=:" + sig.sigval + ":'");
  }
  return parts.join(' \\\n');
}

function setVerdict(kind, status, reason, facts) {
  const v = $('verdict');
  v.className = 'verdict ' + ({ ok: 'is-ok', bad: 'is-bad', warn: 'is-warn' }[kind] || '');
  v.querySelector('.status').textContent = status;
  v.querySelector('.reason').textContent = reason;
  const dl = $('facts');
  dl.innerHTML = '';
  if (facts && facts.length) {
    for (const [k, val] of facts) {
      dl.insertAdjacentHTML('beforeend', '<dt>' + k + '</dt><dd>' + val + '</dd>');
    }
    dl.hidden = false;
  } else {
    dl.hidden = true;
  }
}

function logLine(scenario, kind, text) {
  const cls = { ok: 'v-ok', bad: 'v-bad', warn: 'v-warn' }[kind];
  const t = new Date().toLocaleTimeString();
  $('log').insertAdjacentHTML('afterbegin',
    '<li>' + t + ' · ' + scenario + ' · <span class="' + cls + '">' + text + '</span></li>');
}

/* ----- the simulated exchange (swapped for real sign+fetch later) ----- */

function runScenario(scenario, agent) {
  const now = Math.floor(Date.now() / 1000);
  const sig = { created: now, expires: now + 300, sigval: b64url(86) + '==' };

  if (scenario === 'unsigned') {
    sig.keyid = null;
    return {
      sig,
      httpStatus: '401 Unauthorized',
      kind: 'bad',
      status: '⛔  REFUSED · 401',
      reason: 'No signature. The server has only the User-Agent claim, which is not proof of identity.',
      facts: [
        ['Claimed', agent.name + ' (' + agent.operator + ')'],
        ['Verified as', '—'],
        ['Signature', 'absent'],
      ],
      body: TEASER,
    };
  }

  if (scenario === 'unknown-key') {
    sig.keyid = KEYS.untrusted();
    return {
      sig,
      httpStatus: '401 Unauthorized',
      kind: 'warn',
      status: '⚠️  REJECTED · 401',
      reason: 'Signature is cryptographically valid, but key ' + sig.keyid.slice(0, 12)
        + '… is not listed in any key directory this server trusts.',
      facts: [
        ['Claimed', agent.name + ' (' + agent.operator + ')'],
        ['Verified as', '—'],
        ['Key ID', sig.keyid],
        ['Signature', 'valid, but key not trusted'],
        ['Directory', 'no match'],
      ],
      body: TEASER,
    };
  }

  // valid
  sig.keyid = KEYS.trusted();
  return {
    sig,
    httpStatus: '200 OK',
    kind: 'ok',
    status: '✅  VERIFIED · 200',
    reason: 'Signature valid and key found in a trusted directory. Full resource served.',
    facts: [
      ['Verified as', agent.name],
      ['Operator', agent.operator + (agent.domain ? ' (' + agent.domain + ')' : '')],
      ['Key ID', sig.keyid],
      ['Signed', 'just now'],
      ['Valid for', '5 minutes'],
      ['Directory', HOST + ' /.well-known/… (lab stand-in)'],
    ],
    body: FULL_LIST,
  };
}

function send() {
  const scenario = currentScenario();
  const agent = currentAgent();
  const btn = $('send');
  btn.disabled = true;

  // small delay so it feels like a network call
  setTimeout(() => {
    const r = runScenario(scenario, agent);

    $('req-wire').innerHTML = renderRequest(scenario, agent, r.sig);
    const curl = curlFor(scenario, agent, r.sig);
    const copyBtn = $('copy-curl');
    copyBtn.hidden = false;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(curl).then(() => {
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => (copyBtn.textContent = 'Copy as curl'), 1500);
      });
    };

    setVerdict(r.kind, r.status, r.reason, r.facts);
    $('res-body').textContent =
      'HTTP/1.1 ' + r.httpStatus + '\n\n' + JSON.stringify(r.body, null, 2);

    const summary = r.kind === 'ok'
      ? 'VERIFIED as ' + agent.name + ' (' + agent.operator + ')'
      : (r.kind === 'warn' ? 'REJECTED — untrusted key' : 'REFUSED — no signature');
    logLine(scenario, r.kind, summary);

    btn.disabled = false;
  }, 220);
}

$('send').addEventListener('click', send);

// Deep-link a pre-run state: /identity/?send=valid|unsigned|unknown-key
// (handy when walking a customer through a specific outcome).
const preset = new URLSearchParams(location.search).get('send');
if (preset && ['valid', 'unsigned', 'unknown-key'].includes(preset)) {
  const radio = document.querySelector('input[name="scenario"][value="' + preset + '"]');
  if (radio) { radio.checked = true; send(); }
}
