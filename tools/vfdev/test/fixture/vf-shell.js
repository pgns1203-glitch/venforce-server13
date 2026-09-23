// imita o vf-shell.js: reparenta os childNodes do body dentro de <main id="vf-shell-main">
(function(){ const main=document.createElement('main'); main.id='vf-shell-main'; while(document.body.firstChild) main.appendChild(document.body.firstChild); document.body.appendChild(main); })();
