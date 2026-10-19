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
  async function startCheckout(paymentMethod='card'){
    const method=paymentMethod==='paypal'?'paypal':'card';
    const endpoint=method==='paypal'
      ? '/api/billing/paypal/create-subscription'
      : '/api/billing/checkout';
    const data=await request(endpoint,{method:'POST',body:'{}'});
    const checkoutUrl=method==='paypal'?data.approvalUrl:data.checkoutUrl;
    if(!checkoutUrl) throw new Error(method==='paypal'
      ? 'PayPal approval URL was not returned.'
      : 'Stripe Checkout URL was not returned.');
    location.href=checkoutUrl;
  }
  window.DTAuth={api,request,token,saveAuth,access,startCheckout};
})();
