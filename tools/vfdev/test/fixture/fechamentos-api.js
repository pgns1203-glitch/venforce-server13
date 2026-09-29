// imita renderização por innerHTML depois do fetch
setTimeout(() => {
  document.getElementById('fapi-kpis').innerHTML = ['Faturamento|R$ 482.310','Pedidos|1.378','MC|18,4%','Ads|6,1%'].map(s => { const [l,v]=s.split('|'); return `<article class="vf-card vf-kpi"><span class="vf-kpi__label">${l}</span><span class="vf-kpi__value">${v}</span></article>`; }).join('');
  document.querySelector('#fapi-ped-table tbody').innerHTML = Array.from({length:4},(_,i)=>`<tr data-row-id="${i}"><td>20000114${i}</td><td>KIT-CAFE-0${i}</td><td>R$ 289,90</td><td>R$ 21,45</td><td>R$ 118,00</td><td>22,1%</td></tr>`).join('');
}, 50);
