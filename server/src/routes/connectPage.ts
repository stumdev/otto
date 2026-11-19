/**
 * Página que hospeda o widget Pluggy Connect dentro da WebView do app.
 * O connectToken vem no fragmento da URL (#token=...): fragmentos não são enviados ao servidor,
 * então o token não aparece em logs. O resultado volta ao app por redirecionamentos `otto://...`
 * que a WebView intercepta.
 */
export function connectPageHtml(scriptUrl: string): string {
  const script = JSON.stringify(scriptUrl).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>Conectar banco</title>
<style>
  html,body{height:100%;margin:0;background:#000;color:#fff;font-family:system-ui,sans-serif}
  #msg{display:flex;height:100%;align-items:center;justify-content:center;font-size:15px;opacity:.7;padding:24px;text-align:center}
</style>
</head>
<body>
<div id="msg">Abrindo conexão segura…</div>
<script>
(function () {
  function go(path) { window.location.href = 'otto://' + path; }
  var params = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  var token = params.get('token');
  if (!token) { go('error?message=' + encodeURIComponent('Link de conexão inválido.')); return; }
  var s = document.createElement('script');
  s.src = ${script};
  s.onerror = function () { go('error?message=' + encodeURIComponent('Não foi possível carregar o conector de bancos. Verifique a internet.')); };
  s.onload = function () {
    try {
      var connect = new window.PluggyConnect({
        connectToken: token,
        language: 'pt',
        // a autorização do Open Finance abre fora da WebView (navegador / app do banco)
        forceOauthInBrowser: true,
        onSuccess: function (data) {
          var id = data && data.item && data.item.id;
          if (id) go('connected?itemId=' + encodeURIComponent(id));
          else go('error?message=' + encodeURIComponent('Conexão sem identificador.'));
        },
        onError: function (err) {
          var item = err && err.data && err.data.item;
          // autorização pendente no app do banco: o resultado chega depois por webhook
          if (item && item.id && item.status === 'WAITING_USER_ACTION') go('connected?pending=1&itemId=' + encodeURIComponent(item.id));
          else go('error?message=' + encodeURIComponent((err && err.message) || 'Não foi possível conectar.'));
        },
        onClose: function () { go('closed'); }
      });
      connect.init();
      document.getElementById('msg').style.display = 'none';
    } catch (e) {
      go('error?message=' + encodeURIComponent('Falha ao abrir o conector.'));
    }
  };
  document.head.appendChild(s);
})();
</script>
</body>
</html>`;
}
