// SPDX-License-Identifier: GPL-3.0-or-later
// User-owned Markdown memory. This view never executes note HTML or links.
(function (g) {
  "use strict";
  const esc = (s) => String(s ?? "");
  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = esc(text);
    if (cls) n.className = cls;
    return n;
  }
  function decodeReference(blob) {
    let expired=false,timer;
    return new Promise((resolve,reject)=>{
      timer=setTimeout(()=>{expired=true;reject(Error("Image decode timed out."));},15000);
      Promise.resolve().then(()=>createImageBitmap(blob)).then(bitmap=>{
        clearTimeout(timer);if(expired){bitmap.close();return;}resolve(bitmap);
      },error=>{clearTimeout(timer);if(!expired)reject(error);});
    });
  }
  function markdown(root, text, open) {
    root.replaceChildren();
    let code = false,
      pre = null,
      paragraph = [];
    const flush = () => {
      if (paragraph.length) {
        root.append(el("p", paragraph.join("\n")));
        paragraph = [];
      }
    };
    for (const line of String(text).split("\n")) {
      if (/^```/.test(line)) {
        flush();
        code = !code;
        if (code) {
          pre = el("pre");
          root.append(pre);
        }
        continue;
      }
      if (code) {
        pre.textContent += line + "\n";
        continue;
      }
      if (!line.trim()) {
        flush();
        continue;
      }
      let m = line.match(/^(#{1,6})\s+(.*)/);
      if (m) {
        flush();
        root.append(el("h" + Math.min(4, m[1].length), m[2]));
        continue;
      }
      m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
      if (m) {
        flush();
        root.append(el("p", "• " + m[1], "ev-bullet"));
        continue;
      }
      paragraph.push(line);
    }
    flush();
    // Only explicit local wiki references become actionable controls.
    const walker = document.createTreeWalker(root, 4);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const node of texts) {
      if (node.parentElement.closest("pre")) continue;
      const parts = node.textContent.split(/(\[\[[^\]]+\]\])/g);
      if (parts.length === 1) continue;
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (p.startsWith("[[")) {
          const [target, label] = p.slice(2, -2).split("|");
          const b = el("button", label || target, "ev-wikilink");
          b.type = "button";
          b.onclick = () => open(target.split("#")[0]);
          frag.append(b);
        } else frag.append(document.createTextNode(p));
      }
      node.replaceWith(frag);
    }
  }
  const css = `.ev{--ev-border:var(--elio-line,#514b40);--ev-panel:var(--elio-surface,#302c25);color:var(--elio-text,#e4ddcf);font:14px/1.6 system-ui;min-height:70vh}.ev *{box-sizing:border-box}.ev button,.ev input,.ev select,.ev textarea{font:inherit;color:inherit;border:1px solid var(--ev-border);border-radius:9px;background:var(--ev-panel);padding:8px 12px}.ev input[type=checkbox]{accent-color:var(--elio-muted,#b8ac96)}.ev button{cursor:pointer}.ev button:hover,.ev button:focus-visible{border-color:var(--elio-muted,#b8ac96)}.ev button:disabled{opacity:.5;cursor:default}.ev [hidden]{display:none!important}.ev-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}.ev-head h1{margin:0;font:600 28px Georgia,serif}.ev-head p{margin:3px 0;color:var(--elio-muted,#bbb09c)}.ev-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ev-shell{display:grid;grid-template-columns:240px minmax(0,1fr);border:1px solid var(--ev-border);border-radius:16px;min-height:65vh;overflow:hidden}.ev-side{padding:16px;background:color-mix(in srgb,var(--ev-panel) 60%,transparent);border-right:1px solid var(--ev-border)}.ev-side input{width:100%;margin:8px 0 12px}.ev-tree{max-height:60vh;overflow:auto}.ev-tree details{margin:10px 0}.ev-tree summary{cursor:pointer;color:var(--elio-muted,#bbb09c);font-size:12px;letter-spacing:.06em}.ev-tree button{display:block;width:100%;text-align:left;margin:4px 0;background:transparent;border-color:transparent;padding:8px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ev-tree button[aria-current=true]{background:color-mix(in srgb,var(--elio-muted,#b8ac96) 20%,transparent);border-color:var(--ev-border)}.ev-main{min-width:0;padding:24px 30px}.ev-tabs{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}.ev-tabs button[aria-pressed=true]{background:color-mix(in srgb,var(--elio-muted,#b8ac96) 24%,transparent)}.ev-note h2{font:600 32px Georgia,serif;margin:8px 0 18px}.ev-meta{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 24px}.ev-chip{font-size:12px;padding:3px 9px;border:1px solid var(--ev-border);border-radius:20px}.ev-chip[data-status=stale]{color:#d9b67c}.ev-prose{max-width:850px;overflow-wrap:anywhere}.ev-prose p{white-space:pre-wrap;margin:0 0 16px}.ev-prose pre{white-space:pre-wrap;background:var(--ev-panel);padding:16px;border-radius:10px}.ev-prose h2,.ev-prose h3{font:600 23px Georgia,serif;margin:24px 0 12px}.ev-wikilink{border:0!important;background:transparent!important;padding:0!important;text-decoration:underline;color:var(--elio-muted,#b8ac96)!important}.ev-source{margin:24px 0;padding:14px 16px;border-left:3px solid var(--elio-muted,#b8ac96);background:color-mix(in srgb,var(--ev-panel) 60%,transparent);white-space:pre-wrap;overflow-wrap:anywhere}.ev-editor{display:grid;gap:12px}.ev-editor label{display:grid;gap:4px;font-size:12px;color:var(--elio-muted,#bbb09c)}.ev-editor textarea{width:100%;min-height:260px;resize:vertical;line-height:1.7}.ev-editor [data-props]{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ev-status{min-height:24px;margin:12px 0;white-space:pre-wrap}.ev-status[data-error=true]{color:var(--elio-error-text,#e3b6ae)}.ev-empty{padding:48px 16px;text-align:center}.ev-empty h2{font:28px Georgia,serif}.ev-muted{color:var(--elio-muted,#bbb09c);font-size:12px}.ev-links{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.ev-graph{position:relative;border:1px solid var(--ev-border);border-radius:12px;background:radial-gradient(ellipse at center,color-mix(in srgb,var(--elio-muted,#b8ac96) 8%,transparent),transparent 75%);overflow:hidden}.ev-graph svg{display:block;width:100%;height:480px;touch-action:none;cursor:grab}.ev-graph text{fill:var(--elio-text,#e4ddcf);font:12px system-ui;paint-order:stroke;stroke:var(--elio-canvas,#24221d);stroke-width:3px;pointer-events:none}.ev-graph line{stroke:var(--elio-muted,#b8ac96);stroke-opacity:.3}.ev-graph circle{stroke:var(--elio-canvas,#24221d);stroke-width:3px;cursor:pointer}.ev-graph circle:hover{filter:drop-shadow(0 0 5px currentColor)}.ev-graph circle:focus-visible{stroke:var(--elio-text,#eee);stroke-width:5px;outline:none}.ev-graph .ev-legend{padding:12px;display:flex;gap:16px;flex-wrap:wrap;border-top:1px solid var(--ev-border)}.ev-history{border-left:2px solid var(--ev-border);padding:12px 18px;margin:14px 0}.ev-history pre{white-space:pre-wrap;max-height:250px;overflow:auto}.ev-kicker{text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:var(--elio-muted,#bbb09c)}@media(max-width:850px){.ev-shell{grid-template-columns:180px minmax(0,1fr)}.ev-main{padding:18px}.ev-head{align-items:flex-start;flex-direction:column}.ev-editor [data-props]{grid-template-columns:1fr}}@media(max-width:550px){.ev-shell{display:block}.ev-side{border-right:0;border-bottom:1px solid var(--ev-border)}.ev-tree{max-height:180px}.ev-main{padding:16px}.ev-graph svg{height:350px}}`;
  function mount(root, request, options = {}) {
    root.classList.add("ev");
    root.setAttribute("data-i18n-user-content", "");
    root.innerHTML = `<style>${css}</style><header class="ev-head"><div><div class="ev-kicker">Elio • project memory</div><h1>Memory, with connections.</h1><p>A quiet place for everything worth remembering.</p></div><div class="ev-controls"><select data-project aria-label="Project"></select><label><input type="checkbox" data-auto> Auto memory</label><button data-active-project>Active project</button><button data-project-new>New project</button><button data-refresh>↻ Refresh</button></div></header><div class="ev-shell"><aside class="ev-side"><div class="ev-controls"><button data-new>＋ New note</button></div><input data-search type="search" placeholder="Find a memory…" aria-label="Search project memory"><div data-count class="ev-muted"></div><div class="ev-tree" data-tree></div><hr><button data-import>Import old notes</button><button data-import-file>Import file</button><input type="file" data-file accept=".md,.markdown,.json" hidden><button data-export>Export</button><button data-location>Vault location</button><button data-obsidian>Obsidian snapshot</button></aside><main class="ev-main"><nav class="ev-tabs" aria-label="Memory views"><button data-view="notes">Notes</button><button data-view="graph">Connections</button><button data-view="context">Agent context</button><button data-view="audit">Review memory</button></nav><div data-content></div></main></div><p class="ev-status" data-status role="status" aria-live="polite"></p>`;
    const q = (s) => root.querySelector("[data-" + s + "]");
    let scope = "",
      notes = [],
      active = null,
      view = "notes",
      dirty = false,
      busy = false,
      alive = true,
      follow = true,
      searchTimer,
      generation = 0,
      searchGeneration = 0,
      searchMatches = null,
      version = "",
      polling = false;
    const status = (s, error = false) => {
      q("status").textContent = s;
      q("status").dataset.error = String(error);
    };
    async function call(action, params = {}) {
      const r = await request({ ...params, action, scope });
      if (!r || r.ok === false)
        throw Error(r?.error || "Memory request failed");
      return r;
    }
    function discard() {
      return !dirty || g.confirm("Discard unsaved note changes?");
    }
    function label(s) {
      return s.startsWith("project:")
        ? s.slice(8)
        : s.startsWith("chat:")
          ? "Unassigned chat · " + s.slice(-10)
          : s;
    }
    async function init() {
      try {
        const context = (await options.context?.()) || {};
        scope = context.scope || "project:Personal";
        const projects = await request({ action: "projects" });
        const all = [...new Set([scope, ...(projects.projects || [])])];
        q("project").replaceChildren(
          ...all.map((s) => {
            const o = el("option", label(s));
            o.value = s;
            return o;
          }),
        );
        q("project").value = scope;
        await refresh();
      } catch (e) {
        status(e.message, true);
      }
    }
    async function refresh() {
      const gen = ++generation;
      try {
        if (follow && !dirty) {
          const context = await options.context?.();
          if (context?.scope && context.scope !== scope) {
            scope = context.scope;
            active = null;
            if (![...q("project").options].some((o) => o.value === scope)) {
              const option = el("option", label(scope));
              option.value = scope;
              q("project").append(option);
            }
            q("project").value = scope;
          }
        }
        let next = [],
          offset = 0;
        do {
          const r = await call("list", {
            limit: 100,
            offset,
            include_archived: true,
          });
          if (!alive || gen !== generation) return;
          next.push(...r.notes);
          offset = r.next_offset;
        } while (offset !== null);
        notes = next;
        const state = await call("state");
        if (gen !== generation) return;
        version = state.version;
        q("auto").checked = state.automatic === true;
        await updateSearch(false);
        renderTree();
        if (!dirty) {
          if (active) {
            const r = await call("read", { id: active.id });
            if (gen !== generation) return;
            active = r.note;
          }
          await render();
        }
        status(
          notes.length
            ? "Memory is up to date."
            : "No notes yet. Create one or import your saved notes.",
        );
      } catch (e) {
        if (gen === generation) status(e.message, true);
      }
    }
    async function poll() {
      if (polling || !alive || dirty || busy) return;
      polling = true;
      try {
        const state = await call("state");
        q("auto").checked = state.automatic === true;
        if (state.version !== version) await refresh();
      } catch (e) {
        status(e.message, true);
      } finally {
        polling = false;
      }
    }
    async function updateSearch(redraw = true) {
      const query = q("search").value.trim(),
        token = ++searchGeneration,
        selected = scope;
      if (!query) {
        searchMatches = null;
      } else {
        const found = new Set();
        let offset = 0;
        do {
          const r = await call("search", {
            query,
            limit: 100,
            offset,
            include_archived: true,
          });
          if (token !== searchGeneration || selected !== scope) return;
          for (const n of r.notes) found.add(n.id);
          offset = r.next_offset;
        } while (offset !== null);
        searchMatches = found;
      }
      if (redraw) {
        renderTree();
        if (view !== "notes" && !dirty) await render();
      }
    }
    function renderTree() {
      q("tree").replaceChildren();
      const filtered = searchMatches
        ? notes.filter((n) => searchMatches.has(n.id))
        : notes;
      q("count").textContent =
        filtered.length + " / " + notes.length + " notes";
      const groups = new Map();
      for (const n of filtered) {
        const key = n.status === "archived" ? "Archive" : n.category;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
      }
      for (const [name, list] of [...groups].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        const d = el("details");
        d.open = name !== "Archive";
        d.append(el("summary", name + " · " + list.length));
        for (const n of list) {
          const b = el("button", (n.pinned ? "✧ " : "") + n.title);
          b.type = "button";
          b.setAttribute("aria-current", String(active?.id === n.id));
          b.title = n.title;
          b.onclick = () => open(n.id);
          d.append(b);
        }
        q("tree").append(d);
      }
    }
    async function open(id) {
      if (!discard()) return;
      const selected = scope,
        gen = generation;
      try {
        const candidates = notes.filter(
          (n) =>
            n.id === id ||
            n.title.toLocaleLowerCase() === String(id).toLocaleLowerCase() ||
            (n.aliases || []).some(
              (a) => a.toLocaleLowerCase() === String(id).toLocaleLowerCase(),
            ),
        );
        let n = candidates.length === 1 ? candidates[0] : null;
        if (!n) {
          status(
            "Linked note not found, archived, or title is ambiguous.",
            true,
          );
          return;
        }
        const r = await call("read", { id: n.id });
        if (selected !== scope || gen !== generation) return;
        active = r.note;
        dirty = false;
        view = "notes";
        renderTree();
        await render(r);
      } catch (e) {
        status(e.message, true);
      }
    }
    function button(text, fn) {
      const b = el("button", text);
      b.type = "button";
      b.onclick = fn;
      return b;
    }
    function chips(n) {
      const box = el("div", undefined, "ev-meta");
      for (const text of [
        n.status,
        n.category,
        ...n.tags.map((s) => "#" + s),
      ]) {
        const x = el("span", text, "ev-chip");
        x.dataset.status = n.status;
        box.append(x);
      }
      return box;
    }
    async function render(data) {
      const gen = generation,
        selected = scope;
      const fresh = () => gen === generation && selected === scope;
      q("content").replaceChildren();
      root
        .querySelectorAll("[data-view]")
        .forEach((b) =>
          b.setAttribute("aria-pressed", String(b.dataset.view === view)),
        );
      if (view === "graph") return graph();
      if(view==="audit"){
        const selected=scope,gen=generation,r=await call("audit");if(!alive||scope!==selected||generation!==gen||view!=="audit")return;
        q("content").append(el("h2","Memory review"),el("p","Evidence is recorded, not magically proven. Check the actual project before verifying a fact. Changed dependencies need fresh fingerprints from read-only checks.","ev-muted"));
        for(const item of r.items){const row=el("section",undefined,"ev-source");row.append(button(item.note.title,()=>open(item.note.id)),el("p",item.reasons.join(" · ")));q("content").append(row);}
        if(!r.items.length)q("content").append(el("p","No notes currently due for review. This is not proof that every fact is still correct."));return;
      }
      if (view === "context") {
        const r = await call("context", {
          query: q("search").value,
          budget: 6000,
        });
        if (!fresh() || view !== "context") return;
        const h = el("h2", "What the agent recalls");
        q("content").append(
          h,
          el(
            "p",
            "A bounded context capsule, not the entire vault. Search to change the topic. Stale notes are excluded; unreviewed notes remain labelled.",
            "ev-muted",
          ),
        );
        for (const n of r.context) {
          const box = el("section", undefined, "ev-source");
          box.append(
            button(n.title, () => open(n.id)),
            el("p", n.text),
            el("small", n.reason + " · " + n.status),
          );
          q("content").append(box);
        }
        q("content").append(
          el(
            "p",
            r.characters +
              " / " +
              r.budget +
              " characters · local retrieval · no AI API",
            "ev-muted",
          ),
        );
        return;
      }
      if (!active) {
        const box = el("div", undefined, "ev-empty");
        box.append(
          el("div", "✧", "ev-kicker"),
          el("h2", "Small notes. A bigger picture."),
          el(
            "p",
            "Decisions, conventions and lessons — linked, searchable, yours.",
          ),
          button("Create your first note", () => edit(null)),
        );
        q("content").append(box);
        return;
      }
      const n = active,
        box = el("article", undefined, "ev-note");
      box.append(
        el("div", n.category + " / " + n.title, "ev-kicker"),
        el("h2", n.title),
        chips(n),
      );
      const toolbar = el("div", undefined, "ev-controls");
      toolbar.append(
        button("Edit note", () => edit(n)),
        button("History", () => history(n)),
        button(n.status === "archived" ? "Restore" : "Archive", () =>
          save({
            ...n,
            status: n.status === "archived" ? "unreviewed" : "archived",
          }),
        ),
      );
      toolbar.append(
        button("Delete", async () => {
          if (
            !g.confirm(
              "Permanently delete this note and its saved history? This cannot be undone.",
            )
          )
            return;
          try {
            await call("manual-delete", {
              id: n.id,
              revision: n.revision,
              etag: n.etag,
            });
            active = null;
            await refresh();
            status("Note deleted. Existing links to it are now unresolved.");
          } catch (e) {
            status(e.message, true);
          }
        }),
      );
      toolbar.append(button("Mark stale",()=>save({...n,status:"stale"})),button("Record verification",async()=>{
        const evidence=g.prompt("Fresh evidence from your actual check (not a guess):","");if(!evidence?.trim())return;
        const selected=scope,gen=generation;try{const r=await call("manual-verify",{id:n.id,revision:n.revision,etag:n.etag,source:n.source||"User verification",evidence:[evidence.trim()]});if(!alive||scope!==selected||generation!==gen||active?.id!==n.id)return;active=r.note;await refresh();status("Verification recorded. Evidence was supplied by you, not independently checked by Elio.");}catch(e){if(alive&&scope===selected)status(e.message,true);}
      }));
      const imageInput=el("input");imageInput.type="file";imageInput.accept="image/png,image/jpeg,image/webp";imageInput.hidden=true;
      toolbar.append(button("Add reference image",()=>imageInput.click()),imageInput);
      imageInput.onchange=async()=>{const file=imageInput.files?.[0];imageInput.value="";if(!file)return;const selected=scope,gen=generation;let bitmap;
        try{if(file.size>8*1024*1024||!/^image\/(png|jpeg|webp)$/.test(file.type))throw Error("Choose PNG/JPEG/WebP up to 8 MB.");bitmap=await decodeReference(file);if(!alive||selected!==scope||gen!==generation)return;const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=el("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null;
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));if(!blob||blob.size>1000000)throw Error("Normalized PNG exceeds 1 MB; resize the image first.");const raw=new Uint8Array(await blob.arrayBuffer()),png_hex=Array.from(raw,b=>b.toString(16).padStart(2,"0")).join("");if(!alive||selected!==scope||gen!==generation)return;
          const added=await call("image_add",{png_hex,manual:true});if(!alive||selected!==scope||gen!==generation)return;
          if(!await save({...n,reference_images:[...new Set([...(n.reference_images||[]),added.image_id])]}))return;status("Reference saved locally. It is not automatically sent to the AI.");
        }catch(e){if(alive&&scope===selected)status(e.message,true);}finally{bitmap?.close();}};
      box.append(toolbar);
      const prose = el("div", undefined, "ev-prose");
      markdown(prose, n.text, open);
      box.append(prose);
      if(n.reference_images?.length){
        const gallery=el("section",undefined,"ev-controls");
        for(const image_id of n.reference_images){
          const item=el("div");let shown=false;
          const show=button("Show reference · "+image_id.slice(0,8),async()=>{
            if(shown||show.disabled)return;show.disabled=true;const selected=scope,gen=generation;
            try{
              const r=await call("image_read",{image_id});
              if(!alive||scope!==selected||generation!==gen||active?.id!==n.id||view!=="notes")return;
              const raw=Uint8Array.from(r.png_hex.match(/../g),x=>parseInt(x,16));
              const bitmap=await decodeReference(new Blob([raw],{type:"image/png"}));
              try{
                if(!alive||scope!==selected||generation!==gen||active?.id!==n.id||view!=="notes")return;
                const canvas=el("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;
                canvas.style.cssText="max-width:100%;height:auto;border-radius:12px";
                canvas.setAttribute("aria-label","Local project reference image");
                canvas.getContext("2d").drawImage(bitmap,0,0);item.append(canvas);shown=true;show.textContent="Reference loaded";
              }finally{bitmap.close();}
            }catch(e){if(alive&&scope===selected)status(e.message,true);}
            finally{if(!shown)show.disabled=false;}
          });item.append(show);gallery.append(item);
        }box.append(gallery);
      }

      const source = el("div", undefined, "ev-source");
      source.append(
        el("strong", "Source & confidence"),
        el(
          "p",
          (n.source || "No source recorded") + "\n" + n.evidence.join("\n"),
        ),
        el("small", "Revision " + n.revision + " · " + n.updated),
      );
      box.append(source);
      const links = data || (await call("read", { id: n.id }));
      if (!fresh() || view !== "notes" || active?.id !== n.id) return;
      if (links.unresolved_links?.length)
        box.append(
          el(
            "p",
            "Unresolved or ambiguous links: " +
              links.unresolved_links.join(", "),
            "ev-source",
          ),
        );
      const refs = el("div", undefined, "ev-links");
      refs.append(el("span", "Backlinks · ", "ev-muted"));
      for (const id of links.backlinks || []) {
        const target = notes.find((x) => x.id === id);
        if (target) refs.append(button(target.title, () => open(id)));
      }
      if (!(links.backlinks || []).length)
        refs.append(el("span", "No incoming links yet.", "ev-muted"));
      box.append(refs);
      q("content").append(box);
    }
    function edit(n) {
      if (!n && !discard()) return;
      const host = q("content");
      host.replaceChildren();
      const form = el("form", undefined, "ev-editor"),
        fields = {};
      const field = (key, title, value, area = false) => {
        const l = el("label", title),
          i = el(area ? "textarea" : "input");
        i.value = value || "";
        i.setAttribute("aria-label", title);
        i.oninput = () => {
          dirty = true;
        };
        fields[key] = i;
        l.append(i);
        return l;
      };
      form.append(field("title", "Title", n?.title));
      const props = el("div");
      props.dataset.props = "";
      props.append(
        field("category", "Folder / category", n?.category || "Knowledge"),
        field("tags", "Tags, comma separated", n?.tags.join(", ")),
        field(
          "source",
          "Source (message, file, test result)",
          n?.source || "Added by you",
        ),
        field(
          "evidence",
          "Evidence, one source per line",
          n?.evidence.join("\n"),
          true,
        ),
      );
      form.append(props);
      const stat = el("label", "Confidence"),
        select = el("select");
      select.setAttribute("aria-label", "Confidence");
      for (const s of ["unreviewed", "verified", "stale", "archived"]) {
        const o = el("option", s);
        o.value = s;
        select.append(o);
      }
      select.value = n?.status || "unreviewed";
      select.onchange = () => {
        dirty = true;
      };
      stat.append(select);
      form.append(
        stat,
        field(
          "text",
          "Markdown · use [[Note title]] or [[id|label]] for links",
          n?.text,
          true,
        ),
      );
      const controls = el("div", undefined, "ev-controls"),
        submit = el("button", "Save note");
      submit.type = "submit";
      controls.append(
        submit,
        button("Cancel", () => {
          if (discard()) {
            dirty = false;
            render();
          }
        }),
      );
      form.append(controls);
      form.onsubmit = async (e) => {
        e.preventDefault();
        submit.disabled = true;
        const ok = await save({
          ...n,
          title: fields.title.value,
          text: fields.text.value,
          category: fields.category.value,
          tags: fields.tags.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          source: fields.source.value,
          evidence: fields.evidence.value.split("\n").filter(Boolean),
          status: select.value,
        });
        submit.disabled = false;
        if (!ok) fields.text.focus();
      };
      host.append(form);
      fields.title.focus();
    }
    async function save(value) {
      if (busy) return false;
      busy = true;
      const selected = scope;
      try {
        const r = await call("manual-save", {
          ...value,
          chat: options.chat?.() || "",
        });
        if (selected !== scope) {
          status("Saved to " + label(selected) + ".");
          return true;
        }
        active = r.note;
        dirty = false;
        await refresh();
        status(r.unchanged ? "No changes." : "Saved “" + r.note.title + "”.");
        return true;
      } catch (e) {
        status(e.message, true);
        return false;
      } finally {
        busy = false;
      }
    }
    async function history(n) {
      try {
        const r = await call("history", { id: n.id });
        q("content").replaceChildren(
          button("← Back to note", () => render()),
          el("h2", "History · " + n.title),
          el(
            "p",
            "Earlier revisions are read-only. Copy text into the current note to restore deliberately.",
            "ev-muted",
          ),
        );
        if (!r.history.length)
          q("content").append(el("p", "No earlier revisions."));
        for (const row of r.history) {
          const section = el("section", undefined, "ev-history");
          section.append(
            el("strong", "Revision " + row.revision + " · " + row.updated),
            el("pre", row.text),
          );
          q("content").append(section);
        }
      } catch (e) {
        status(e.message, true);
      }
    }
    async function graph() {
      const selected = scope,
        gen = generation;
      const r = await call("graph", { query: q("search").value, limit: 500 });
      if (selected !== scope || gen !== generation || view !== "graph") return;
      const host = el("div", undefined, "ev-graph"),
        tools = el("div", undefined, "ev-controls");
      let zoom = 1,
        pan = { x: 0, y: 0 },
        drag = null;
      const ns = "http://www.w3.org/2000/svg",
        svg = document.createElementNS(ns, "svg");
      svg.setAttribute("role", "img");
      svg.setAttribute(
        "aria-label",
        "Memory connections. Each node opens a note. Use buttons or scroll to zoom.",
      );
      let isolated = false, suppressClick=false;
      const update = () =>
        svg.setAttribute(
          "viewBox",
          `${-500 / zoom + pan.x} ${-280 / zoom + pan.y} ${1000 / zoom} ${560 / zoom}`,
        );
      const scale = (f) => {
        zoom = Math.max(0.4, Math.min(4, zoom * f));
        update();
      };
      tools.append(
        button("−", () => scale(0.8)),
        button("+", () => scale(1.25)),
        button("Reset", () => {
          zoom = 1;
          pan = { x: 0, y: 0 };
          update();
        }),
        button("Grid",()=>{const on=host.dataset.grid!=="true";host.dataset.grid=String(on);host.style.backgroundImage=on?"linear-gradient(#b8ac9610 1px,transparent 1px),linear-gradient(90deg,#b8ac9610 1px,transparent 1px)":"";host.style.backgroundSize="32px 32px";}),
        button("Hide / show isolated", () => {
          isolated = !isolated;
          draw();
        }),
      );
      host.append(tools, svg);
      const categories = [...new Set(r.nodes.map((n) => n.category))].sort(),
        colors = [
          "#c5b194",
          "#a6b6a2",
          "#b7a5be",
          "#c5a194",
          "#a0b7c0",
          "#c6bb82",
        ];
      const position = new Map(),
        connected = new Set(r.edges.flatMap((e) => [e.source, e.target]));
      categories.forEach((c, k) => {
        const group = r.nodes.filter((n) => n.category === c),
          angle = (k * 2 * Math.PI) / Math.max(1, categories.length);
        group.forEach((n, i) => {
          const a = i * 2.399963,
            rad = 28 * Math.sqrt(i + 1);
          position.set(n.id, {
            x: Math.cos(angle) * 210 + Math.cos(a) * rad,
            y: Math.sin(angle) * 140 + Math.sin(a) * rad,
            color: colors[k % colors.length],
          });
        });
      });
      function draw() {
        svg.replaceChildren();
        for (const e of r.edges) {
          const a = position.get(e.source),
            b = position.get(e.target);
          if (!a || !b) continue;
          const l = document.createElementNS(ns, "line");
          for (const [k, v] of Object.entries({
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
          }))
            l.setAttribute(k, v);
          l.dataset.source=e.source;l.dataset.target=e.target;
          svg.append(l);
        }
        for (const n of r.nodes) {
          if (isolated && !connected.has(n.id)) continue;
          const p = position.get(n.id),
            c = document.createElementNS(ns, "circle");
          for (const [k, v] of Object.entries({
            cx: p.x,
            cy: p.y,
            r: connected.has(n.id) ? 7 : 5,
            fill: p.color,
            tabindex: 0,
            role: "button",
            "aria-label": n.title + " · " + n.status,
          }))
            c.setAttribute(k, v);
          const title = document.createElementNS(ns, "title");
          title.textContent = n.title + " · " + n.category + " · " + n.status;
          c.append(title);
          c.dataset.node=n.id;
          c.onclick = () => {if(suppressClick){suppressClick=false;return;}open(n.id);};
          c.onmouseenter=()=>{for(const line of svg.querySelectorAll("line")){const related=line.dataset.source===n.id||line.dataset.target===n.id;line.style.strokeOpacity=related?".9":".08";line.style.strokeWidth=related?"2":"1";}};
          c.onmouseleave=()=>{for(const line of svg.querySelectorAll("line")){line.style.strokeOpacity="";line.style.strokeWidth="";}};
          c.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open(n.id);
            }
          };
          svg.append(c);
          if (r.nodes.length < 100 || n.pinned) {
            const t = document.createElementNS(ns, "text");
            t.setAttribute("x", p.x + 12);
            t.setAttribute("y", p.y + 4);
            t.textContent =
              n.title.length > 30 ? n.title.slice(0, 29) + "…" : n.title;
            svg.append(t);
          }
        }
      }
      draw();
      update();
      svg.onwheel = (e) => {
        e.preventDefault();
        scale(e.deltaY > 0 ? 0.9 : 1.1);
      };
      svg.onpointermove = (e) => {
        if (!drag) return;
        const box = svg.getBoundingClientRect();
        if(drag.node){const point=position.get(drag.node);point.x=drag.px+((e.clientX-drag.x)*1000)/(Math.max(1,box.width)*zoom);point.y=drag.py+((e.clientY-drag.y)*560)/(Math.max(1,box.height)*zoom);suppressClick=Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>4;draw();return;}
        pan = {
          x:
            drag.px +
            ((drag.x - e.clientX) * 1000) / (Math.max(1, box.width) * zoom),
          y:
            drag.py +
            ((drag.y - e.clientY) * 560) / (Math.max(1, box.height) * zoom),
        };
        update();
      };
      svg.onpointerdown = (e) => {
        if (e.target.tagName.toLowerCase() === "circle"){const node=e.target.dataset.node,p=position.get(node);drag={node,x:e.clientX,y:e.clientY,px:p.x,py:p.y};suppressClick=false;svg.setPointerCapture?.(e.pointerId);e.preventDefault();return;}
        drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        svg.setPointerCapture?.(e.pointerId);
      };
      svg.onpointerup = () => {const node=drag?.node,moved=suppressClick;drag=null;if(node&&!moved){suppressClick=true;open(node);}};
      svg.onpointercancel=()=>{drag=null;suppressClick=true;};
      const legend = el("div", undefined, "ev-legend");
      categories.forEach((c, k) => {
        const item = el("span", "● " + c);
        item.style.color = colors[k % colors.length];
        legend.append(item);
      });
      host.append(legend);
      const broken = Object.values(r.unresolved_links || {}).flat().length;
      if (broken)
        q("content").append(
          el(
            "p",
            broken +
              " unresolved or ambiguous links. Open the source notes to repair them.",
            "ev-source",
          ),
        );
      q("content").append(
        host,
        el(
          "p",
          r.nodes.length +
            " notes · " +
            r.edges.length +
            " connections" +
            (r.truncated
              ? " · showing the first 500 matching notes; narrow your search."
              : ""),
          "ev-muted",
        ),
      );
    }
    q("active-project").onclick = async () => {
      if (!discard()) return;
      dirty = false;
      follow = true;
      await refresh();
    };
    q("new").onclick = () => edit(null);
    q("refresh").onclick = () => refresh();
    q("project").onchange = async () => {
      const next = q("project").value;
      if (!discard()) {
        q("project").value = scope;
        return;
      }
      scope = next;
      follow = false;
      active = null;
      dirty = false;
      await refresh();
    };
    q("project-new").onclick = async () => {
      if (!discard()) return;
      const name = g.prompt("Project name (notes stay local):");
      if (!name?.trim()) return;
      const next = "project:" + name.trim().slice(0, 80);
      const o = el("option", name.trim());
      o.value = next;
      q("project").append(o);
      q("project").value = next;
      scope = next;
      follow = false;
      active = null;
      dirty = false;
      try {
        await options.assign?.(name.trim().slice(0, 80));
        await refresh();
      } catch (e) {
        status(e.message, true);
      }
    };
    root.querySelectorAll("[data-view]").forEach(
      (b) =>
        (b.onclick = () => {
          if (!discard()) return;
          dirty = false;
          view = b.dataset.view;
          render().catch((e) => status(e.message, true));
        }),
    );
    q("search").oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(
        () => updateSearch().catch((e) => status(e.message, true)),
        180,
      );
    };
    q("auto").onchange = async () => {
      const enabled = q("auto").checked;
      try {
        await options.automatic?.(enabled);
        status(
          enabled
            ? "Automatic memory enabled."
            : "Automatic memory disabled. Manual edits remain available.",
        );
      } catch (e) {
        q("auto").checked = !enabled;
        status(e.message, true);
      }
    };
    q("location").onclick = async () => {
      try {
        const r = await call("location");
        status(
          "Open this folder as an Obsidian vault, or edit its Markdown files directly:\n" +
            r.path,
        );
      } catch (e) {
        status(e.message, true);
      }
    };
    q("obsidian").onclick=async()=>{if(!g.confirm("Create an independent Obsidian-compatible snapshot? Original notes stay unchanged; snapshot edits do not sync back."))return;try{const r=await call("obsidian_export");status("Obsidian snapshot: "+r.path+"\nOpen this folder as a vault in Obsidian. Original Elio memory is unchanged.");}catch(e){status(e.message,true);}};
    q("export").onclick = async () => {
      try {
        const r = await call("export");
        const blob = new Blob(
            [
              JSON.stringify(
                { format: "elio-vault/v1", scope, files: r.files },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
          url = URL.createObjectURL(blob),
          a = el("a");
        a.href = url;
        a.download = "Elio-memory-vault.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status("Exported Markdown notes. Your local vault is unchanged.");
      } catch (e) {
        status(e.message, true);
      }
    };
    q("import-file").onclick = () => q("file").click();
    q("file").onchange = async () => {
      const file = q("file").files[0];
      q("file").value = "";
      if (!file) return;
      try {
        if (file.size > 40 * 1024 * 1024) throw Error("File exceeds 40 MB");
        const text = await file.text();
        if (/\.json$/i.test(file.name)) {
          const bundle = JSON.parse(text);
          if (bundle.format !== "elio-vault/v1" || !Array.isArray(bundle.files))
            throw Error("Expected an Elio vault export");
          let count = 0,
            batch = [],
            bytes = 0;
          const send = async () => {
            if (!batch.length) return;
            const r = await call("manual-import", { files: batch });
            count += r.imported;
            batch = [];
            bytes = 0;
          };
          for (const f of bundle.files) {
            if (typeof f.content !== "string" || f.content.length > 100000)
              throw Error("Invalid Markdown file");
            if (bytes + f.content.length > 500000 || batch.length >= 50)
              await send();
            batch.push(f);
            bytes += f.content.length;
          }
          await send();
          await refresh();
          status(
            "Imported " +
              count +
              " notes. Existing conflicting notes are never overwritten.",
          );
        } else {
          await call("manual-save", {
            title: file.name.replace(/\.(?:md|markdown)$/i, "").slice(0, 160),
            text,
            source: "Imported file: " + file.name,
            category: "Imported",
            status: "unreviewed",
          });
          await refresh();
          status("Imported Markdown as an unreviewed note.");
        }
      } catch (e) {
        await refresh();
        status(e.message + " Check imported notes before retrying.", true);
      }
    };
    q("import").onclick = async () => {
      if (
        !g.confirm(
          "Copy old saved personal notes for this project into the vault? Original notes will not be deleted.",
        )
      )
        return;
      try {
        const entries = (await options.legacy?.()) || [];
        let count = 0;
        const topics = new Set(notes.map((n) => n.topic_key).filter(Boolean));
        for (const n of entries) {
          if (n.project && "project:" + n.project !== scope) continue;
          const text = String(n.text || "");
          const title = String(
            n.title || text.split("\n")[0] || "Imported note",
          ).slice(0, 120);
          // Unicode code points keep every chunk below the native UTF-8 byte limit.
          const points = Array.from(text);
          const parts = Math.max(1, Math.ceil(points.length / 12000));
          for (let part = 0; part < parts; part++) {
            const topic =
              "legacy/" + n.id + (parts > 1 ? "/" + (part + 1) : "");
            if (topics.has(topic)) continue;
            await call("manual-save", {
              title:
                title +
                (parts > 1 ? " — part " + (part + 1) + " of " + parts : ""),
              text: points.slice(part * 12000, (part + 1) * 12000).join(""),
              topic_key: topic,
              source: "Imported old memory #" + n.id,
              category: "Imported",
              status: "unreviewed",
            });
            topics.add(topic);
            count++;
          }
        }
        await refresh();
        status("Imported " + count + " notes. Originals are preserved.");
      } catch (e) {
        status(e.message, true);
      }
    };
    const before = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    g.addEventListener?.("beforeunload", before);
    init();
    return {
      refresh,
      poll,
      open,
      destroy() {
        alive = false;
        generation++;
        searchGeneration++;
        clearTimeout(searchTimer);
        g.removeEventListener?.("beforeunload", before);
      },
    };
  }
  g.elioVaultUI = { mount, markdown };
  if (typeof module !== "undefined") module.exports = g.elioVaultUI;
})(globalThis);
