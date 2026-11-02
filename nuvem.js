// Backup automático dos apps do Lek no GitHub privado (repo lexvndre-port, pasta backups/).
// Cada backup vira um commit, então o histórico inteiro fica guardado.
(function(){
  const REPO = "lexvndre/lexvndre-port";
  const MIN_INTERVALO = 10 * 60 * 1000;
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch(e){ return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch(e){} },
    del: k => { try { localStorage.removeItem(k); } catch(e){} },
    chaves: () => { try { return Object.keys(localStorage); } catch(e){ return []; } },
  };

  // O que cada app guarda neste celular
  const APPS = {
    volt: {
      nome: "VOLT", arq: "backups/volt.json",
      ler: () => ls.get("volt_v3"),
      validar: t => { const d = JSON.parse(t); return d && d.v === 3; },
      gravar: t => ls.set("volt_v3", t),
      copia: () => { const a = ls.get("volt_v3"); if (a) ls.set("volt_v3_antes_de_restaurar", a); },
    },
    rf52: {
      nome: "RF52", arq: "backups/rf52.json",
      ler: () => {
        const ks = ls.chaves().filter(k => k.startsWith("runlog_") && k !== "runlog_antes_de_restaurar").sort();
        if (!ks.some(k => /^runlog_v\d/.test(k))) return null;
        const o = {}; ks.forEach(k => o[k] = ls.get(k));
        return JSON.stringify({ app: "rf52", chaves: o });
      },
      validar: t => { const d = JSON.parse(t); return d && d.app === "rf52" && d.chaves; },
      gravar: t => { const d = JSON.parse(t); Object.entries(d.chaves).forEach(([k, v]) => { if (k.startsWith("runlog_") && typeof v === "string") ls.set(k, v); }); },
      copia: () => { const a = APPS.rf52.ler(); if (a) ls.set("runlog_antes_de_restaurar", a); },
    },
  };

  const token = () => ls.get("lek-gh-token");
  const cab = () => ({ "Authorization": "Bearer " + token(), "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  const api = arq => `https://api.github.com/repos/${REPO}/contents/${arq}`;
  const k = (app, campo) => `lek-nuvem-${app}-${campo}`;

  function b64(texto){
    const bytes = new TextEncoder().encode(texto); let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function shaAtual(arq){
    const r = await fetch(api(arq) + "?t=" + Date.now(), { headers: cab(), cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("github " + r.status);
    return (await r.json()).sha;
  }

  // modo: "manual" (sempre), "fundo" (se mudou, 1 min de folga), "auto" (se mudou, 10 min de folga)
  async function enviarApp(id, modo){
    const A = APPS[id], dados = A.ler();
    if (!dados) return { ok: true, motivo: "sem dados" };
    const ultimo = +(ls.get(k(id, "quando")) || 0);
    const folga = modo === "fundo" ? 60 * 1000 : MIN_INTERVALO;
    if (modo !== "manual" && (dados === ls.get(k(id, "ultimo")) || Date.now() - ultimo < folga)) return { ok: true, motivo: "em dia" };
    for (let tentativa = 0; tentativa < 2; tentativa++){
      const sha = (tentativa === 0 && ls.get(k(id, "sha"))) || await shaAtual(A.arq);
      const corpo = { message: `backup ${A.nome} ` + new Date().toISOString().slice(0, 16), content: b64(dados) };
      if (sha) corpo.sha = sha;
      const r = await fetch(api(A.arq), { method: "PUT", headers: cab(), body: JSON.stringify(corpo) });
      if (r.ok){
        const j = await r.json();
        ls.set(k(id, "sha"), j.content.sha); ls.set(k(id, "ultimo"), dados); ls.set(k(id, "quando"), String(Date.now()));
        return { ok: true };
      }
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error("chave recusada pelo GitHub"), { chave: true });
      if (r.status !== 409 && r.status !== 422) throw new Error("github " + r.status);
      ls.del(k(id, "sha"));
    }
    throw new Error("conflito");
  }
  let enviando = false;
  async function enviar(modo){
    if (!token()) return { ok: false, motivo: "sem chave" };
    if (enviando) return { ok: false, motivo: "ocupado" };
    enviando = true;
    try {
      for (const id of Object.keys(APPS)) await enviarApp(id, modo);
      ls.del("lek-nuvem-erro");
      return { ok: true };
    } catch(e){
      ls.set("lek-nuvem-erro", e.chave ? "chave recusada pelo GitHub" : "sem internet ou GitHub fora");
      return { ok: false, motivo: e.message };
    } finally { enviando = false; }
  }

  async function restaurar(id){
    const A = APPS[id];
    const r = await fetch(api(A.arq) + "?t=" + Date.now(), { headers: { ...cab(), "Accept": "application/vnd.github.raw+json" }, cache: "no-store" });
    if (r.status === 404) throw new Error(`Ainda não tem backup do ${A.nome} no GitHub.`);
    if (!r.ok) throw new Error("GitHub respondeu " + r.status);
    const texto = await r.text();
    if (!A.validar(texto)) throw new Error("Backup em formato estranho, não restaurei.");
    A.copia(); A.gravar(texto); ls.set(k(id, "ultimo"), A.ler() || texto);
    return true;
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
  // Arquivos que o bot grava no repositório privado bot-lek (feed.json, clima.json)
  async function lerBot(nome){
    const r = await fetch(`https://api.github.com/repos/lexvndre/bot-lek/contents/${nome}?t=` + Date.now(),
      { headers: { ...cab(), "Accept": "application/vnd.github.raw+json" }, cache: "no-store" });
    if (r.status === 401) throw new Error("A chave do GitHub foi recusada.");
    if (r.status === 404) throw new Error("A chave não tem acesso ao bot-lek, ou o bot ainda não gerou esse dado.");
    if (!r.ok) throw new Error("GitHub respondeu " + r.status + ".");
    return r.json();
  }
  const lerFeed = () => lerBot("feed.json");

  window.LekNuvem = {
    token, enviar, restaurar, testar, lerFeed, lerBot,
    salvarToken: t => { ls.set("lek-gh-token", t); ls.del("lek-nuvem-erro"); },
    tirarToken: () => ls.del("lek-gh-token"),
    estado: () => {
      const q = Object.keys(APPS).map(id => +(ls.get(k(id, "quando")) || 0));
      return { ligado: !!token(), quando: Math.max(0, ...q), erro: ls.get("lek-nuvem-erro") };
    },
  };

  // Pede pro navegador não apagar os dados sozinho
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch(e){}
  // Automático: confere a cada 2 min e quando o app vai pro fundo
  setTimeout(() => enviar("auto"), 5000);
  setInterval(() => enviar("auto"), 2 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) enviar("fundo"); });
})();
