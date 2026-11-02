// Tranca do app do Lek: o conteúdo fica criptografado (AES-GCM) e só abre com a senha.
(function(){
  const S = document.currentScript, BLOB = S.dataset.blob, SALT = S.dataset.salt, IT = 600000;
  const $ = id => document.getElementById(id);
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const ub64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
  let dados = fetch(BLOB).then(r => { if (!r.ok) throw new Error("http " + r.status); return r.arrayBuffer(); });

  async function chaveDaSenha(senha){
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2", salt:b64(SALT), iterations:IT, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, true, ["decrypt"]);
  }
  async function abrir(chave){
    const buf = await dados;
    const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv:new Uint8Array(buf, 0, 12)}, chave, new Uint8Array(buf, 12));
    return new TextDecoder().decode(pt);
  }
  function mostrar(html){ document.open(); document.write(html); document.close(); }
  function msg(t){ const m = $("msg"); if (m) m.textContent = t; }

  async function inicio(){
    let salva = null;
    try { salva = localStorage.getItem("lek-chave"); } catch(e){}
    if (salva){
      try {
        const k = await crypto.subtle.importKey("raw", b64(salva), "AES-GCM", false, ["decrypt"]);
        return mostrar(await abrir(k));
      } catch(e){
        if (String(e).includes("http")) { msg("Sem internet. Tenta de novo daqui a pouco."); return; }
        try { localStorage.removeItem("lek-chave"); } catch(_){}
      }
    }
    $("abrindo").hidden = true; $("form").hidden = false; $("senha").focus();
    $("form").onsubmit = async ev => {
      ev.preventDefault();
      const btn = $("entrar"); btn.disabled = true; msg("Abrindo…");
      try {
        const k = await chaveDaSenha($("senha").value.trim());
        const html = await abrir(k);
        try { if ($("lembrar").checked) localStorage.setItem("lek-chave", ub64(await crypto.subtle.exportKey("raw", k))); } catch(_){}
        mostrar(html);
      } catch(e){
        btn.disabled = false;
        msg(String(e).includes("http") ? "Sem internet. Tenta de novo." : "Senha errada.");
      }
    };
  }
  inicio();
})();
