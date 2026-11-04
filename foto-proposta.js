/* OmniSpectra v114 - foto do equipamento diretamente na proposta. */
(function(){
 'use strict';
 function matchingProduct(item,products){
  return (products||[]).find(p=>
   (item.id&&String(p.id)===String(item.id))||
   (String(p.name||'').trim().toLowerCase()===String(item.name||'').trim().toLowerCase()&&
   (!item.model||String(p.model||'').trim().toLowerCase()===String(item.model||'').trim().toLowerCase())));
 }
 window.omniProposalAttachPhoto=async function(input,index){
  const file=input&&input.files&&input.files[0];if(!file)return;
  const allowed=/^image\/(jpeg|png|webp)$/i.test(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name);
  if(!allowed)return alert('Use JPG, PNG ou WEBP para a foto do equipamento.');
  if(file.size>10*1024*1024)return alert('A foto pode ter até 10 MB.');
  if(typeof omniEnsureFreshSession==='function'&&!await omniEnsureFreshSession())return;
  if(!db||!currentUser)return alert('Entre na sua conta para salvar a foto.');
  const all=typeof collectOmniVisual==='function'?collectOmniVisual()||get(K.quotes):get(K.quotes);
  const quote=all[visualQuoteIndex],item=quote&&quote.items&&quote.items[index];
  if(!quote||!item||!quote.id)return alert('Não foi possível identificar o equipamento nesta proposta.');
  if(input.disabled)return;
  input.disabled=true;
  try{
   const photo=await omniUploadProductPhoto(file,item.name||'Equipamento');
   const items=quote.items.map((x,i)=>i===index?{...x,photo,__photoOverride:true}:x);
   const saved=await db.from('propostas').update({itens:items,atualizado_em:new Date().toISOString()})
    .eq('id',quote.id).select('id').single();
   if(saved.error)throw Error('Foto enviada, mas não foi possível vinculá-la à proposta: '+saved.error.message);
   quote.items=items;
   set(K.quotes,all);
   const product=matchingProduct(item,get(K.products));
   if(product&&product.id){
    const linked=await db.from('catalogo').update({foto_url:photo}).eq('id',product.id).select('id').single();
    if(linked.error){
     alert('A foto está salva nesta proposta, mas não foi possível atualizá-la no catálogo: '+linked.error.message);
    }else{
     try{await omniReload(K.products)}catch(e){console.warn('Foto salva; catálogo será atualizado ao recarregar.',e)}
    }
   }
   render();
  }catch(e){console.error('Foto da proposta:',e);alert('Não foi possível salvar a foto: '+(e&&e.message||e));}
  finally{input.disabled=false;input.value='';}
 };
})();