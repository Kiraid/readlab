// Sidebar "simulated cluster" panel for the Ingress simulator (from the ch12 reference).
(function () {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  window.HUD = function (el) {
    if (!el) return;
    function render() {
      const S = SIM.state();
      const ctrl = !SIM.controllerInstalled() ? ['off', 'not installed'] : SIM.controllerReady() ? ['on', 'ready'] : ['warm', 'starting…'];
      const ings = Object.values(S.ingresses).sort((a, b) => a.created - b.created);
      el.innerHTML = `
        <div class="hud-h">simulated cluster <button class="hud-open" title="Open the drop-down shell (\` key)">›_ shell</button></div>
        <div class="hud-row"><span class="dot ${ctrl[0]}"></span>ingress-nginx <em>${ctrl[1]}</em></div>
        <div class="hud-sub">Ingresses</div>
        ${ings.length ? ings.map((i) => `<div class="hud-ing"><span class="dot ${SIM.ingAddress(i) ? 'on' : 'off'}"></span><code>${esc(i.name)}</code><em>${esc(i.cls || 'no class')}</em></div>`).join('') : '<div class="hud-none">none yet</div>'}
        <div class="hud-sub">extras</div>
        <div class="hud-tags">${[S.pods.fun404 ? 'fun404' : null, ...Object.keys(S.secrets).map((s) => '🔑 ' + s), S.hosts.length ? '/etc/hosts ✓' : null].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('') || '<span class="hud-none">—</span>'}</div>`;
      el.querySelector('.hud-open').onclick = () => window.APP && window.APP.toggleDock(true);
    }
    render();
    SIM.on(render);
    setInterval(render, 2000);
  };
})();
