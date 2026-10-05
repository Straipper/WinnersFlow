import { Resend } from 'resend';
import { env } from '../config/env.js';

let client = null;
function getClient(){
  if(!env.RESEND_API_KEY) return null;
  if(!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

export function emailConfigured(){ return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM); }

function layout(title, body){
  return `<!doctype html><html><body style="margin:0;background:#050308;color:#f7f1ff;font-family:Arial,sans-serif"><div style="max-width:620px;margin:40px auto;padding:36px;background:#0b0811;border:1px solid #241b35;border-radius:24px"><div style="font-size:24px;font-weight:800;letter-spacing:.08em;color:#d8baff">DT FLOW</div><div style="height:1px;background:#2a2135;margin:24px 0"></div>${body}<div style="margin-top:32px;color:#8f869b;font-size:12px">DT FLOW Portal · Market Intelligence</div></div></body></html>`;
}

const templates = {
  welcome: ({username}) => ({subject:'Welcome to DT FLOW', html:layout('Welcome', `<h1>Welcome, ${escapeHtml(username || 'Trader')}.</h1><p>Your DT FLOW account is ready.</p><p>Your trading intelligence terminal is waiting for you.</p><p><a href="${env.APP_URL}/portal" style="display:inline-block;padding:13px 20px;border-radius:12px;background:#d8baff;color:#08050d;text-decoration:none;font-weight:700">ENTER DT FLOW</a></p>`)}),
  trialStarted: ({username, trialEndsAt}) => ({subject:'Your DT FLOW trial has started', html:layout('Trial', `<h1>Your 3-day trial is live.</h1><p>Hi ${escapeHtml(username || 'Trader')}, your DT FLOW access is active.</p><p>Trial end: <strong>${escapeHtml(trialEndsAt || '3 days from signup')}</strong></p><p>Your payment method is handled securely by Stripe. DT FLOW does not store your card number or CVC.</p>`)}),
  paymentSuccess: ({username}) => ({subject:'DT FLOW payment successful', html:layout('Payment', `<h1>Payment successful.</h1><p>Hi ${escapeHtml(username || 'Trader')}, your DT FLOW subscription is active.</p><p>Thank you for using DT FLOW.</p>`)}),
  paymentFailed: ({username}) => ({subject:'Action needed: DT FLOW payment failed', html:layout('Payment failed', `<h1>Payment needs attention.</h1><p>Hi ${escapeHtml(username || 'Trader')}, Stripe reported a failed payment for your DT FLOW subscription.</p><p>Please update your payment method in your billing portal to keep access active.</p>`)}),
  trialEnding: ({username, trialEndsAt}) => ({subject:'Your DT FLOW trial is ending soon', html:layout('Trial ending', `<h1>Your trial is almost over.</h1><p>Hi ${escapeHtml(username || 'Trader')}, your DT FLOW trial ends on <strong>${escapeHtml(trialEndsAt || 'soon')}</strong>.</p><p>If you continue, your subscription will follow the Stripe billing schedule shown at checkout.</p>`)}),
  canceled: ({username}) => ({subject:'Your DT FLOW subscription was canceled', html:layout('Canceled', `<h1>Subscription canceled.</h1><p>Hi ${escapeHtml(username || 'Trader')}, your DT FLOW subscription has been canceled.</p><p>You can return later and reactivate from billing.</p>`)}),
  adminTrialStarted: ({username, email, trialEndsAt, userId, eventId}) => ({
    subject:'DT FLOW — New trial started',
    html:layout('New trial', `<h1>New DT FLOW trial</h1><p><strong>User:</strong> ${escapeHtml(username || '—')}</p><p><strong>Email:</strong> ${escapeHtml(email || '—')}</p><p><strong>User ID:</strong> ${escapeHtml(userId || '—')}</p><p><strong>Trial ends:</strong> ${escapeHtml(trialEndsAt || '—')}</p><p><strong>Stripe event:</strong> ${escapeHtml(eventId || '—')}</p>`)
  }),
  adminPaymentSuccess: ({username, email, amount, currency, userId, eventId, invoiceId}) => ({
    subject:'DT FLOW — Payment received',
    html:layout('Payment received', `<h1>DT FLOW payment received</h1><p><strong>User:</strong> ${escapeHtml(username || '—')}</p><p><strong>Email:</strong> ${escapeHtml(email || '—')}</p><p><strong>Amount:</strong> ${escapeHtml(amount || '29.00')} ${escapeHtml(String(currency || 'USD').toUpperCase())}</p><p><strong>Invoice:</strong> ${escapeHtml(invoiceId || '—')}</p><p><strong>User ID:</strong> ${escapeHtml(userId || '—')}</p><p><strong>Stripe event:</strong> ${escapeHtml(eventId || '—')}</p>`)
  }),
  adminPaymentFailed: ({username, email, userId, eventId, invoiceId}) => ({
    subject:'DT FLOW — Payment failed',
    html:layout('Payment failed', `<h1>DT FLOW payment failed</h1><p><strong>User:</strong> ${escapeHtml(username || '—')}</p><p><strong>Email:</strong> ${escapeHtml(email || '—')}</p><p><strong>Invoice:</strong> ${escapeHtml(invoiceId || '—')}</p><p><strong>User ID:</strong> ${escapeHtml(userId || '—')}</p><p><strong>Stripe event:</strong> ${escapeHtml(eventId || '—')}</p>`)
  }),
  adminCanceled: ({username, email, userId, eventId}) => ({
    subject:'DT FLOW — Subscription canceled',
    html:layout('Subscription canceled', `<h1>DT FLOW subscription canceled</h1><p><strong>User:</strong> ${escapeHtml(username || '—')}</p><p><strong>Email:</strong> ${escapeHtml(email || '—')}</p><p><strong>User ID:</strong> ${escapeHtml(userId || '—')}</p><p><strong>Stripe event:</strong> ${escapeHtml(eventId || '—')}</p>`)
  }),
};

function escapeHtml(v){return String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

export async function sendAdminTemplate(type, data={}) {
  if (!env.ADMIN_NOTIFICATION_EMAIL) return { sent:false, skipped:true, reason:'admin_notification_email_not_configured' };
  return sendTemplate(type, env.ADMIN_NOTIFICATION_EMAIL, data);
}

export async function sendTemplate(type, to, data={}){
  const tpl=templates[type];
  if(!tpl) throw new Error(`Unknown email template: ${type}`);
  if(!to) return {sent:false, skipped:true, reason:'missing_recipient'};
  const resend=getClient();
  if(!resend || !env.EMAIL_FROM) return {sent:false, skipped:true, reason:'email_not_configured'};
  const msg=tpl(data);
  const {data:result,error}=await resend.emails.send({from:env.EMAIL_FROM,to:[to],subject:msg.subject,html:msg.html},{idempotencyKey:`dt-flow/${type}/${data.eventId || to}/${data.userId || 'na'}`});
  if(error) throw new Error(error.message || 'Email send failed');
  return {sent:true,id:result?.id || null};
}
