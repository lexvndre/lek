// Backup automático do VOLT no GitHub privado do Lek (repo lexvndre-port, arquivo backups/volt.json).
// Cada backup vira um commit, então o histórico inteiro fica guardado.
(function(){
  const REPO = "lexvndre/lexvndre-port", ARQ = "backups/volt.json", CHAVE = "volt_v3";
  const API = `https://api.github.com/repos/${REPO}/contents/${ARQ}`;
  const MIN_INTERVALO = 10 * 60 * 1000;
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch(e){ return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch(e){} },
    del: k => { try { localStorage.removeItem(k); } catch(e){} },
  };
  const token = () => ls.get("lek-gh-token");
  const cab = () => ({ "Authorization": "Bearer " + token(), "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });

  function b64(texto){
    const bytes = new TextEncoder().encode(texto); let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function shaAtual(){
    const r = await fetch(API + "?t=" + Date.now(), { headers: cab(), cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("github " + r.status);
    return (await r.json()).sha;
  }
  let enviando = false;
  // modo: "manual" (sempre), "fundo" (se mudou, 1 min de folga), "auto" (se mudou, 10 min de folga)
  async function enviar(modo){
    if (!token() || enviando) return { ok: false, motivo: token() ? "ocupado" : "sem token" };
    const dados = ls.get(CHAVE);
    if (!dados) return { ok: false, motivo: "sem treinos ainda" };
    const ultimo = +(ls.get("lek-nuvem-quando") || 0);
    const folga = modo === "fundo" ? 60 * 1000 : MIN_INTERVALO;
    if (modo !== "manual" && (dados === ls.get("lek-nuvem-ultimo") || Date.now() - ultimo < folga)) return { ok: true, motivo: "em dia" };
    enviando = true;
    try {
      for (let tentativa = 0; tentativa < 2; tentativa++){
        const sha = tentativa === 0 && ls.get("lek-nuvem-sha") || await shaAtual();
        const corpo = { message: "backup VOLT " + new Date().toISOString().slice(0, 16), content: b64(dados) };
        if (sha) corpo.sha = sha;
        const r = await fetch(API, { method: "PUT", headers: cab(), body: JSON.stringify(corpo) });
        if (r.ok){
          const j = await r.json();
          ls.set("lek-nuvem-sha", j.content.sha); ls.set("lek-nuvem-ultimo", dados); ls.set("lek-nuvem-quando", String(Date.now()));
          ls.del("lek-nuvem-erro");
          return { ok: true };
        }
        if (r.status === 401 || r.status === 403){ ls.set("lek-nuvem-erro", "chave recusada pelo GitHub"); return { ok: false, motivo: "chave recusada" }; }
        if (r.status !== 409 && r.status !== 422) throw new Error("github " + r.status);
        ls.del("lek-nuvem-sha");
      }
      throw new Error("conflito");
    } catch(e){
      ls.set("lek-nuvem-erro", "sem internet ou GitHub fora"); return { ok: false, motivo: String(e) };
    } finally { enviando = false; }
  }
  async function baixar(){
    const r = await fetch(API + "?t=" + Date.now(), { headers: { ...cab(), "Accept": "application/vnd.github.raw+json" }, cache: "no-store" });
    if (r.status === 404) throw new Error("Ainda não tem backup no GitHub.");
    if (!r.ok) throw new Error("GitHub respondeu " + r.status);
    const texto = await r.text(), d = JSON.parse(texto);
    if (!d || d.v !== 3) throw new Error("Backup em formato estranho, não restaurei.");
    return texto;
  }
  async function restaurar(){
    const texto = await baixar();
    const atual = ls.get(CHAVE);
    if (atual && atual !== texto) ls.set("volt_v3_antes_de_restaurar", atual);
    ls.set(CHAVE, texto); ls.set("lek-nuvem-ultimo", texto);
    return JSON.parse(texto);
  }
  async function acesso(t, repo, gravar){
    const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { "Authorization": "Bearer " + t, "Accept": "application/vnd.github+json" } });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j.permissions && (gravar ? j.permissions.push : j.permissions.pull));
  }
  async function testar(t){
    const [backup, bot] = await Promise.all([acesso(t, REPO, true), acesso(t, "lexvndre/bot-lek", false)]);
    return { backup, bot };
  }
  // Avisos do bot (feed.json do repositório bot-lek, que pode ser privado)
  async function lerFeed(){
    const r = await fetch("https://api.github.com/repos/lexvndre/bot-lek/contents/feed.json?t=" + Date.now(),
      { headers: { ...cab(), "Accept": "application/vnd.github.raw+json" }, cache: "no-store" });
    if (r.status === 401) throw new Error("A chave do GitHub foi recusada.");
    if (r.status === 404) throw new Error("A chave não tem acesso ao bot-lek.");
    if (!r.ok) throw new Error("GitHub respondeu " + r.status + ".");
    return r.json();
  }

  window.LekNuvem = {
    token, enviar, restaurar, testar, lerFeed,
    salvarToken: t => { ls.set("lek-gh-token", t); ls.del("lek-nuvem-erro"); },
    tirarToken: () => ls.del("lek-gh-token"),
    estado: () => ({ ligado: !!token(), quando: +(ls.get("lek-nuvem-quando") || 0), erro: ls.get("lek-nuvem-erro") }),
  };

  // Pede pro navegador não apagar os dados sozinho
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch(e){}
  // Automático: confere a cada 2 min e quando o app vai pro fundo
  setTimeout(() => enviar("auto"), 5000);
  setInterval(() => enviar("auto"), 2 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) enviar("fundo"); });
})();
