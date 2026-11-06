// Sidebar "simulated cluster" panel for chapter 13: what exists right now in the shared SIM state.
(function () {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const nsPrefix = (ns) => (ns && ns !== 'kiada' ? ns + '/' : '');

  window.HUD = function (el) {
    if (!el) return;
    function render() {
      const S = SIM.state();
      let cv;
      try { cv = SIM.view(); } catch (e) { console.error(e); return; }

      const crd = SIM.crdsInstalled() ? ['on', 'experimental ✓'] : ['off', 'not installed'];
      const istiod = !SIM.controllerInstalled() ? ['off', 'not installed'] : SIM.controllerReady() ? ['on', 'ready'] : ['warm', 'starting…'];

      const gws = cv.gwList.map((gv) => {
        const dot = gv.programmed ? 'on' : gv.managed ? 'warm' : 'off';
        const chips = gv.listeners.map((l) => `<span>${esc(l.protocol.toLowerCase())}:${esc(l.port)}</span>`).join('');
        return `<div class="hud-ing" title="${esc(gv.g.ns + '/' + gv.g.name)}"><span class="dot ${dot}"></span><code>${esc(nsPrefix(gv.g.ns) + gv.g.name)}</code><em>${gv.programmed ? esc(gv.g.ip) : 'not programmed'}</em></div>`
          + (chips ? `<div class="hud-tags" style="margin:0 0 3px 15px">${chips}</div>` : '');
      }).join('');

      const routes = cv.routeList.map((rv) => {
        let dot = 'off', style = '', note = 'no status';
        if (rv.hasStatus) {
          const ok = rv.parents.some((p) => p.accepted);
          dot = ok ? 'on' : 'off';
          if (!ok) { style = ' style="background:#ff8a80"'; note = rv.parents[0].reason; }
          else note = rv.resolved.ok ? 'accepted' : rv.resolved.reason;
          if (ok && !rv.resolved.ok) style = ' style="background:#ffb454"';
        }
        return `<div class="hud-ing" title="${esc(rv.r.kind + ' ' + rv.r.ns + '/' + rv.r.name)}"><span class="dot ${dot}"${style}></span><code>${esc(rv.r.kind.toLowerCase())}/${esc(nsPrefix(rv.r.ns) + rv.r.name)}</code><em>${esc(note)}</em></div>`;
      }).join('');

      const extras = [];
      if (S.pods['kiada/kiada-new']) extras.push('kiada-new');
      if (S.pods['kiada/test']) extras.push('test pod');
      const labels = (S.namespaces.kiada && S.namespaces.kiada.labels) || {};
      for (const [k, v] of Object.entries(labels)) extras.push(`ns kiada: ${k}=${v}`);
      const grants = Object.keys(S.grants).length;
      if (grants) extras.push(`${grants} ReferenceGrant${grants > 1 ? 's' : ''}`);
      if (S.istioctl && !S.istio) extras.push('istioctl ✓');
      if (S.hosts.length) extras.push('/etc/hosts ✓');

      el.innerHTML = `
        <div class="hud-h">simulated cluster <button class="hud-open" title="Open the drop-down shell (\` key)">›_ shell</button></div>
        <div class="hud-row"><span class="dot ${crd[0]}"></span>Gateway API CRDs <em>${crd[1]}</em></div>
        <div class="hud-row"><span class="dot ${istiod[0]}"></span>istiod <em>${istiod[1]}</em></div>
        <div class="hud-sub">Gateways</div>
        ${gws || '<div class="hud-none">none yet</div>'}
        <div class="hud-sub">Routes</div>
        ${routes || '<div class="hud-none">none yet</div>'}
        <div class="hud-sub">extras</div>
        <div class="hud-tags">${extras.map((t) => `<span>${esc(t)}</span>`).join('') || '<span class="hud-none">—</span>'}</div>`;
      const open = el.querySelector('.hud-open');
      if (open) open.onclick = () => window.APP && window.APP.toggleDock(true);
    }
    render();
    SIM.on(render);
    setInterval(render, 2000);
  };
})();
