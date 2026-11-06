// Tab completion for the kubectl shell plugins (moved out of the ch13 terminal).
// Loaded after a kubectl sim.js; adds SIM.complete(head, last).
(function () {
  const VERBS = ['get', 'describe', 'apply', 'delete', 'create', 'label', 'explain', 'logs', 'wait', 'config'];
  const RESOURCES = ['pods', 'svc', 'services', 'endpoints', 'endpointslices', 'secrets', 'ns', 'namespaces', 'nodes', 'crd',
    'ing', 'ingresses', 'ingressclasses', 'gtw', 'gateways', 'gatewayclasses', 'httproutes', 'tlsroutes', 'tcproutes', 'udproutes', 'grpcroutes', 'referencegrants'];
  const RES_NAMES = { gtw: 'gateways', gateway: 'gateways', gateways: 'gateways', httproutes: 'httproutes', httproute: 'httproutes', tlsroutes: 'tlsroutes',
    tcproutes: 'tcproutes', udproutes: 'udproutes', grpcroutes: 'grpcroutes', referencegrants: 'referencegrants', pods: 'pods', pod: 'pods',
    svc: 'services', service: 'services', services: 'services', ns: 'namespaces', namespaces: 'namespaces', gatewayclasses: 'gatewayclasses' };
  const COMMANDS = ['kubectl', 'curl', 'istioctl', 'nc', 'grpcurl', 'gcloud', 'export', 'for', 'cat', 'ls', 'help', 'clear', 'history', 'reset', 'catchup', 'echo'];

  window.SIM.complete = function (head, last) {
    const comp = SIM.completions();
    const files = comp.files || [];
    const names = comp.names || {};
    const cmd = head[0] === 'k' ? 'kubectl' : head[0];
    if (!head.length) return COMMANDS;
    if (cmd === 'kubectl') {
      const verb = head[1];
      const prev = head[head.length - 1];
      if (head.length === 1) return VERBS;
      if (prev === '-f') return files;
      if (['get', 'describe', 'delete', 'explain', 'label'].includes(verb) && head.length === 2) return RESOURCES;
      if (['describe', 'delete', 'get'].includes(verb) && RES_NAMES[head[2]] && head.length === 3) return names[RES_NAMES[head[2]]] || [];
      if (verb === 'logs' && head.length === 2) return names.pods || [];
      if (verb === 'apply' || verb === 'delete') return ['-f', '-k'];
      return [];
    }
    if (['cat', 'less', 'bat'].includes(cmd)) return [...files, '/etc/hosts'];
    if (cmd === 'catchup') return SIM.sections || [];
    return [];
  };
})();
