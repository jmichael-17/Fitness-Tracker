/* Iron Island: Firebase bridge for the GitHub version.
   The app already knows how to save to an account (its "cloud" mode). Inside Claude
   that account storage comes from Claude; here this file provides the same thing on
   top of Firebase, so the app code is identical in both places.

   Privacy: every record is encrypted on the user's own device with a key made from
   their recovery key before it is uploaded. Firebase only ever stores scrambled bytes,
   so the project owner cannot read anyone's weigh-ins, lifts, notes or photos. */
(function(){
'use strict';

var CONFIG={
  apiKey:"AIzaSyBW75V8Uect2lNDO_AJbnonTGnnfQQLqao",
  authDomain:"fitness-tracker-2da98.firebaseapp.com",
  projectId:"fitness-tracker-2da98",
  storageBucket:"fitness-tracker-2da98.firebasestorage.app",
  messagingSenderId:"321205539649",
  appId:"1:321205539649:web:385f7e238478687f4b47c0"
};
var ALPHA='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   /* 32 letters and digits, no 0/O/1/I/L lookalikes */
var LOCAL_FLAG='iron-local';
var enc=new TextEncoder(), dec=new TextDecoder();

var fb=null, auth=null, fs=null, startErr=null;
try{
  fb=firebase.initializeApp(CONFIG); auth=firebase.auth(); fs=firebase.firestore();
  try{fs.enablePersistence({synchronizeTabs:true}).catch(function(){})}catch(e){}
}catch(e){startErr=e}

function ls(k,v){try{if(v===undefined) return localStorage.getItem(k); if(v===null) localStorage.removeItem(k); else localStorage.setItem(k,v)}catch(e){return null}}

/* ---------- the gate: sign-in and unlock before the app opens its account mode ---------- */
var resolveReady, rejectReady;
var ready=new Promise(function(res,rej){resolveReady=res; rejectReady=rej});
ready.catch(function(){});
window.claude={use:function(name){
  if(name==='db') return ready.then(function(x){return x.db});
  if(name==='user') return ready.then(function(x){return x.user});
  return Promise.reject({code:'unavailable'});
}};

/* ---------- recovery key ---------- */
function newKey(){var b=crypto.getRandomValues(new Uint8Array(25)), s=''; for(var i=0;i<25;i++) s+=ALPHA[b[i]&31]; return s}
function pretty(k){return 'IRON-'+k.match(/.{5}/g).join('-')}
function normalize(t){
  var s=String(t||'').toUpperCase().replace(/\s+/g,'').replace(/^IRON-?/,'');
  s=s.split('').filter(function(c){return ALPHA.indexOf(c)>=0}).join('');
  return s.length===25?s:null;
}
function deriveKey(raw,uid){
  return crypto.subtle.importKey('raw',enc.encode(raw),'HKDF',false,['deriveKey']).then(function(base){
    return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('iron-island|'+uid),info:enc.encode('data-v1')},
      base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  });
}
function seal(key,bytes,aad){
  var iv=crypto.getRandomValues(new Uint8Array(12));
  return crypto.subtle.encrypt({name:'AES-GCM',iv:iv,additionalData:enc.encode(aad)},key,bytes).then(function(ct){
    var out=new Uint8Array(12+ct.byteLength); out.set(iv,0); out.set(new Uint8Array(ct),12);
    return firebase.firestore.Blob.fromUint8Array(out);
  });
}
function open(key,blob,aad){
  var u=blob.toUint8Array();
  return crypto.subtle.decrypt({name:'AES-GCM',iv:u.slice(0,12),additionalData:enc.encode(aad)},key,u.slice(12)).then(function(pt){return new Uint8Array(pt)});
}
function sealObj(key,aad,o){return seal(key,enc.encode(JSON.stringify(o)),aad)}
function openObj(key,aad,blob){return open(key,blob,aad).then(function(b){return JSON.parse(dec.decode(b))})}
function dataToBytes(d){var m=/^data:[^;]+;base64,(.*)$/.exec(d||''); if(!m) return null; var bin=atob(m[1]), a=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a}
function bytesToData(b){var s='', CH=0x8000; for(var i=0;i<b.length;i+=CH) s+=String.fromCharCode.apply(null,b.subarray(i,i+CH)); return 'data:image/jpeg;base64,'+btoa(s)}

/* ---------- encrypted collections shaped like the app expects ---------- */
function makeDb(uid,key){
  var base=fs.collection('users').doc(uid);
  var photoMem={};
  function col(kind,isPhoto){
    var ref=base.collection(kind), cache={}, chain=Promise.resolve();
    function view(id){
      var o=cache[id]; if(!isPhoto) return o;
      return photoMem[id]?Object.assign({},o,{data:photoMem[id]}):Object.assign({},o,{lazy:true});
    }
    return {
      doc:function(id){
        var api={
          set:function(data){
            var d=Object.assign({},data), pic=null;
            if(isPhoto){pic=d.data; delete d.data; delete d.blob; delete d.lazy}
            cache[id]=d;
            var jobs=[sealObj(key,kind+'/'+id,d).then(function(e){return ref.doc(id).set({e:e})})];
            if(isPhoto&&pic){
              photoMem[id]=pic;
              var bytes=dataToBytes(pic);
              if(bytes) jobs.push(seal(key,bytes,'photoData/'+id).then(function(e){return base.collection('photoData').doc(id).set({e:e})}));
            }
            return Promise.all(jobs);
          },
          update:function(part){return api.set(Object.assign({},cache[id]||{},part))},
          delete:function(){
            delete cache[id]; delete photoMem[id];
            var jobs=[ref.doc(id).delete()];
            if(isPhoto) jobs.push(base.collection('photoData').doc(id).delete());
            return Promise.all(jobs);
          }
        };
        return api;
      },
      onSnapshot:function(cb,err){
        return ref.onSnapshot(function(snap){
          var changes=snap.docChanges();
          chain=chain.then(function(){
            return Promise.all(changes.map(function(c){
              var id=c.doc.id;
              if(c.type==='removed'){delete cache[id]; return null}
              var raw=c.doc.data();
              if(!raw||!raw.e) return null;
              return openObj(key,kind+'/'+id,raw.e).then(function(o){cache[id]=o}).catch(function(){});
            }));
          }).then(function(){
            cb({docs:Object.keys(cache).map(function(id){var v=view(id); return {id:id,data:function(){return v}}})});
          }).catch(function(){});
        },err);
      }
    };
  }
  var cols={};
  var root={collection:function(kind){return cols[kind]||(cols[kind]=col(kind,kind==='photos'))}};
  /* photos load only when they are about to be shown */
  window.__ironPhoto=function(id){
    if(photoMem[id]) return Promise.resolve(photoMem[id]);
    return base.collection('photoData').doc(id).get().then(function(s){
      var raw=s.exists?s.data():null; if(!raw||!raw.e) return null;
      return open(key,raw.e,'photoData/'+id).then(function(b){var d=bytesToData(b); photoMem[id]=d; return d});
    });
  };
  return {doc:function(){return root}};
}

/* ---------- screens ---------- */
var css=document.createElement('style');
css.textContent=[
'.ii-ov{position:fixed;inset:0;z-index:200;background:var(--bg,#cfe6e3);overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:max(24px,env(safe-area-inset-top)) 16px 40px}',
'.ii-ov .card{max-width:440px;width:100%;margin-top:6vh;display:flex;flex-direction:column;gap:14px}',
'.ii-ov h2{font-size:24px}',
'.ii-ov p{margin:0}',
'.ii-key{font:800 19px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.04em;text-align:center;background:var(--field,#fff);border:3px solid var(--line,#1d2b45);border-radius:14px;padding:12px 8px;user-select:all;-webkit-user-select:all}',
'.ii-warn{background:var(--rust-soft,#fbd3c5);border:3px solid var(--line,#1d2b45);border-radius:14px;padding:10px 12px;font-weight:800}',
'.ii-row{display:flex;gap:10px;flex-wrap:wrap}',
'.ii-row .btn,.ii-row form{flex:1 1 140px}',
'.ii-row form .btn{width:100%}',
'.ii-list{margin:0;padding-left:20px}',
'.ii-chk{display:flex;gap:10px;align-items:center;font-weight:800;cursor:pointer}',
'.ii-chk input{width:22px;height:22px;accent-color:var(--green,#2f9e5e);flex:none}',
'.ii-in{background:var(--field,#fff);border:3px solid var(--line,#1d2b45);border-radius:14px;padding:10px 12px;width:100%;font:700 16px var(--f-body,system-ui);color:var(--ink,#1d2b45)}',
'.ii-small{font-size:13px;color:var(--muted,#56637f)}',
'.ii-msg{min-height:20px;font-weight:800;font-size:14px}',
'.ii-link{background:none;border:0;padding:0;color:var(--blue,#3a78d8);font:inherit;font-weight:800;text-decoration:underline;cursor:pointer}',
'.ii-acct{text-align:center;font-size:13px;color:var(--muted,#56637f);display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:-6px}',
'.ii-band{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:var(--mustard-soft,#fde7b0);border:3px dashed var(--line,#1d2b45);border-radius:16px;padding:10px 14px;font-weight:800}',
'.ii-hide{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}'
].join('\n');

function el(tag,attrs){
  var e=document.createElement(tag), a=attrs||{};
  Object.keys(a).forEach(function(k){
    var v=a[k];
    if(k==='class') e.className=v; else if(k==='text') e.textContent=v;
    else if(k.indexOf('on')===0) e.addEventListener(k.slice(2),v);
    else if(v===true) e.setAttribute(k,''); else if(v!==false&&v!=null) e.setAttribute(k,v);
  });
  for(var i=2;i<arguments.length;i++){var c=arguments[i]; if(c==null) continue; (Array.isArray(c)?c:[c]).forEach(function(x){if(x!=null) e.append(x.nodeType?x:document.createTextNode(String(x)))})}
  return e;
}
var ov=null;
function screen(){
  if(!ov){ov=el('div',{class:'ii-ov',role:'dialog','aria-modal':'true'}); document.body.append(ov)}
  ov.hidden=false; var c=el('div',{class:'card'}); ov.replaceChildren(c); return c;
}
function closeScreen(){if(ov) ov.hidden=true}
function msgLine(){return el('div',{class:'ii-msg','aria-live':'polite'})}

function signInScreen(note){
  var c=screen(), m=msgLine();
  c.append(
    el('h2',{text:'Iron Island'}),
    el('p',{text:'Sign in to keep your weigh-ins, lifts and photos saved to your account, on every device.'}),
    el('p',{class:'ii-small',text:'Everything is encrypted on your phone before it is saved. Only you can open it, not even the app’s owner.'}),
    el('button',{class:'btn',type:'button',onclick:function(){
      m.textContent='Opening Google sign-in…';
      var p=new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({prompt:'select_account'});
      auth.signInWithPopup(p).catch(function(e){
        var code=e&&e.code||'';
        if(/popup-blocked|operation-not-supported|web-storage-unsupported/.test(code)) return auth.signInWithRedirect(p);
        if(/popup-closed|cancelled-popup/.test(code)){m.textContent='Sign-in was closed. Try again when you’re ready.';return}
        if(/unauthorized-domain/.test(code)){m.textContent='This site isn’t on the Authorized domains list in Firebase yet (Authentication → Settings).';return}
        m.textContent='Sign-in didn’t work ('+(code||'unknown error')+'). Try again.';
      });
    }},'Sign in with Google'),
    m,
    el('button',{class:'ii-link',type:'button',onclick:goLocal},'Use without an account (saved on this phone only)'),
    note?el('p',{class:'ii-small',text:note}):null
  );
}

function savePasswordForm(email,keyText,onSaved){
  /* A real form submission is what makes iPhone and Android offer "Save Password?" */
  var sinkName='ii-sink-'+Date.now();
  var sink=el('iframe',{name:sinkName,class:'ii-hide',title:'',tabindex:'-1','aria-hidden':'true'});
  var f=el('form',{method:'post',action:'about:blank',target:sinkName,autocomplete:'on'},
    el('input',{class:'ii-hide',type:'text',name:'username',autocomplete:'username',value:email||'Iron Island',tabindex:'-1','aria-hidden':'true'}),
    el('input',{class:'ii-hide',type:'password',name:'password',autocomplete:'new-password',value:keyText,tabindex:'-1','aria-hidden':'true'}),
    el('button',{class:'btn green',type:'submit'},'Save to Passwords'));
  f.addEventListener('submit',function(){
    try{
      if(window.PasswordCredential&&navigator.credentials&&navigator.credentials.store)
        navigator.credentials.store(new PasswordCredential({id:email||'Iron Island',password:keyText,name:'Iron Island recovery key'})).catch(function(){});
    }catch(e){}
    setTimeout(onSaved,300);
  });
  return [sink,f];
}
function copyBtn(text,m){
  return el('button',{class:'btn ghost',type:'button',onclick:function(){
    var done=function(){m.textContent='Copied. Paste it into Passwords or Notes.'};
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(function(){m.textContent='Press and hold the key above to copy it.'});
    else m.textContent='Press and hold the key above to copy it.';
  }},'Copy');
}

function keyScreen(email,raw,firstTime,onContinue){
  var c=screen(), m=msgLine(), keyText=pretty(raw);
  var saved=function(){m.textContent='If your phone asked to save it, tap Save. No prompt? Tap Copy and paste it into Passwords or Notes.'};
  var parts=savePasswordForm(email,keyText,saved);
  c.append(
    el('h2',{text:'🔑 Save your recovery key'}),
    el('div',{class:'ii-key'},keyText.split('-').map(function(g,i){return [i?el('wbr'):null,el('span',{style:'white-space:nowrap'},(i?'-':'')+g)]}).reduce(function(x,y){return x.concat(y)},[])),
    el('p',{text:'Your logs and photos are locked with this key, so only you can see them. Not even the app’s owner can open them.'}),
    el('div',null,el('b',{text:'You’ll need this key if you:'}),
      el('ul',{class:'ii-list'},el('li',{text:'Get a new phone'}),el('li',{text:'Delete the app from your home screen'}),el('li',{text:'Clear your Safari or browser data'}))),
    el('div',{class:'ii-warn',text:'If you lose this key, your data can’t be recovered. By anyone.'}),
    parts[0],
    el('div',{class:'ii-row'},parts[1],copyBtn(keyText,m)),
    el('p',{class:'ii-small',text:'You can also screenshot this screen and keep it somewhere private.'}),
    m
  );
  if(firstTime){
    var box=el('input',{type:'checkbox'}), go=el('button',{class:'btn',type:'button',disabled:true,onclick:function(){go.disabled=true; onContinue()}},'Continue');
    box.addEventListener('change',function(){go.disabled=!box.checked});
    c.append(el('label',{class:'ii-chk'},box,'I saved my recovery key somewhere safe'),go);
  }else{
    c.append(el('button',{class:'btn ghost',type:'button',onclick:closeScreen},'Done'));
  }
}

function enterKeyScreen(email,uid,check,onOk){
  var c=screen(), m=msgLine();
  var user=el('input',{class:'ii-hide',type:'text',name:'username',autocomplete:'username',value:email||'',readonly:true,tabindex:'-1','aria-hidden':'true'});
  var inp=el('input',{class:'ii-in',type:'password',name:'password',autocomplete:'current-password',autocapitalize:'characters',spellcheck:'false',placeholder:'IRON-XXXXX-XXXXX-…','aria-label':'Recovery key'});
  var show=el('button',{class:'ii-link',type:'button',onclick:function(){inp.type=inp.type==='password'?'text':'password'; show.textContent=inp.type==='password'?'Show key':'Hide key'}},'Show key');
  var f=el('form',{autocomplete:'on'},user,inp);
  var btn=el('button',{class:'btn',type:'submit'},'Unlock');
  f.append(el('div',{class:'ii-row',style:'margin-top:12px'},btn));
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var raw=normalize(inp.value);
    if(!raw){m.textContent='That doesn’t look like a full recovery key. It starts with IRON- and has 5 groups.';return}
    btn.disabled=true; m.textContent='Checking…';
    deriveKey(raw,uid).then(function(k){return openObj(k,'vault',check).then(function(o){if(!o||o.ok!==1) throw 0; onOk(raw,k)})})
      .catch(function(){btn.disabled=false; m.textContent='That key doesn’t match this account. Check it and try again.'});
  });
  c.append(
    el('h2',{text:'Unlock your data'}),
    el('p',{text:'This device doesn’t have your recovery key yet. Enter it once and this device remembers it.'}),
    el('p',{class:'ii-small',text:'Saved it in Passwords? Tap the box and choose it above the keyboard.'}),
    f,show,m,
    el('p',{class:'ii-small'},'Signed in as '+(email||'your Google account')+'. ',
      el('button',{class:'ii-link',type:'button',onclick:function(){auth.signOut().then(function(){location.reload()})}},'Use a different account')),
    el('p',{class:'ii-small'},'Lost your key? ',el('button',{class:'ii-link',type:'button',onclick:function(){eraseScreen(email,uid)}},'Erase my data and start over'))
  );
  setTimeout(function(){try{inp.focus()}catch(e){}},150);
}

function eraseScreen(email,uid){
  var c=screen(), m=msgLine(), armed=false;
  var b=el('button',{class:'btn',type:'button',style:'background:var(--rust,#e4572e)',onclick:function(){
    if(!armed){armed=true; b.textContent='Yes, permanently erase everything'; return}
    b.disabled=true; m.textContent='Erasing…';
    var base=fs.collection('users').doc(uid);
    Promise.all(['weights','workouts','program','photos','photoData','meta'].map(function(k){
      return base.collection(k).get().then(function(s){return Promise.all(s.docs.map(function(d){return d.ref.delete()}))});
    })).then(function(){ls('iron-vault-'+uid,null); location.reload()})
      .catch(function(){b.disabled=false; m.textContent='Could not erase right now. Check your connection and try again.'});
  }},'Erase my data');
  c.append(
    el('h2',{text:'Start over?'}),
    el('div',{class:'ii-warn',text:'Without your recovery key, your saved data can’t be opened by anyone. Starting over permanently deletes it and gives you a new key.'}),
    b,m,
    el('button',{class:'btn ghost',type:'button',onclick:function(){location.reload()}},'Go back')
  );
}

function errorScreen(text,retry){
  var c=screen();
  c.append(el('h2',{text:'Almost there'}),el('p',{text:text}),
    el('button',{class:'btn',type:'button',onclick:retry},'Try again'),
    el('button',{class:'ii-link',type:'button',onclick:goLocal},'Use without an account for now'));
}

/* account line under the app, plus the one-time reminder */
function accountBar(user,raw){
  var wrap=document.querySelector('.wrap'); if(!wrap) return;
  var bar=el('div',{class:'ii-acct'},
    el('span',{text:user?('Signed in as '+(user.email||'Google account')):'Saved on this phone only'}),
    user?el('button',{class:'ii-link',type:'button',onclick:function(){keyScreen(user.email,raw,false)}},'Show my recovery key'):null,
    user?el('button',{class:'ii-link',type:'button',onclick:function(){auth.signOut().then(function(){location.reload()})}},'Sign out')
        :el('button',{class:'ii-link',type:'button',onclick:function(){ls(LOCAL_FLAG,null); location.reload()}},'Sign in to sync'));
  wrap.append(bar);
  if(!user) return;
  var t=Number(ls('iron-keyset-'+user.uid)||0);
  if(t&&Date.now()-t>7*864e5&&ls('iron-remind-'+user.uid)!=='1'){
    var band=el('div',{class:'ii-band'},el('span',{text:'Did you save your recovery key?'}),
      el('span',{class:'ii-row',style:'flex:0 1 auto'},
        el('button',{class:'btn small',type:'button',onclick:function(){keyScreen(user.email,raw,false)}},'View it again'),
        el('button',{class:'btn small ghost',type:'button',onclick:function(){ls('iron-remind-'+user.uid,'1'); band.remove()}},'Yes, it’s saved')));
    var top=wrap.querySelector('.top'); if(top&&top.nextSibling) wrap.insertBefore(band,top.nextSibling); else wrap.prepend(band);
  }
}

function finish(user,raw,key){
  ls('iron-vault-'+user.uid,raw);
  closeScreen();
  resolveReady({db:makeDb(user.uid,key),user:{id:function(){return user.uid}}});
  accountBar(user,raw);
}

function unlock(user){
  var vaultRef=fs.collection('users').doc(user.uid).collection('meta').doc('vault');
  vaultRef.get().catch(function(){return vaultRef.get({source:'cache'})}).then(function(s){
    var vault=s&&s.exists?s.data():null, raw=ls('iron-vault-'+user.uid);
    if(vault&&vault.check){
      if(raw) return deriveKey(raw,user.uid).then(function(k){
        return openObj(k,'vault',vault.check).then(function(){finish(user,raw,k)})
          .catch(function(){ls('iron-vault-'+user.uid,null); enterKeyScreen(user.email,user.uid,vault.check,function(r,k2){finish(user,r,k2)})});
      });
      return enterKeyScreen(user.email,user.uid,vault.check,function(r,k){finish(user,r,k)});
    }
    /* first sign-in for this account: make a key, show it, then save the vault check */
    var fresh=raw&&normalize(raw)?raw:newKey();
    keyScreen(user.email,fresh,true,function(){
      deriveKey(fresh,user.uid).then(function(k){
        return sealObj(k,'vault',{ok:1}).then(function(chk){
          vaultRef.set({v:1,check:chk,created:firebase.firestore.FieldValue.serverTimestamp()}).catch(function(){});
          ls('iron-keyset-'+user.uid,String(Date.now()));
          finish(user,fresh,k);
        });
      }).catch(function(){errorScreen('Your phone couldn’t finish setting up encryption. Make sure you’re using Safari or Chrome, then try again.',function(){location.reload()})});
    });
  }).catch(function(){
    errorScreen('Connect to the internet to finish signing in, then try again.',function(){unlock(user)});
  });
}

function boot(){
  document.head.append(css);
  if(startErr||!auth||!window.crypto||!crypto.subtle){
    rejectReady({code:'local'});
    accountBar(null);
    return;
  }
  var first=true, wentLocal=false;
  var redirect=auth.getRedirectResult().catch(function(e){return {error:e}});
  auth.onAuthStateChanged(function(user){
    var wasFirst=first; first=false;
    if(user){ if(!wentLocal) unlockOnce(user); return }
    if(!wasFirst) return;
    if(ls(LOCAL_FLAG)==='1'){wentLocal=true; rejectReady({code:'local'}); accountBar(null); return}
    redirect.then(function(r){
      var code=r&&r.error&&r.error.code;
      if(!unlocked) signInScreen(code?'Last sign-in attempt didn’t finish ('+code+').':null);
    });
  });
}
var unlocked=false;
function goLocal(){ls(LOCAL_FLAG,'1'); closeScreen(); rejectReady({code:'local'}); if(!document.querySelector('.ii-acct')) accountBar(null)}
function unlockOnce(user){if(unlocked) return; unlocked=true; ls(LOCAL_FLAG,null); unlock(user)}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
