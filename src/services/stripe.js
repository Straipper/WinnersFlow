import Stripe from 'stripe';
import { env } from '../config/env.js';

let stripeClient;

export function getStripe() {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (!stripeClient) stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export function requireStripeConfig() {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID || !env.APP_URL) {
    const error = new Error('Stripe Checkout is not configured');
    error.status = 503;
    throw error;
  }
}

export async function getConfiguredPrice() {
  requireStripeConfig();
  const stripe = getStripe();
  const price = await stripe.prices.retrieve(env.STRIPE_PRICE_ID);

  const recurring = price.recurring;
  const isCorrect =
    price.active === true &&
    price.currency === 'usd' &&
    price.unit_amount === 2900 &&
    recurring?.interval === 'month' &&
    recurring?.interval_count === 1;

  if (!isCorrect) {
    const error = new Error('Configured Stripe Price must be active, USD $29.00, recurring monthly.');
    error.status = 500;
    throw error;
  }

  return price;
}
