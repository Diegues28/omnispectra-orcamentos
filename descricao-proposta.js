/* OmniSpectra v113 - Descrição automática da proposta por categoria e ambiente.
   Usa os itens JSONB existentes; não altera cálculos nem o Service Worker. */
(function () {
  'use strict';
  const previousQuote = window.quote;
  const previousNewQuote = window.newQuote;
  const previousRenderSelected = window.renderSelected;
  const previousSaveQuote = window.saveQuote;
  const state = {projectId:'',previousSummary:null};

  const clean = s => String(s===null||s===undefined?'':s).trim();
  const norm = s => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const count = n => Math.max(0,Math.floor(Number(n)||0));
  const plural = (n,s,p) => n===1?s:p;
  const fmt = n => Number(n).toLocaleString('pt-BR');
  const assignments = x => Array.isArray(x.omniAmbientes)?x.omniAmbientes:[];
  const isService = x => /servi[cç]o|instala[cç][aã]o|configura[cç][aã]o|m[aã]o de obra|passagem|lan[cç]amento/i
    .test((x.category||'')+' '+(x.name||''));
  function projectList() {return omniMgmt.projetistaProjetos||[];}
  function projectRooms() {
    const pid=Number(state.projectId);
    if(!pid)return [];
    const plans=(omniMgmt.projetistaPlantas||[]).filter(p=>Number(p.projetista_id)===pid);
    const results=[];
    plans.forEach(plan=>{
      (omniMgmt.projetistaAmbientes||[]).filter(r=>Number(r.planta_id)===Number(plan.id)).forEach(r=>{
        results.push({id:r.id,nome:r.nome||'Ambiente',pavimento:plan.pavimento||plan.nome||'',plantaId:plan.id});
      });
    });
    return results;
  }
  function roomLabel(room, all) {
    return all.filter(r=>norm(r.nome)===norm(room.nome)).length>1 && room.pavimento
      ?room.nome+' ('+room.pavimento+')':room.nome;
  }
  function projectField() {
    const options=projectList().map(p=>'<option value="'+Number(p.id)+'" '+(String(p.id)===String(state.projectId)?'selected':'')+'>'
      +esc(p.nome||'Projeto')+(p.cliente_nome?' · '+esc(p.cliente_nome):'')+'</option>').join('');
    return '<section class="panel omniRoomSelector"><h3>Ambientes da proposta</h3>'
      +'<p class="hint">Opcional: vincule este orçamento a um projeto do Projetista para aproveitar os cômodos já cadastrados. Você também pode digitar ambientes manualmente.</p>'
      +'<div class="field"><label>Projeto do Projetista</label><select id="omniQuoteProject" onchange="omniQuoteProjectChanged(this.value)">'
      +'<option value="">Sem projeto vinculado — informar ambientes manualmente</option>'+options+'</select></div>'
      +'<p class="hint">Depois, clique em “Ambientes” em cada equipamento para distribuir as quantidades.</p></section>';
  }
  if(typeof previousQuote==='function'){
    window.quote=function(editIndex=null){
      const html=previousQuote(editIndex);
      if(editIndex!==null){
        const saved=get(K.quotes)[editIndex],items=(saved&&saved.items)||[];
        const found=items.find(x=>x.omniProjetoId);
        state.projectId=String(found&&found.omniProjetoId||'');
      }
      return html.replace('<div id="selectedItems"></div>',projectField()+'<div id="selectedItems"></div>')
        .replace('<textarea id="qsummary" placeholder="Descreva o escopo da proposta"></textarea>',
          '<textarea id="qsummary" placeholder="Descreva o escopo da proposta"></textarea>'
          +'<div class="omniSummaryGenerator"><button class="primary" type="button" onclick="omniGenerateProposalDescription()">✦ Gerar descrição por categoria e ambiente</button>'
          +'<small class="hint">O texto será preenchido acima e poderá ser editado antes de salvar. Não altera os materiais nem os valores.</small></div>');
    };
  }
  if(typeof previousNewQuote==='function'){
    window.newQuote=function(){state.projectId='';state.previousSummary=null;return previousNewQuote();};
  }
  window.omniQuoteProjectChanged=function(id){
    state.projectId=id||'';
    (quoteItems||[]).forEach(x=>{if(!x.__auto)x.omniProjetoId=state.projectId||null;});
    window.renderSelected();
  };
  function locationListHTML(index,item) {
    const rooms=projectRooms(),allocated=assignments(item).reduce((a,v)=>a+count(v.quantidade),0),
      itemQty=count(item.qty),remaining=itemQty-allocated;
    let saved='';
    if(assignments(item).length){
      saved='<div class="omniRoomChips">'+assignments(item).map((a,j)=>'<span class="omniRoomChip">'
        +esc(a.nome)+' · '+fmt(a.quantidade)+' '
        +'<button type="button" title="Remover ambiente" onclick="omniRemoveItemRoom('+index+','+j+')">×</button></span>').join('')+'</div>';
    }
    const options=rooms.map(r=>'<option value="'+Number(r.id)+'">'+esc(roomLabel(r,rooms))+'</option>').join('');
    return '<details class="omniItemRooms"><summary>⌖ Ambientes <small>'
      +(allocated>itemQty?'⚠ Quantidades excedidas':allocated===0?'Definir locais':fmt(allocated)+' de '+fmt(itemQty)+' distribuídos')+'</small></summary>'
      +saved+'<div class="omniRoomInputs">'
      +'<div class="field"><label>Escolher do Projetista</label><select id="omniRoomChoice'+index+'"><option value="">Outro / informar manualmente</option>'+options+'</select></div>'
      +'<div class="field"><label>Ou digitar ambiente</label><input id="omniRoomCustom'+index+'" placeholder="Ex.: Suíte master, área comum, piscina"></div>'
      +'<div class="field omniRoomQty"><label>Quantidade</label><input id="omniRoomQty'+index+'" type="number" min="1" max="'+Math.max(1,remaining)+'" value="'+Math.max(1,Math.min(1,remaining))+'"></div>'
      +'<button class="ghost" type="button" onclick="omniAddItemRoom('+index+')">＋ Vincular</button></div>'
      +'<p class="hint">'+(remaining<0?'A soma dos ambientes excede a quantidade do orçamento. Ajuste antes de gerar a descrição.':
        remaining===0?'Todas as unidades deste item foram distribuídas.':
        'Faltam '+fmt(remaining)+' '+plural(remaining,'unidade','unidades')+' para distribuir (opcional).')+'</p></details>';
  }
  if(typeof previousRenderSelected==='function'){
    window.renderSelected=function(){
      previousRenderSelected();
      const cards=document.querySelectorAll('#selectedItems .selectitem');
      cards.forEach((card,index)=>{
        const item=quoteItems[index];
        if(!item || item.__auto)return;
        const area=document.createElement('div');
        area.className='omniItemLocations';
        area.innerHTML=locationListHTML(index,item);
        card.appendChild(area);
      });
    };
  }
  window.omniAddItemRoom=function(index){
    const item=quoteItems[index];if(!item || item.__auto)return;
    const roomSelect=document.getElementById('omniRoomChoice'+index),
      custom=document.getElementById('omniRoomCustom'+index),
      qtyInput=document.getElementById('omniRoomQty'+index);
    const qty=count(qtyInput&&qtyInput.value);
    const rooms=projectRooms();
    const room=rooms.find(r=>String(r.id)===String(roomSelect&&roomSelect.value));
    const typed=clean(custom&&custom.value);
    const name=typed||(room&&roomLabel(room,rooms))||'';
    if(!name)return alert('Escolha um ambiente do Projetista ou digite um nome.');
    if(qty<1)return alert('Informe uma quantidade válida.');
    const current=assignments(item).reduce((a,v)=>a+count(v.quantidade),0);
    if(qty+current>count(item.qty))return alert('A quantidade distribuída não pode ultrapassar as '+count(item.qty)+' unidades do item.');
    const list=assignments(item).map(x=>({...x})),key=norm(name);
    const existing=list.find(x=>norm(x.nome)===key);
    if(existing)existing.quantidade=count(existing.quantidade)+qty;
    else list.push({nome:name,quantidade:qty,
      ambiente_id:typed?null:(room&&room.id)||null,
      planta_id:typed?null:(room&&room.plantaId)||null});
    item.omniAmbientes=list;
    if(state.projectId)item.omniProjetoId=state.projectId;
    window.renderSelected();
  };
  window.omniRemoveItemRoom=function(index,allocationIndex){
    const item=quoteItems[index];if(!item)return;
    item.omniAmbientes=assignments(item).filter((_,j)=>j!==allocationIndex);
    window.renderSelected();
  };
  function category(item){
    const n=norm((item.name||'')+' '+(item.model||'')),cat=norm(item.category||'');
    if(/camera|cftv|nvr|dvr|gravador/.test(n+' '+cat))return 'CFTV E SEGURANÇA';
    if(/videoporteiro|video porteiro|interfone|fechadura|controle de acesso|botoeira|leitor facial/.test(n+' '+cat))return 'CONTROLE DE ACESSO E INTERFONIA';
    if(/wifi|wi-fi|access point|roteador|switch|gateway|rack|rede|unifi|cabeamento estruturado/.test(n+' '+cat))return 'REDE E WI-FI';
    if(/som|audio|caixa acustica|amplificador|receiver|projetor|televisor|tv |video|home theater/.test(n+' '+cat))return 'ÁUDIO E VÍDEO';
    if(/automacao|zigbee|tuya|cortina motorizada|persiana|sensor|hub/.test(n+' '+cat))return 'AUTOMAÇÃO';
    if(/eletric|ilumin|tomada|interruptor|disjuntor|quadro eletrico|luminaria|led/.test(n+' '+cat))return 'ELÉTRICA E ILUMINAÇÃO';
    if(/cabo|conector|eletroduto|insumo|tubulacao|tubo|suporte/.test(n+' '+cat))return 'INFRAESTRUTURA E INSUMOS';
    return 'OUTROS EQUIPAMENTOS';
  }
  function equipmentKind(item){
    const n=norm((item.name||'')+' '+(item.model||''));
    if(/access point|wi-fi|wifi|ponto de acesso|roteador/.test(n))
      return {key:'ap',one:'ponto de acesso Wi-Fi',many:'pontos de acesso Wi-Fi',verbOne:'Está previsto',verbMany:'Estão previstos'};
    if(/switch/.test(n))
      return {key:'switch',one:'switch de rede',many:'switches de rede',verbOne:'Está previsto',verbMany:'Estão previstos'};
    if(/camera/.test(n))
      return {key:'camera',one:'câmera',many:'câmeras',verbOne:'Está prevista',verbMany:'Estão previstas'};
    if(/gateway/.test(n))
      return {key:'gateway',one:'gateway de rede',many:'gateways de rede',verbOne:'Está previsto',verbMany:'Estão previstos'};
    if(/projetor/.test(n))
      return {key:'projetor',one:'projetor',many:'projetores',verbOne:'Está previsto',verbMany:'Estão previstos'};
    if(/caixa de som|caixa acustica/.test(n))
      return {key:'som',one:'caixa de som',many:'caixas de som',verbOne:'Está prevista',verbMany:'Estão previstas'};
    if(/videoporteiro|video porteiro|interfone/.test(n))
      return {key:'interfone',one:'equipamento de interfonia',many:'equipamentos de interfonia',verbOne:'Está previsto',verbMany:'Estão previstos'};
    if(/fechadura/.test(n))
      return {key:'fechadura',one:'fechadura eletrônica',many:'fechaduras eletrônicas',verbOne:'Está prevista',verbMany:'Estão previstas'};
    return {key:'produto:'+norm(item.name||'Equipamento'),one:clean(item.name||'equipamento'),
      many:clean(item.name||'equipamento'),verbOne:'Está previsto',verbMany:'Estão previstos',generic:true};
  }
  function joinWords(words){
    if(!words.length)return '';
    if(words.length===1)return words[0];
    return words.slice(0,-1).join(', ')+' e '+words[words.length-1];
  }
  function buildDescription(items){
    const base=items.filter(x=>count(x.qty)>0&&!x.__auto&&!x.__conditional);
    const groups=new Map(),order=['REDE E WI-FI','CFTV E SEGURANÇA','AUTOMAÇÃO','ÁUDIO E VÍDEO',
      'CONTROLE DE ACESSO E INTERFONIA','ELÉTRICA E ILUMINAÇÃO','INFRAESTRUTURA E INSUMOS','OUTROS EQUIPAMENTOS','SERVIÇOS'];
    base.forEach(item=>{
      const service=isService(item),cat=service?'SERVIÇOS':category(item),kind=service?
        {key:'servico:'+norm(item.name),one:clean(item.name),many:clean(item.name),generic:true}:equipmentKind(item);
      const key=cat+'|'+kind.key;
      if(!groups.has(key))groups.set(key,{cat,kind,qty:0,locations:new Map()});
      const g=groups.get(key);g.qty+=count(item.qty);
      assignments(item).forEach(entry=>{
        const name=clean(entry.nome),qty=count(entry.quantidade);
        if(!name||!qty)return;
        const k=norm(name),old=g.locations.get(k);
        if(old)old.qty+=qty;else g.locations.set(k,{name,qty});
      });
    });
    const sections=[];
    order.forEach(cat=>{
      const chunk=[...groups.values()].filter(g=>g.cat===cat);
      if(!chunk.length)return;
      const paragraphs=chunk.map(g=>{
        const label=g.kind.generic?(g.qty===1?g.kind.one:g.kind.many):plural(g.qty,g.kind.one,g.kind.many);
        let text=g.kind.generic?('O orçamento prevê '+fmt(g.qty)+' '+plural(g.qty,'unidade','unidades')+' de '+label):
          (plural(g.qty,g.kind.verbOne,g.kind.verbMany)+' '+fmt(g.qty)+' '+label);
        const loc=[...g.locations.values()],used=loc.reduce((a,x)=>a+x.qty,0);
        if(loc.length){
          const formatted=loc.map(x=>x.qty===1?x.name:x.name+' ('+fmt(x.qty)+' '+plural(x.qty,'unidade','unidades')+')');
          text+=used===g.qty?', com distribuição prevista entre '+joinWords(formatted):
            ', incluindo '+fmt(used)+' '+plural(used,'unidade','unidades')+' com local definido em '+joinWords(formatted);
        } else text+='; ambientes de instalação a definir';
        if(used<g.qty && loc.length)text+='. Restam '+fmt(g.qty-used)+' '+plural(g.qty-used,'unidade','unidades')+' sem ambiente definido';
        return text+'.';
      });
      sections.push(cat+'\n'+paragraphs.join('\n'));
    });
    const autoService=items.some(x=>x.__auto&&isService(x)&&count(x.qty)>0);
    if(autoService)sections.push('INSTALAÇÃO E CONFIGURAÇÃO\nOs serviços de instalação, configuração e cabeamento previstos estão discriminados nos itens do orçamento. A execução deverá seguir as condições e quantidades efetivamente contratadas.');
    return sections.join('\n\n');
  }
  window.omniBuildProposalDescription=buildDescription;
  window.omniGenerateProposalDescription=function(){
    const items=(quoteItems||[]).filter(x=>count(x.qty)>0);
    if(!items.length)return alert('Adicione os equipamentos ao orçamento antes de gerar a descrição.');
    const invalid=items.filter(x=>assignments(x).reduce((a,v)=>a+count(v.quantidade),0)>count(x.qty));
    if(invalid.length)return alert('Revise os ambientes: a quantidade distribuída ultrapassa a quantidade do orçamento em '+invalid.map(x=>x.name).join(', ')+'.');
    const output=buildDescription(items);
    if(!output)return alert('Não encontrei itens suficientes para montar a descrição.');
    const area=document.getElementById('qsummary');
    if(!area)return;
    if(clean(area.value)&&!confirm('Substituir a descrição atual pela versão automática? O texto poderá ser editado antes de salvar.'))return;
    state.previousSummary=area.value;
    area.value=output;
    area.dispatchEvent(new Event('input',{bubbles:true}));
    area.focus();
    area.scrollIntoView({behavior:'smooth',block:'center'});
  };
  if(typeof previousSaveQuote==='function'){
    window.saveQuote=async function(){
      const field=document.getElementById('omniQuoteProject');
      const pid=field?field.value:state.projectId;
      quoteItems.forEach(item=>{if(!item.__auto)item.omniProjetoId=pid||null;});
      return previousSaveQuote();
    };
  }
})();