/* OmniSpectra v112 - Levantamento integrado ao Projetista. Sem Service Worker. */
(function () {
  'use strict';
  const originalView = window.electricalView;
  const originalOpenPlan = window.omniDesignerOpenPlan;
  const bucket = 'omni-projetista';
  const state = { planId: null, editingRoom: null, busy: false };

  function planById(id) {
    return (omniMgmt.projetistaPlantas || []).find(p => Number(p.id) === Number(id));
  }
  function surveyOf(plan) {
    return (plan && plan.dados && plan.dados.levantamento) || null;
  }
  function numberOf(value) {
    return Number(String(value === undefined || value === null ? '' : value).trim().replace(',', '.'));
  }
  function format(n) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
  function errorMessage(err) { return (err && err.message) || String(err || 'Erro desconhecido'); }
  function btn(label, action, cls) {
    return '<button class="' + (cls || 'ghost') + '" onclick="' + action + '">' + label + '</button>';
  }
  function roomShape(room) {
    let points = Array.isArray(room.vertices_m) && room.vertices_m.length >= 3
      ? room.vertices_m.map(p => ({ x: Number(p.x), y: Number(p.y) }))
      : [{x:0,y:0},{x:Number(room.largura_m),y:0},{x:Number(room.largura_m),y:Number(room.comprimento_m)},{x:0,y:Number(room.comprimento_m)}];
    const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
    const maxX = Math.max(...points.map(p => p.x)), maxY = Math.max(...points.map(p => p.y));
    return { points: points.map(p => ({x:p.x-minX,y:p.y-minY})), width:maxX-minX, height:maxY-minY };
  }
  function roomMetrics(points) {
    let area = 0, perimeter = 0;
    points.forEach((p,i) => {
      const n = points[(i+1)%points.length];
      area += p.x*n.y-n.x*p.y;
      perimeter += Math.hypot(n.x-p.x,n.y-p.y);
    });
    return { area: Math.abs(area)/2, perimeter };
  }
  function parseVertices(raw) {
    if (!raw.trim()) return null;
    const pts = raw.split(';').map(pair => {
      const n = pair.trim().split(/\s+/).map(numberOf);
      if (n.length !== 2 || n.some(v => !Number.isFinite(v))) throw Error('Use os vértices no formato: 0 0; 4 0; 4 2; 0 2');
      return {x:n[0],y:n[1]};
    });
    if (pts.length < 3 || pts.length > 40) throw Error('Informe entre 3 e 40 vértices.');
    const b = roomShape({vertices_m:pts}), m = roomMetrics(b.points);
    if (m.area < 0.1 || b.width > 100 || b.height > 100) throw Error('Confira os vértices: área mínima 0,1 m² e dimensão máxima 100 m.');
    return b.points;
  }
  function buildLayout(rooms) {
    const pad = 0.8, gap = 0.6;
    const shapes = rooms.map(r => roomShape(r));
    const total = shapes.reduce((a,s) => a+s.width*s.height,0);
    const widest = Math.max(...shapes.map(s => s.width), 4);
    const limit = Math.max(widest+2*pad,Math.sqrt(total)*1.6+2*pad,7);
    let x=pad,y=pad,rowHeight=0,maxX=0;
    const placed = rooms.map((r,i) => {
      const shape=shapes[i];
      if (x>pad && x+shape.width+pad>limit) {x=pad;y+=rowHeight+gap;rowHeight=0;}
      const points=shape.points.map(q => ({x:q.x+x,y:q.y+y}));
      maxX=Math.max(maxX,x+shape.width);rowHeight=Math.max(rowHeight,shape.height);
      x+=shape.width+gap;
      return {room:r,points};
    });
    const needW=Math.max(6,maxX+pad), needH=Math.max(4,y+rowHeight+pad);
    const sheetWidth=Math.max(needW,needH*4/3);
    const sheetHeight=sheetWidth*3/4;
    const walls=[], ambientRows=[];
    placed.forEach(({room,points}) => {
      const m=roomMetrics(points);
      const normalized=points.map(q => ({x:q.x/sheetWidth,y:q.y/sheetHeight}));
      normalized.forEach((p,i) => {
        const next=normalized[(i+1)%normalized.length];
        const raw=points[i],rawNext=points[(i+1)%points.length];
        walls.push({x1:p.x,y1:p.y,x2:next.x,y2:next.y,
          comprimento_m:Math.hypot(rawNext.x-raw.x,rawNext.y-raw.y),
          espessura_m:Number(room.espessura_m)||0.15});
      });
      ambientRows.push({nome:room.nome,area_m2:m.area,perimetro_m:m.perimeter,geometria:normalized,
        dados:{origem:'levantamento',levantamento_ambiente_id:room.id,forma:room.vertices_m?'livre':'retangular',
          largura_m:room.largura_m,comprimento_m:room.comprimento_m,observacoes:room.nota||''}});
    });
    return {config:{largura_m:sheetWidth,altura_m:sheetHeight,espessura_m:0.15,pe_direito_m:2.7},
      walls,rooms:ambientRows};
  }
  window.omniSurveyBuildLayout = buildLayout;

  async function saveSurvey(plan, next) {
    if (state.busy) return false;
    state.busy=true;
    try {
      if (!await omniEnsureFreshSession()) return false;
      const dados=Object.assign({},plan.dados||{},{levantamento:next});
      const result=await db.from('projetista_plantas')
        .update({dados,atualizado_em:new Date().toISOString()}).eq('id',plan.id).select().single();
      if (result.error) throw result.error;
      plan.dados=result.data.dados;
      return true;
    } catch (e) {
      alert('Não foi possível salvar o levantamento: '+errorMessage(e));
      return false;
    } finally {state.busy=false;}
  }
  function projectPanel() {
    const drafts=(omniMgmt.projetistaPlantas||[]).filter(p=>+p.projetista_id===+omniDesignerProjectId&&surveyOf(p)&&surveyOf(p).fase==='rascunho');
    return '<section class="panel surveyIntro"><span class="eyebrow">LEVANTAMENTO</span><h3>Do imóvel à planta editável</h3>'
      +'<p class="hint">Fotos, vídeo/varredura ou entrada manual → confirmar medidas → gerar planta → continuar no Projetista existente.</p>'
      +'<div class="surveyIntroActions">'+btn('＋ Iniciar levantamento','omniSurveyNew()','primary')
      +(drafts.length?'<span class="surveyBadge">'+drafts.length+' em andamento</span>':'')+'</div>'
      +'<p class="surveyCaution">As imagens servem como referência. Nesta versão as medidas devem ser conferidas manualmente; a câmera ainda não mede nem reconstrói as paredes sozinha.</p></section>';
  }
  if (typeof originalView === 'function') {
    window.electricalView=function() {
      let html=originalView();
      if (!omniDesignerProjectId) return html;
      html=html.replace('<div class="panel"><h3>Planta-base',projectPanel()+'<div class="panel"><h3>Planta-base');
      (omniMgmt.projetistaPlantas||[]).filter(p=>surveyOf(p)&&surveyOf(p).fase==='rascunho').forEach(p=>{
        html=html.replace('onclick="omniDesignerOpenPlan('+p.id+')">Editar planta',
          'onclick="omniDesignerOpenPlan('+p.id+')">Continuar levantamento');
      });
      return html;
    };
  }
  if (typeof originalOpenPlan === 'function') {
    window.omniDesignerOpenPlan=async function(id) {
      const p=planById(id);
      if (p && surveyOf(p) && surveyOf(p).fase==='rascunho') {
        state.planId=+id;state.editingRoom=null;renderSurvey();return;
      }
      return originalOpenPlan(id);
    };
  }
  window.omniSurveyNew=async function() {
    if (!omniDesignerProjectId || state.busy || !await omniEnsureFreshSession()) return;
    const name=prompt('Nome da planta ou pavimento:','Térreo');
    if (!name || !name.trim()) return;
    state.busy=true;
    try {
      const result=await db.from('projetista_plantas').insert({
        projetista_id:omniDesignerProjectId,nome:name.trim(),pavimento:name.trim(),
        mime_type:'application/x-omni-plan',
        dados:{paredes:[],config:{largura_m:20,altura_m:15,espessura_m:0.15,pe_direito_m:2.7},
          levantamento:{versao:1,fase:'rascunho',etapa:'captura',metodo:'fotos',ambientes:[],midias:[],criado_em:new Date().toISOString()}}
      }).select().single();
      if (result.error) throw result.error;
      await omniRefreshManagement();
      state.planId=result.data.id;
      state.editingRoom=null;
      renderSurvey();
    } catch(e){alert('Não foi possível iniciar o levantamento: '+errorMessage(e));}
    finally{state.busy=false;}
  };
  window.omniSurveyOpen=function(id){state.planId=+id;state.editingRoom=null;renderSurvey();};
  window.omniSurveyBack=function(){state.planId=null;state.editingRoom=null;window.onkeydown=null;render();};
  window.omniSurveyMethod=async function(method) {
    const p=planById(state.planId),s=surveyOf(p);
    if (!p || !s || s.fase!=='rascunho' || !['fotos','video','manual'].includes(method)) return;
    if (await saveSurvey(p,{...s,metodo:method,etapa:'captura'})) renderSurvey();
  };
  window.omniSurveyReview=async function() {
    const p=planById(state.planId),s=surveyOf(p);
    if (!p || !s || s.fase!=='rascunho') return;
    if (!s.ambientes.length) return alert('Cadastre pelo menos um ambiente com as medidas conferidas.');
    if (await saveSurvey(p,{...s,etapa:'revisao'})) renderSurvey();
  };
  window.omniSurveyEditMeasures=async function() {
    const p=planById(state.planId),s=surveyOf(p);
    if (p && s && s.fase==='rascunho' && await saveSurvey(p,{...s,etapa:'captura'})) renderSurvey();
  };
  function mediaOptions(s) {
    return '<option value="">Imóvel inteiro / sem ambiente</option>'+s.ambientes.map(r=>
      '<option value="'+esc(r.id)+'">'+esc(r.nome)+'</option>').join('');
  }
  function mediaSection(s) {
    const source=s.metodo;
    const help=source==='fotos'?'Fotografe cada parede, portas e cantos. Você pode selecionar várias fotos da galeria.':
      source==='video'?'Grave uma passagem contínua pelo ambiente, mostrando os encontros das paredes. Vídeos não são convertidos automaticamente em medidas.':
      'Comece pelas medidas dos ambientes. As fotos e os vídeos podem ser anexados depois como referência.';
    const choose=source==='video'?
      '<label class="primary surveyFileBtn">🎥 Gravar vídeo<input hidden type="file" accept="video/*" capture="environment" onchange="omniSurveyUploadFiles(this)"></label>'
      +'<label class="ghost surveyFileBtn">Anexar vídeo<input hidden type="file" accept="video/*" multiple onchange="omniSurveyUploadFiles(this)"></label>':
      '<label class="primary surveyFileBtn">📷 Tirar foto<input hidden type="file" accept="image/*" capture="environment" onchange="omniSurveyUploadFiles(this)"></label>'
      +'<label class="ghost surveyFileBtn">Selecionar fotos<input hidden type="file" accept="image/*" multiple onchange="omniSurveyUploadFiles(this)"></label>';
    const items=s.midias||[];
    return '<section class="panel surveyMedia"><h3>2. Fotos e vídeo do levantamento</h3><p class="hint">'+help+'</p>'
      +(s.fase==='rascunho'?'<div class="field"><label>Relacionar arquivos ao ambiente (opcional)</label><select id="omniSurveyMediaRoom">'+mediaOptions(s)+'</select></div>'
      +'<div class="surveyActions">'+choose+'</div>':'')
      +'<p class="hint">Fotos até 15 MB; vídeos até 40 MB por arquivo. Armazenamento privado da equipe no Supabase.</p>'
      +'<div class="surveyMediaList">'+(items.length?items.map(m=>{
        const room=(s.ambientes||[]).find(r=>r.id===m.ambiente_id);
        const ix=items.indexOf(m);
        return '<div class="surveyMediaItem"><span>'+(m.tipo==='video'?'🎥':'📷')+'</span><div class="grow"><b>'+esc(m.nome)+'</b>'
          +'<small>'+esc(room?room.nome:'Referência geral')+'</small></div>'
          +btn('Visualizar','omniSurveyViewMedia('+ix+')')
          +(s.fase==='rascunho'?btn('Remover','omniSurveyRemoveMedia('+ix+')','ghost surveyDanger'):'')+'</div>';
      }).join(''):'<p class="hint">Nenhum arquivo anexado ainda.</p>')+'</div></section>';
  }
  window.omniSurveyUploadFiles=async function(input) {
    const p=planById(state.planId),current=surveyOf(p);
    if (!p || !current || current.fase!=='rascunho' || state.busy) return;
    const files=Array.from(input.files||[]);
    if (!files.length || !await omniEnsureFreshSession()) return;
    const roomSelect=document.getElementById('omniSurveyMediaRoom');
    const roomId=roomSelect&&roomSelect.value||null;
    for (const file of files) {
      const isVideo=file.type.startsWith('video/'),isImage=file.type.startsWith('image/');
      if (!isVideo && !isImage) {alert('Formato não aceito: '+file.name);continue;}
      if (file.size > (isVideo?40:15)*1024*1024) {alert('Arquivo maior que o limite: '+file.name);continue;}
      const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'-').slice(-100);
      const path=omniDesignerProjectId+'/levantamentos/'+p.id+'/'+Date.now()+'-'+Math.random().toString(36).slice(2)+'-'+safe;
      state.busy=true;
      try {
        const upload=await db.storage.from(bucket).upload(path,file,{contentType:file.type,upsert:false});
        if (upload.error) throw upload.error;
        const s=surveyOf(p);
        const media={id:Date.now()+'-'+Math.random().toString(36).slice(2),nome:file.name,path,
          tipo:isVideo?'video':'foto',mime:file.type,ambiente_id:roomId,criado_em:new Date().toISOString()};
        const updated={...s,midias:[...(s.midias||[]),media]};
        state.busy=false;
        if (!await saveSurvey(p,updated)) {
          await db.storage.from(bucket).remove([path]);
          break;
        }
      } catch(e) {
        alert('Falha ao enviar '+file.name+': '+errorMessage(e));break;
      } finally {state.busy=false;}
    }
    input.value='';
    renderSurvey();
  };
  window.omniSurveyViewMedia=async function(index) {
    const p=planById(state.planId),s=surveyOf(p),m=s&&(s.midias||[])[index];
    if (!m || !await omniEnsureFreshSession()) return;
    const tab=window.open('about:blank','_blank');
    const result=await db.storage.from(bucket).createSignedUrl(m.path,300);
    if (result.error) {if(tab)tab.close();return alert(errorMessage(result.error));}
    if (tab) tab.location.href=result.data.signedUrl;
    else alert('Permita abrir novas abas para visualizar o arquivo.');
  };
  window.omniSurveyRemoveMedia=async function(index) {
    const p=planById(state.planId),s=surveyOf(p),m=s&&(s.midias||[])[index];
    if (!m || s.fase!=='rascunho' || !confirm('Remover este arquivo do levantamento?')) return;
    const updated={...s,midias:s.midias.filter((_,i)=>i!==index)};
    if (!await saveSurvey(p,updated)) return;
    const deletion=await db.storage.from(bucket).remove([m.path]);
    if (deletion.error) alert('Referência removida, mas o arquivo não pôde ser excluído do Storage: '+errorMessage(deletion.error));
    renderSurvey();
  };
  window.omniSurveyEditRoom=function(id) {
    const p=planById(state.planId),s=surveyOf(p),r=s&&(s.ambientes||[]).find(a=>a.id===id);
    if (!r) return;
    state.editingRoom=id;
    document.getElementById('omniSurveyRoomName').value=r.nome;
    document.getElementById('omniSurveyRoomWidth').value=r.largura_m;
    document.getElementById('omniSurveyRoomHeight').value=r.comprimento_m;
    document.getElementById('omniSurveyRoomThickness').value=r.espessura_m||0.15;
    document.getElementById('omniSurveyRoomVertices').value=(r.vertices_m||[]).map(q=>format(q.x)+' '+format(q.y)).join('; ');
    document.getElementById('omniSurveyRoomNote').value=r.nota||'';
    document.getElementById('omniSurveyRoomSubmit').textContent='Salvar alterações';
    document.getElementById('omniSurveyRoomName').focus();
  };
  window.omniSurveyCancelEdit=function(){state.editingRoom=null;renderSurvey();};
  window.omniSurveySaveRoom=async function() {
    const p=planById(state.planId),s=surveyOf(p);
    if (!p || !s || s.fase!=='rascunho') return;
    const nome=document.getElementById('omniSurveyRoomName').value.trim(),
      width=numberOf(document.getElementById('omniSurveyRoomWidth').value),
      height=numberOf(document.getElementById('omniSurveyRoomHeight').value),
      thickness=numberOf(document.getElementById('omniSurveyRoomThickness').value),
      raw=document.getElementById('omniSurveyRoomVertices').value,
      nota=document.getElementById('omniSurveyRoomNote').value.trim();
    if (!nome) return alert('Informe o nome do ambiente.');
    if (!Number.isFinite(thickness) || thickness<=0 || thickness>1) return alert('Espessura de parede inválida (ex.: 0,15 m).');
    let vertices=null,dims={width,height};
    try {
      vertices=parseVertices(raw);
      if (vertices) {const shape=roomShape({vertices_m:vertices});dims={width:shape.width,height:shape.height};}
    } catch(e){return alert(e.message);}
    if (![dims.width,dims.height].every(v=>Number.isFinite(v)&&v>0&&v<=100)) return alert('Confira largura e comprimento em metros (maiores que zero, até 100 m).');
    const rooms=[...s.ambientes];
    const existing=rooms.findIndex(r=>r.id===state.editingRoom);
    const id=existing>=0?state.editingRoom:Date.now()+'-'+Math.random().toString(36).slice(2);
    const room={id,nome,largura_m:dims.width,comprimento_m:dims.height,espessura_m:thickness,nota};
    if (vertices) room.vertices_m=vertices;
    if (existing>=0) rooms[existing]=room;else rooms.push(room);
    if (await saveSurvey(p,{...s,ambientes:rooms,etapa:'captura'})) {state.editingRoom=null;renderSurvey();}
  };
  window.omniSurveyDeleteRoom=async function(id) {
    const p=planById(state.planId),s=surveyOf(p);
    if (!p || !s || s.fase!=='rascunho' || !confirm('Remover este ambiente do levantamento?')) return;
    const rooms=s.ambientes.filter(r=>r.id!==id),midias=(s.midias||[]).map(m=>m.ambiente_id===id?{...m,ambiente_id:null}:m);
    if (await saveSurvey(p,{...s,ambientes:rooms,midias,etapa:'captura'})) renderSurvey();
  };
  function roomsTable(s,editable) {
    if (!s.ambientes.length) return '<p class="hint">Adicione os cômodos e informe suas medidas.</p>';
    return '<div class="surveyRoomList">'+s.ambientes.map(r=>{
      const shape=roomShape(r),metrics=roomMetrics(shape.points);
      return '<article class="surveyRoomRow"><div class="grow"><b>'+esc(r.nome)+'</b><small>'
        +format(shape.width)+' × '+format(shape.height)+' m · '+format(metrics.area)+' m² · perímetro '+format(metrics.perimeter)+' m'
        +(r.vertices_m?' · forma irregular':'')+'</small>'+(r.nota?'<small>'+esc(r.nota)+'</small>':'')+'</div>'
        +(editable?btn('Editar',"omniSurveyEditRoom('"+r.id+"')")+btn('Remover',"omniSurveyDeleteRoom('"+r.id+"')",'ghost surveyDanger'):'')+'</article>';
    }).join('')+'</div>';
  }
  function preview(s) {
    if (!s.ambientes.length) return '';
    const layout=buildLayout(s.ambientes);
    const svg=layout.rooms.map(r=>{
      const points=r.geometria.map(p=>(p.x*1000).toFixed(1)+','+(p.y*750).toFixed(1)).join(' ');
      const cx=r.geometria.reduce((a,p)=>a+p.x,0)/r.geometria.length*1000;
      const cy=r.geometria.reduce((a,p)=>a+p.y,0)/r.geometria.length*750;
      return '<polygon points="'+points+'" fill="#e2f3fa" stroke="#17364c" stroke-width="3"></polygon>'
        +'<text x="'+cx.toFixed(1)+'" y="'+cy.toFixed(1)+'" text-anchor="middle" fill="#163243" font-size="16">'
        +esc(r.nome)+'</text>';
    }).join('');
    return '<div class="surveyPreview"><svg viewBox="0 0 1000 750" role="img" aria-label="Prévia provisória da planta gerada a partir das medidas">'
      +svg+'</svg></div><p class="surveyCaution">Distribuição provisória: a posição entre cômodos não é inferida pelas imagens. Ajuste os encontros de paredes, portas e circulação no Projetista.</p>';
  }
  function renderSurvey() {
    const p=planById(state.planId),s=surveyOf(p);
    if (!p || !s) {render();return;}
    window.onkeydown=null;
    const generated=s.fase==='gerado',review=s.etapa==='revisao'||generated;
    const step=generated?4:review?3:2;
    const tabs=[['fotos','📷 Fotos'],['video','🎥 Vídeo / varredura'],['manual','📐 Manual']];
    const header='<div class="surveyHeader"><span class="eyebrow">OMNISPECTRA · PROJETISTA</span><h1>Levantamento · '+esc(p.nome)+'</h1>'
      +'<p>Registre o imóvel, confira as medidas e gere a base para o editor técnico.</p>'
      +'<div class="surveySteps">'+['Origem','Ambientes','Revisar medidas','Projetista'].map((x,i)=>
        '<span class="'+(i<step?'done ':'')+(i+1===step?'current':'')+'">'+(i+1)+'. '+x+'</span>').join('')+'</div></div>';
    const methodPanel='<section class="panel"><h3>1. Forma de levantamento</h3><div class="surveyModes">'+tabs.map(t=>
      '<button class="surveyMode '+(s.metodo===t[0]?'active':'')+'" '+(generated?'disabled':'')+
      ' onclick="omniSurveyMethod(\''+t[0]+'\')">'+t[1]+'</button>').join('')+'</div>'
      +'<p class="hint">É possível combinar fotos, vídeos e medidas manuais no mesmo levantamento.</p></section>';
    const roomsPanel='<section class="panel"><h3>3. Ambientes e medidas</h3>'
      +(generated?'':review?'':roomsTable(s,true))
      +(generated||review?'':'<div class="surveyForm"><div class="field"><label>Nome do cômodo</label><input id="omniSurveyRoomName" placeholder="Ex.: Sala de estar"></div>'
        +'<div class="surveyGrid"><div class="field"><label>Largura (m)</label><input id="omniSurveyRoomWidth" inputmode="decimal" placeholder="4,20"></div>'
        +'<div class="field"><label>Comprimento (m)</label><input id="omniSurveyRoomHeight" inputmode="decimal" placeholder="5,30"></div>'
        +'<div class="field"><label>Espessura da parede (m)</label><input id="omniSurveyRoomThickness" inputmode="decimal" value="0,15"></div></div>'
        +'<div class="field"><label>Formato irregular (opcional): vértices em metros</label><textarea id="omniSurveyRoomVertices" rows="2" placeholder="0 0; 4 0; 4 2; 3 2; 3 4; 0 4"></textarea>'
        +'<small class="hint">Se houver recortes, informe os cantos no sentido do contorno. Sem vértices, será criado um retângulo.</small></div>'
        +'<div class="field"><label>Observações / relação com outros ambientes</label><input id="omniSurveyRoomNote" placeholder="Ex.: ao lado da cozinha; porta na parede direita"></div>'
        +'<div class="surveyActions">'+btn('＋ Adicionar ambiente','omniSurveySaveRoom()','primary')
        +btn('Cancelar edição','omniSurveyCancelEdit()')+'</div></div>');
    const reviewPanel='<section class="panel"><h3>'+ (generated?'Planta gerada':'4. Revisar medidas') +'</h3>'
      +roomsTable(s,false)+preview(s)
      +'<div class="surveyActions">'+(!generated?btn('← Ajustar medidas','omniSurveyEditMeasures()'):'')
      +(generated?btn('Abrir no Projetista','omniDesignerOpenPlan('+p.id+')','primary'):
          btn('✓ Confirmar e gerar planta','omniSurveyGenerate()','primary'))+'</div></section>';
    document.getElementById('app').innerHTML='<main class="wrap surveyPage">'
      +'<div class="surveyTop">'+btn('← Voltar ao projeto','omniSurveyBack()')+'</div>'+header
      +methodPanel
      +(!review && !generated?mediaSection(s)+roomsPanel+
        '<div class="surveyActions surveyNext">'+btn('Revisar medidas →','omniSurveyReview()','primary')+'</div>':
        mediaSection(s)+reviewPanel)
      +'</main>';
  }
  window.omniSurveyGenerate=async function() {
    const p=planById(state.planId),s=surveyOf(p);
    if (!p || !s || s.fase!=='rascunho' || state.busy) return;
    if (!s.ambientes.length) return alert('Cadastre ao menos um cômodo.');
    if (!confirm('Gerar a planta preliminar com os ambientes cadastrados? Você poderá posicionar cômodos, editar paredes e portas no Projetista.')) return;
    if (!await omniEnsureFreshSession()) return;
    state.busy=true;
    try {
      const exists=await Promise.all([
        db.from('projetista_ambientes').select('id').eq('planta_id',p.id).limit(1),
        db.from('projetista_elementos').select('id').eq('planta_id',p.id).limit(1)
      ]);
      if (exists.some(r=>r.error)) throw (exists.find(r=>r.error).error);
      if (exists.some(r=>(r.data||[]).length)) throw Error('Esta planta já tem ambientes ou pontos. A geração não vai sobrescrever o projeto existente.');
      const layout=buildLayout(s.ambientes);
      const oldData=p.dados||{};
      const updated={...oldData,paredes:layout.walls,config:layout.config,
        levantamento:{...s,fase:'gerado',etapa:'concluido',gerado_em:new Date().toISOString()}};
      const changed=await db.from('projetista_plantas')
        .update({dados:updated,atualizado_em:new Date().toISOString()}).eq('id',p.id).select().single();
      if (changed.error) throw changed.error;
      const created=await db.from('projetista_ambientes').insert(
        layout.rooms.map(r=>({...r,planta_id:p.id}))).select();
      if (created.error) {
        const undo=await db.from('projetista_plantas').update({dados:oldData}).eq('id',p.id);
        if (undo.error) throw Error('Falha ao gerar ambientes e também ao restaurar rascunho: '+errorMessage(undo.error));
        throw created.error;
      }
      p.dados=changed.data.dados;
      await omniRefreshManagement();
      state.planId=null;state.editingRoom=null;
      await originalOpenPlan(p.id);
    } catch(e) {alert('Não foi possível gerar a planta: '+errorMessage(e));}
    finally{state.busy=false;}
  };
})();