(function(){
  const API_BASE = (window.DT_FLOW_API_BASE || '').replace(/\/$/,'');
  function api(path){ return API_BASE + path; }
  function token(){ return localStorage.getItem('dtflow_token') || ''; }
  async function request(path, options={}){
    const headers = Object.assign({'Content-Type':'application/json'}, options.headers||{});
    const t=token(); if(t) headers.Authorization='Bearer '+t;
    const res=await fetch(api(path), Object.assign({}, options, {headers}));
    let data={}; try{data=await res.json()}catch(_){ }
    if(!res.ok){ const e=new Error(data.error || 'Request failed'); e.status=res.status; e.data=data; throw e; }
    return data;
  }
  function saveAuth(data){
    if(data && data.token) localStorage.setItem('dtflow_token',data.token);
    if(data && data.user) localStorage.setItem('dtflow_user',JSON.stringify(data.user));
  }
  async function access(){ return request('/api/access/status'); }
  async function startCheckout(){
    const data=await request('/api/billing/checkout',{method:'POST',body:'{}'});
    if(!data.checkoutUrl) throw new Error('Stripe Checkout URL was not returned.');
    location.href=data.checkoutUrl;
  }
  window.DTAuth={api,request,token,saveAuth,access,startCheckout};
})();
