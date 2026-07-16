type WebsiteOptions = {
  publicUrl: string;
  network: "base-sepolia" | "base";
  demoEnabled: boolean;
};

const githubUrl = "https://github.com/Rileyh-git/loopfare";

export function websiteHtml(options: WebsiteOptions) {
  const publicUrl = escapeHtml(options.publicUrl);
  const networkLabel = options.network === "base" ? "Base mainnet" : "Base Sepolia beta";
  const demoHref = options.demoEnabled ? "/demo/v1/fortune" : "#quickstart";
  const demoLabel = options.demoEnabled ? "Try the paid demo" : "Launch the quickstart";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Loopfare — Usage-based payments for AI APIs</title>
  <meta name="description" content="Put an x402 payment gate in front of any HTTP API. AI agents pay per request with USDC on Base—no buyer accounts or API keys.">
  <meta name="theme-color" content="#f5f3ef">
  <meta property="og:title" content="Loopfare — Make every API call pay its fare">
  <meta property="og:description" content="Usage-based payments for APIs and AI agents, powered by x402 on Base.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${publicUrl}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root {
      --paper: #f5f3ef;
      --paper-2: #ebe8e2;
      --ink: #17151f;
      --muted: #696572;
      --line: rgba(23, 21, 31, .13);
      --purple: #6d4aff;
      --purple-dark: #4d36a4;
      --lime: #c8ff68;
      --night: #171420;
      --night-2: #211c2c;
      --white: #fff;
      --radius: 14px;
      --shadow: 0 34px 90px rgba(25, 18, 42, .19), 0 4px 14px rgba(25, 18, 42, .09);
      --sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --serif: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
      color-scheme: light;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      color: var(--ink);
      background: var(--paper);
      font-family: var(--sans);
      line-height: 1.55;
      text-rendering: optimizeLegibility;
    }
    a { color: inherit; text-decoration: none; }
    button, a { -webkit-tap-highlight-color: transparent; }
    .skip-link {
      position: fixed; left: 16px; top: -60px; z-index: 100;
      padding: 10px 14px; background: var(--ink); color: white; border-radius: 8px;
    }
    .skip-link:focus { top: 16px; }
    .shell { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
    .topbar {
      display: flex; justify-content: center; align-items: center; gap: 9px;
      min-height: 36px; padding: 7px 18px; color: #eeeaf5; background: var(--night);
      font-size: 12px; letter-spacing: .02em;
    }
    .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 0 4px rgba(200,255,104,.12); }
    .nav {
      height: 78px; display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid var(--line);
    }
    .brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 760; letter-spacing: -.035em; font-size: 20px; }
    .brand svg { width: 29px; height: 29px; }
    .nav-links { display: flex; align-items: center; gap: 30px; font-size: 14px; color: #36323d; }
    .nav-actions { display: flex; align-items: center; gap: 10px; }
    .button {
      min-height: 43px; display: inline-flex; align-items: center; justify-content: center; gap: 9px;
      padding: 10px 17px; border: 1px solid var(--line); border-radius: 9px;
      font-size: 14px; font-weight: 650; transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
    }
    .button:hover { transform: translateY(-1px); box-shadow: 0 7px 20px rgba(24,20,33,.1); }
    .button-primary { background: var(--purple-dark); color: white; border-color: transparent; }
    .button-dark { background: var(--ink); color: white; border-color: transparent; }
    .hero {
      position: relative; overflow: hidden; min-height: 900px;
      background:
        radial-gradient(circle at 50% 26%, rgba(127,93,255,.8) 0, rgba(82,53,150,.76) 23%, rgba(36,27,53,.98) 55%, var(--night) 77%);
      color: white;
    }
    .hero::before {
      content: ""; position: absolute; inset: 0; opacity: .34; pointer-events: none;
      background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: linear-gradient(to bottom, black, transparent 74%);
    }
    .hero-copy { position: relative; z-index: 1; text-align: center; padding: 102px 0 63px; }
    .eyebrow {
      display: inline-flex; align-items: center; gap: 8px; margin-bottom: 20px;
      font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
      color: rgba(255,255,255,.72);
    }
    .eyebrow::before { content: ""; width: 25px; height: 1px; background: currentColor; }
    h1, h2, h3, p { margin-top: 0; }
    h1 {
      max-width: 910px; margin: 0 auto 20px; font-family: var(--serif); font-weight: 500;
      font-size: clamp(56px, 7.5vw, 94px); line-height: .98; letter-spacing: -.055em;
    }
    .hero-copy > p { max-width: 660px; margin: 0 auto 32px; color: rgba(255,255,255,.74); font-size: clamp(17px, 2vw, 21px); }
    .hero-actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
    .hero-actions .button { min-width: 164px; min-height: 50px; font-size: 15px; }
    .hero-actions .button-primary { background: white; color: var(--ink); }
    .hero-actions .button-secondary { border-color: rgba(255,255,255,.25); background: rgba(255,255,255,.06); }

    .canvas-wrap { position: relative; z-index: 2; width: min(1080px, calc(100% - 40px)); margin: 0 auto; }
    .canvas {
      overflow: hidden; min-height: 487px; border: 1px solid rgba(255,255,255,.52); border-radius: 16px 16px 0 0;
      background: #f8f7f4; color: var(--ink); box-shadow: var(--shadow);
    }
    .canvas-bar {
      height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 17px;
      border-bottom: 1px solid #dedbe3; background: rgba(255,255,255,.72); font-size: 12px;
    }
    .canvas-title { display: flex; gap: 10px; align-items: center; font-weight: 650; }
    .mark-mini { width: 19px; height: 19px; border-radius: 50%; background: var(--ink); position: relative; }
    .mark-mini::after { content: ""; position: absolute; width: 10px; height: 2px; background: white; left: 4px; top: 8px; transform: rotate(-15deg); }
    .canvas-status { display: flex; align-items: center; gap: 7px; color: #5b5762; }
    .canvas-grid {
      position: relative; min-height: 438px; padding: 44px;
      background-image: radial-gradient(#d2ced7 1px, transparent 1px); background-size: 18px 18px;
    }
    .flow { position: relative; display: grid; grid-template-columns: 1fr 68px 1.12fr 68px 1fr; align-items: center; min-height: 245px; }
    .node {
      position: relative; padding: 21px; min-height: 145px; background: white; border: 1px solid #d8d5dd; border-radius: 13px;
      box-shadow: 0 10px 30px rgba(31,24,44,.08);
    }
    .node-paid { border-color: #9f88ff; box-shadow: 0 14px 38px rgba(88,59,172,.17); }
    .node-kicker { display: flex; align-items: center; gap: 8px; margin-bottom: 19px; color: #77717e; font-size: 11px; text-transform: uppercase; letter-spacing: .09em; }
    .node-icon { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 7px; background: #f0edf6; font-size: 14px; }
    .node strong { display: block; margin-bottom: 5px; font-size: 17px; letter-spacing: -.025em; }
    .node p { margin: 0; color: #7b7582; font-size: 12px; }
    .node code { display: inline-block; margin-top: 13px; padding: 5px 7px; border-radius: 5px; background: #f1eef5; color: #5f489a; font-size: 10px; }
    .connector { height: 1px; background: #bcb5c8; position: relative; }
    .connector::after { content: ""; position: absolute; right: 0; top: -3px; width: 7px; height: 7px; border-top: 1px solid #8d849a; border-right: 1px solid #8d849a; transform: rotate(45deg); }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }
    .metric { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 1px solid #dedbe2; border-radius: 9px; background: rgba(255,255,255,.78); font-size: 12px; }
    .metric span { color: #77717e; }
    .metric strong { font-variant-numeric: tabular-nums; }

    .marquee { border-bottom: 1px solid var(--line); background: var(--paper); }
    .protocols { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 18px 46px; min-height: 112px; color: #7a7580; }
    .protocol { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 650; }
    .protocol b { color: #393540; font-size: 16px; }
    .section { padding: 120px 0; }
    .section-label { margin-bottom: 18px; color: var(--purple-dark); font-size: 12px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    .section-heading { max-width: 770px; margin-bottom: 58px; font-family: var(--serif); font-size: clamp(42px, 5vw, 68px); font-weight: 500; line-height: 1.02; letter-spacing: -.045em; }
    .three-grid { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
    .feature { min-height: 275px; padding: 30px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .feature-number { color: #8e8793; font-family: var(--serif); font-size: 15px; }
    .feature h3 { margin: 70px 0 11px; font-size: 21px; letter-spacing: -.035em; }
    .feature p { color: var(--muted); font-size: 14px; }

    .night { background: var(--night); color: white; }
    .night .section-label { color: #bcaaff; }
    .night .section-heading { color: white; }
    .steps { display: grid; grid-template-columns: .9fr 1.1fr; gap: 80px; align-items: start; }
    .step-list { border-top: 1px solid rgba(255,255,255,.15); }
    .step { display: grid; grid-template-columns: 38px 1fr; gap: 12px; padding: 25px 0; border-bottom: 1px solid rgba(255,255,255,.15); }
    .step-index { color: #ad9fd0; font-family: var(--serif); }
    .step h3 { margin: 0 0 7px; font-size: 18px; }
    .step p { margin: 0; color: rgba(255,255,255,.58); font-size: 14px; }
    .terminal { overflow: hidden; border: 1px solid rgba(255,255,255,.15); border-radius: var(--radius); background: #0e0c13; box-shadow: 0 35px 90px rgba(0,0,0,.3); }
    .terminal-bar { display: flex; justify-content: space-between; padding: 13px 17px; border-bottom: 1px solid rgba(255,255,255,.1); color: #88818e; font-size: 11px; }
    .dots { display: flex; gap: 6px; }
    .dots i { width: 8px; height: 8px; border-radius: 50%; background: #3a3442; }
    pre { margin: 0; padding: 25px; overflow-x: auto; color: #f4f1f7; font: 13px/1.85 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .code-muted { color: #81798a; }
    .code-purple { color: #b8a1ff; }
    .code-green { color: #c8ff68; }
    .copy {
      color: #aaa2b1; background: none; border: 0; font: inherit; cursor: pointer;
    }
    .copy:hover { color: white; }

    .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .compare-card { padding: 35px; border: 1px solid var(--line); border-radius: var(--radius); background: rgba(255,255,255,.42); }
    .compare-card.highlight { color: white; border-color: transparent; background: linear-gradient(145deg, #5b3cd0, #2f2351); }
    .compare-card h3 { font-family: var(--serif); font-weight: 500; font-size: 30px; letter-spacing: -.035em; }
    .check-list { list-style: none; margin: 0; padding: 0; }
    .check-list li { display: flex; gap: 10px; padding: 13px 0; border-top: 1px solid var(--line); font-size: 14px; }
    .highlight .check-list li { border-color: rgba(255,255,255,.16); }
    .check-list span { color: var(--purple); }
    .highlight .check-list span { color: var(--lime); }

    .faq { display: grid; grid-template-columns: .75fr 1.25fr; gap: 80px; }
    details { border-top: 1px solid var(--line); }
    details:last-child { border-bottom: 1px solid var(--line); }
    summary { display: flex; justify-content: space-between; gap: 20px; padding: 23px 0; cursor: pointer; font-weight: 650; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary::after { content: "+"; color: var(--purple-dark); font-size: 21px; font-weight: 400; }
    details[open] summary::after { content: "−"; }
    details p { max-width: 680px; padding: 0 35px 21px 0; color: var(--muted); font-size: 14px; }
    .cta { position: relative; overflow: hidden; padding: 110px 0; color: white; background: var(--night); text-align: center; }
    .cta::before { content: ""; position: absolute; inset: -200px; background: radial-gradient(circle, rgba(110,75,255,.48), transparent 48%); }
    .cta .shell { position: relative; }
    .cta h2 { max-width: 820px; margin: 0 auto 18px; font-family: var(--serif); font-size: clamp(48px, 7vw, 82px); font-weight: 500; line-height: 1; letter-spacing: -.05em; }
    .cta p { color: rgba(255,255,255,.62); }
    .cta .hero-actions { margin-top: 28px; }
    .footer { padding: 62px 0 30px; background: #0f0d14; color: #a9a3b0; }
    .footer-grid { display: grid; grid-template-columns: 2fr repeat(3, 1fr); gap: 50px; margin-bottom: 70px; }
    .footer .brand { color: white; margin-bottom: 16px; }
    .footer-copy { max-width: 300px; font-size: 13px; }
    .footer h3 { margin-bottom: 18px; color: white; font-size: 12px; text-transform: uppercase; letter-spacing: .09em; }
    .footer-links { display: grid; gap: 10px; font-size: 13px; }
    .footer-links a:hover { color: white; }
    .footer-bottom { display: flex; justify-content: space-between; gap: 20px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,.1); font-size: 12px; }
    .live { display: flex; align-items: center; gap: 8px; }
    .live i { width: 7px; height: 7px; border-radius: 50%; background: #8f8995; }
    .live.ok i { background: var(--lime); }

    @media (max-width: 850px) {
      .nav-links { display: none; }
      .hero { min-height: 800px; }
      .hero-copy { padding-top: 76px; }
      .canvas-grid { padding: 26px; }
      .flow { grid-template-columns: 1fr; gap: 12px; }
      .connector { width: 1px; height: 24px; margin: 0 auto; }
      .connector::after { right: -3px; top: 17px; transform: rotate(135deg); }
      .node { min-height: 0; }
      .metrics { grid-template-columns: 1fr; }
      .three-grid, .comparison { grid-template-columns: 1fr; }
      .steps, .faq { grid-template-columns: 1fr; gap: 45px; }
      .footer-grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 560px) {
      .shell { width: min(100% - 28px, 1180px); }
      .nav { height: 68px; }
      .nav-actions .button:first-child { display: none; }
      h1 { font-size: 52px; }
      .hero-copy > p { font-size: 17px; }
      .canvas-wrap { width: calc(100% - 18px); }
      .canvas-grid { padding: 16px; }
      .section { padding: 82px 0; }
      .section-heading { margin-bottom: 40px; }
      .feature { min-height: 230px; }
      .feature h3 { margin-top: 45px; }
      .terminal pre { font-size: 11px; padding: 18px; }
      .footer-grid { grid-template-columns: 1fr; }
      .footer-bottom { flex-direction: column; }
    }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="topbar"><span class="pulse" aria-hidden="true"></span>${networkLabel} · x402 v2</div>
  <header class="shell">
    <nav class="nav" aria-label="Main navigation">
      <a class="brand" href="/" aria-label="Loopfare home">
        ${logoSvg()}
        <span>loopfare</span>
      </a>
      <div class="nav-links">
        <a href="#product">Product</a>
        <a href="#how">How it works</a>
        <a href="#quickstart">Developers</a>
        <a href="#faq">FAQ</a>
      </div>
      <div class="nav-actions">
        <a class="button" href="${githubUrl}">GitHub</a>
        <a class="button button-dark" href="${demoHref}">${demoLabel} <span aria-hidden="true">→</span></a>
      </div>
    </nav>
  </header>

  <main id="main">
    <section class="hero">
      <div class="hero-copy shell">
        <div class="eyebrow">Payments built for agents</div>
        <h1>Make every API call pay its fare.</h1>
        <p>Put an x402 payment gate in front of any HTTP API. Agents pay per request in USDC—without buyer accounts, subscriptions, or API keys.</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#quickstart">Start building <span aria-hidden="true">→</span></a>
          <a class="button button-secondary" href="/skill.md">Read the agent skill</a>
        </div>
      </div>

      <div class="canvas-wrap" aria-label="Loopfare payment flow preview">
        <div class="canvas">
          <div class="canvas-bar">
            <div class="canvas-title"><span class="mark-mini" aria-hidden="true"></span> Production flow</div>
            <div class="canvas-status"><span class="pulse" aria-hidden="true"></span> Ready on ${networkLabel}</div>
          </div>
          <div class="canvas-grid">
            <div class="flow">
              <div class="node">
                <div class="node-kicker"><span class="node-icon">⌁</span> Buyer</div>
                <strong>AI agent</strong>
                <p>Requests a protected resource.</p>
                <code>GET /p/weather/today</code>
              </div>
              <div class="connector" aria-hidden="true"></div>
              <div class="node node-paid">
                <div class="node-kicker"><span class="node-icon">402</span> Loopfare</div>
                <strong>Payment gate</strong>
                <p>Quotes, verifies, and settles USDC.</p>
                <code>PAYMENT-SIGNATURE</code>
              </div>
              <div class="connector" aria-hidden="true"></div>
              <div class="node">
                <div class="node-kicker"><span class="node-icon">API</span> Seller</div>
                <strong>Your origin</strong>
                <p>Receives only paid requests.</p>
                <code>200 application/json</code>
              </div>
            </div>
            <div class="metrics">
              <div class="metric"><span>Price per call</span><strong>$0.001</strong></div>
              <div class="metric"><span>Buyer signup</span><strong>Not required</strong></div>
              <div class="metric"><span>Settlement</span><strong>Onchain</strong></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="marquee" aria-label="Technology stack">
      <div class="protocols shell">
        <div class="protocol"><b>x402</b> Payment protocol</div>
        <div class="protocol"><b>USDC</b> Stable value</div>
        <div class="protocol"><b>Base</b> Fast settlement</div>
        <div class="protocol"><b>HTTP</b> Native integration</div>
        <div class="protocol"><b>CLI</b> Agent-ready</div>
      </div>
    </div>

    <section class="section" id="product">
      <div class="shell">
        <div class="section-label">One small proxy, one big unlock</div>
        <h2 class="section-heading">Usage-based revenue without rebuilding your API.</h2>
        <div class="three-grid">
          <article class="feature">
            <span class="feature-number">01</span>
            <h3>Protect any HTTP origin</h3>
            <p>Point Loopfare at an existing API, choose a route and price, and get a paid public endpoint in minutes.</p>
          </article>
          <article class="feature">
            <span class="feature-number">02</span>
            <h3>Let agents pay themselves</h3>
            <p>Standards-based 402 responses tell compatible clients exactly how much to pay, where, and on which network.</p>
          </article>
          <article class="feature">
            <span class="feature-number">03</span>
            <h3>Settle directly to sellers</h3>
            <p>USDC moves to the seller's wallet. Loopfare never holds buyer funds and is not a custodial wallet.</p>
          </article>
          <article class="feature">
            <span class="feature-number">04</span>
            <h3>Track every paid request</h3>
            <p>Project-scoped payment history and earnings make usage visible without bolting on a separate metering stack.</p>
          </article>
          <article class="feature">
            <span class="feature-number">05</span>
            <h3>Give agents hard context</h3>
            <p>Machine-readable CLI output, an agent skill, and clear HTTP semantics keep autonomous workflows predictable.</p>
          </article>
          <article class="feature">
            <span class="feature-number">06</span>
            <h3>Start safely on testnet</h3>
            <p>Validate the complete seller and buyer flow on Base Sepolia before moving real value on Base mainnet.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section night" id="how">
      <div class="shell steps">
        <div>
          <div class="section-label">HTTP payments, end to end</div>
          <h2 class="section-heading">A 402 is just a handshake.</h2>
        </div>
        <div class="step-list">
          <article class="step"><span class="step-index">01</span><div><h3>The agent makes a normal request</h3><p>No pre-registration. No subscription. It simply asks for the protected resource.</p></div></article>
          <article class="step"><span class="step-index">02</span><div><h3>Loopfare returns payment requirements</h3><p>The 402 response includes a v2 PAYMENT-REQUIRED challenge with the price, network, and seller wallet.</p></div></article>
          <article class="step"><span class="step-index">03</span><div><h3>The buyer signs and retries</h3><p>An x402 client creates the payment payload and repeats the request with PAYMENT-SIGNATURE.</p></div></article>
          <article class="step"><span class="step-index">04</span><div><h3>Payment settles, then traffic flows</h3><p>The facilitator verifies settlement and Loopfare proxies the paid request to the seller's origin.</p></div></article>
        </div>
      </div>
    </section>

    <section class="section night" id="quickstart">
      <div class="shell steps">
        <div class="terminal">
          <div class="terminal-bar"><span class="dots"><i></i><i></i><i></i></span><button class="copy" type="button" data-copy="seller-code">Copy</button></div>
          <pre id="seller-code"><span class="code-muted"># create a seller account</span>
<span class="code-purple">loopfare</span> set-api ${publicUrl}
<span class="code-purple">loopfare</span> signup --email you@example.com --json

<span class="code-muted"># create a paid proxy</span>
<span class="code-purple">loopfare</span> projects create \\
  --name "Weather API" \\
  --slug weather \\
  --pay-to 0xYourWallet --json

<span class="code-purple">loopfare</span> protect \\
  --project PROJECT_ID \\
  --origin https://api.example.com \\
  --path "/v1/*" \\
  --price "$0.001" --json

<span class="code-green"># agents can now call /p/weather/v1/...</span></pre>
        </div>
        <div>
          <div class="section-label">CLI-first quickstart</div>
          <h2 class="section-heading">From origin to paid endpoint.</h2>
          <p style="color:rgba(255,255,255,.6);max-width:540px">The CLI is built for developers and autonomous agents. Every command supports structured JSON output, so setup can be scripted and audited.</p>
          <a class="button button-primary" href="${githubUrl}#readme" style="margin-top:18px">Open the full guide <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="shell">
        <div class="section-label">Built for machine customers</div>
        <h2 class="section-heading">Replace credential friction with a price.</h2>
        <div class="comparison">
          <article class="compare-card">
            <h3>Traditional API access</h3>
            <ul class="check-list">
              <li><span>×</span> Account creation before the first request</li>
              <li><span>×</span> API keys that must be issued and rotated</li>
              <li><span>×</span> Prepaid credits or monthly commitments</li>
              <li><span>×</span> Separate metering, invoicing, and collection</li>
            </ul>
          </article>
          <article class="compare-card highlight">
            <h3>Loopfare access</h3>
            <ul class="check-list">
              <li><span>✓</span> The price ships with the HTTP response</li>
              <li><span>✓</span> The buyer authenticates the payment, not an account</li>
              <li><span>✓</span> Pay only when a protected resource is used</li>
              <li><span>✓</span> Direct, transparent onchain settlement</li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="faq">
      <div class="shell faq">
        <div>
          <div class="section-label">FAQ</div>
          <h2 class="section-heading">The useful details.</h2>
        </div>
        <div>
          <details><summary>What is x402?</summary><p>x402 is an open payment protocol that turns HTTP 402 Payment Required into a machine-readable payment flow. The server advertises terms, the client signs a payment, and a facilitator verifies and settles it.</p></details>
          <details><summary>Does Loopfare custody funds?</summary><p>No. Sellers choose the receiving wallet for each project, and payments settle to that address. Buyer private keys stay with the buyer's wallet or local CLI configuration.</p></details>
          <details><summary>Can I use my existing API?</summary><p>Yes. Loopfare is a reverse proxy: configure an HTTPS origin, choose protected methods and paths, and send paid requests through the generated /p/&lt;project&gt;/... URL.</p></details>
          <details><summary>Is this mainnet?</summary><p>This deployment currently advertises ${networkLabel}. Base Sepolia is for end-to-end testing with test USDC; switch to Base and a mainnet-capable facilitator only after operational and legal review.</p></details>
          <details><summary>How do agent budgets work?</summary><p>The CLI can attach a token-protected daily budget to its wallet. It is a safety rail for compatible clients, not a substitute for wallet policy or limiting the funds available to an agent.</p></details>
          <details><summary>Where is the API documentation?</summary><p>Start with the <a href="/skill.md" style="text-decoration:underline">agent skill</a>, inspect <a href="/api" style="text-decoration:underline">API metadata</a>, or read the complete README and source on GitHub.</p></details>
        </div>
      </div>
    </section>

    <section class="cta">
      <div class="shell">
        <div class="eyebrow">All agents aboard</div>
        <h2>Turn your API into an economy.</h2>
        <p>Start on testnet, prove the flow, and let software pay software.</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#quickstart">Protect an API <span aria-hidden="true">→</span></a>
          <a class="button button-secondary" href="${demoHref}">${demoLabel}</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="shell">
      <div class="footer-grid">
        <div>
          <a class="brand" href="/">${logoSvg()}<span>loopfare</span></a>
          <p class="footer-copy">Usage-based payments for APIs and AI agents, powered by x402 and Base.</p>
        </div>
        <div><h3>Product</h3><div class="footer-links"><a href="#product">Features</a><a href="#how">How it works</a><a href="${demoHref}">Demo</a></div></div>
        <div><h3>Developers</h3><div class="footer-links"><a href="#quickstart">Quickstart</a><a href="/skill.md">Agent skill</a><a href="/api">API metadata</a></div></div>
        <div><h3>Open source</h3><div class="footer-links"><a href="${githubUrl}">GitHub</a><a href="${githubUrl}/issues">Issues</a><a href="${githubUrl}/blob/main/LICENSE">MIT license</a></div></div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getUTCFullYear()} Loopfare. Built for an agentic web.</span>
        <span class="live" id="live-status"><i></i><span>Checking service health…</span></span>
      </div>
    </div>
  </footer>
  <script>
    document.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        var target = document.getElementById(button.getAttribute('data-copy'));
        if (!target || !navigator.clipboard) return;
        navigator.clipboard.writeText(target.innerText).then(function () {
          var before = button.textContent;
          button.textContent = 'Copied';
          window.setTimeout(function () { button.textContent = before; }, 1500);
        });
      });
    });
    fetch('/health').then(function (response) {
      if (!response.ok) throw new Error('unhealthy');
      return response.json();
    }).then(function () {
      var status = document.getElementById('live-status');
      status.classList.add('ok');
      status.querySelector('span').textContent = 'All systems operational';
    }).catch(function () {
      document.querySelector('#live-status span').textContent = 'Service status unavailable';
    });
  </script>
</body>
</html>`;
}

export function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#17151f"/><path d="M18 20h18a10 10 0 0 1 0 20H23" fill="none" stroke="#c8ff68" stroke-width="6" stroke-linecap="round"/><path d="m25 32-9 8 9 8" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function logoSvg() {
  return `<svg aria-hidden="true" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#17151f"/><path d="M18 20h18a10 10 0 0 1 0 20H23" fill="none" stroke="#c8ff68" stroke-width="6" stroke-linecap="round"/><path d="m25 32-9 8 9 8" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function escapeHtml(input: string) {
  return input.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character]!;
  });
}
