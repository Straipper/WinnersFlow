import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:5500"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.coerce.boolean().default(false),
  MARKET_DATA_PROVIDER: z.string().default("mock"),
  MARKET_DATA_API_KEY: z.string().optional().default(""),
  OPTIONFLOW_API_KEY: z.string().optional().default(""),
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  STRIPE_PRICE_ID: z.string().optional().default(""),
  APP_URL: z.string().default("http://localhost:5500"),
  APP_SIGNING_SECRET: z.string().optional().default(""),
  RESEND_API_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().optional().default(""),
  ADMIN_NOTIFICATION_EMAIL: z.string().optional().default(""),
});

const parsed = schema.parse(process.env);
if (parsed.NODE_ENV === 'production') {
  if (parsed.CORS_ORIGIN === '*') throw new Error('CORS_ORIGIN must not be * in production.');
  if (!parsed.APP_URL.startsWith('https://')) throw new Error('APP_URL must use https:// in production.');
  if (parsed.MARKET_DATA_PROVIDER === 'twelve_data' && !parsed.MARKET_DATA_API_KEY) throw new Error('MARKET_DATA_API_KEY is required when MARKET_DATA_PROVIDER=twelve_data.');
  if (!parsed.OPTIONFLOW_API_KEY) throw new Error('OPTIONFLOW_API_KEY is required in production for live Options Flow / Dark Pool data.');
  if (!parsed.STRIPE_SECRET_KEY || !parsed.STRIPE_SECRET_KEY.startsWith('sk_live_')) throw new Error('STRIPE_SECRET_KEY must be a Stripe live key in production.');
  if (!parsed.STRIPE_WEBHOOK_SECRET || !parsed.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) throw new Error('STRIPE_WEBHOOK_SECRET is required in production.');
  if (!parsed.STRIPE_PRICE_ID || !parsed.STRIPE_PRICE_ID.startsWith('price_')) throw new Error('STRIPE_PRICE_ID is required in production.');
  if (!parsed.APP_SIGNING_SECRET || parsed.APP_SIGNING_SECRET.length < 32) {
    throw new Error('APP_SIGNING_SECRET must be at least 32 characters in production.');
  }
}

export const env = parsed;
